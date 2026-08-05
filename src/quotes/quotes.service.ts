import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, LessThan } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  CreateDraftOrderPayload,
  ShopifyService,
} from '../shared/shopify.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { Quote } from '../database/entities/quote.entity';

@Injectable()
export class QuotesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuotesService.name);
  private syncTimer?: NodeJS.Timeout;

  constructor(
    private readonly shopify: ShopifyService,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
  ) {}

  /**
   * Synchronise automatiquement le statut des devis avec Shopify :
   * un devis payé par le client passe le brouillon en « completed ».
   * Au démarrage puis toutes les 10 minutes.
   */
  onModuleInit(): void {
    setTimeout(() => {
      void this.syncStatuses('démarrage');
    }, 12000);

    this.syncTimer = setInterval(() => {
      void this.syncStatuses('périodique');
      void this.retryOrphanQuotes();
    }, 10 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
  }

  /**
   * Interroge Shopify pour chaque devis ayant un brouillon, et met à jour son
   * statut (open / invoice_sent / completed), l'ID de la commande payée et le
   * montant. Robuste : n'interrompt jamais le backend en cas d'échec.
   */
  async syncStatuses(reason = 'manuel'): Promise<{ updated: number }> {
    let quotes: Quote[] = [];
    try {
      quotes = await this.quotes.find({
        where: { draftOrderId: Not(IsNull()) },
      });
    } catch (e) {
      this.logger.warn(`Lecture des devis impossible : ${(e as Error).message}`);
      return { updated: 0 };
    }

    let updated = 0;
    for (const q of quotes) {
      // Un devis déjà payé ne change plus : on ne le re-interroge pas.
      if (q.draftStatus === 'completed') continue;
      try {
        const draft = await this.shopify.getDraftOrder(q.draftOrderId as string);
        const status = (draft?.status as string) ?? null;
        const orderId = draft?.order_id ? String(draft.order_id) : null;
        const total = draft?.total_price ? String(draft.total_price) : null;

        // Une réponse Shopify partielle (champ absent) ne doit JAMAIS effacer
        // une valeur déjà acquise : on ne remplace un champ que si la nouvelle
        // valeur est réellement renseignée. Sans cette garde, un draft renvoyé
        // sans `total_price`/`status` remettait `totalPrice`/`draftStatus` à
        // null → le devis sortait du périmètre des relances (filtre
        // draftStatus='invoice_sent') et n'était plus jamais relancé.
        const patch: {
          draftStatus?: string;
          paidOrderId?: string;
          totalPrice?: string;
        } = {};
        if (status !== null && status !== q.draftStatus) patch.draftStatus = status;
        if (orderId !== null && orderId !== q.paidOrderId) patch.paidOrderId = orderId;
        if (total !== null && total !== q.totalPrice) patch.totalPrice = total;

        if (Object.keys(patch).length > 0) {
          await this.quotes.update(q.id, patch);
          updated++;
        }
      } catch (e) {
        this.logger.warn(
          `Statut du devis ${q.id} non synchronisé : ${(e as Error).message}`,
        );
      }
    }

    if (updated) {
      this.logger.log(
        `Synchro devis (${reason}) : ${updated} statut(s) mis à jour.`,
      );
    }
    return { updated };
  }

  /**
   * Cree une demande de devis :
   *  - draft order Shopify (visible dans Admin > Commandes > Brouillons)
   *
   * Le draft est "best effort" : la demande est toujours enregistree et la
   * reponse HTTP part immediatement.
   *
   * Aucun e-mail n'est emis ici : toute la correspondance client passe
   * desormais par Shopify (facture du draft order, relances, expedition).
   * L'equipe suit les nouveaux devis via le dashboard (compteurs « nouveau »).
   */
  async create(
    dto: CreateQuoteDto,
  ): Promise<{ success: boolean; quoteId: string }> {
    const quoteId = randomUUID();

    // On enregistre TOUJOURS la demande en base, même si Shopify échoue.
    await this.quotes.save(
      this.quotes.create({
        id: quoteId,
        quoteData: dto as unknown as Record<string, unknown>,
      }),
    );

    // Draft order Shopify APRÈS avoir répondu au client
    // (setImmediate détache le traitement de la requête HTTP courante).
    setImmediate(() => {
      void this.processQuoteBestEffort(dto, quoteId);
    });

    return { success: true, quoteId };
  }

  /** Crée le draft order Shopify sans bloquer la réponse. */
  private async processQuoteBestEffort(
    dto: CreateQuoteDto,
    quoteId: string,
  ): Promise<void> {
    // 1) Draft order Shopify (devis visible dans l'admin)
    try {
      const draftOrder = await this.shopify.createDraftOrder(
        this.buildDraftPayload(dto, quoteId),
      );
      // Mémorise l'ID du draft order sur la ligne du devis en base.
      await this.quotes.update(quoteId, {
        draftOrderId: String(draftOrder.id),
      });
      this.logger.log(
        `Devis ${quoteId} -> draft order Shopify #${draftOrder.id}`,
      );
    } catch (error) {
      // Marque le devis en échec : sans `draftOrderId`, il n'entrerait jamais
      // dans le flux de facturation/relance. `retryOrphanQuotes()` le rattrape
      // au prochain passage du cron ; le statut le rend aussi visible au
      // dashboard au lieu d'un simple log perdu.
      await this.quotes
        .update(quoteId, { draftStatus: 'failed' })
        .catch(() => undefined);
      this.logger.warn(
        `Devis ${quoteId} : draft order Shopify non créé: ${(error as Error).message}. ` +
          `Sera réessayé automatiquement.`,
      );
    }
  }

  /**
   * Rattrape les devis restés sans brouillon Shopify (Shopify en panne au
   * moment de la création). On rejoue `createDraftOrder` à partir du DTO
   * original conservé dans `quoteData`.
   *
   * Ne prend que les devis de plus de 5 min, pour ne pas entrer en collision
   * avec le traitement `setImmediate` d'un devis qui vient d'être créé.
   */
  async retryOrphanQuotes(): Promise<{ retried: number }> {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    let orphans: Quote[] = [];
    try {
      orphans = await this.quotes.find({
        where: { draftOrderId: IsNull(), createdAt: LessThan(cutoff) },
        take: 25, // borne : on rattrape par lots, pas tout d'un coup
      });
    } catch (e) {
      this.logger.warn(
        `Lecture des devis orphelins impossible : ${(e as Error).message}`,
      );
      return { retried: 0 };
    }

    let retried = 0;
    for (const q of orphans) {
      try {
        const dto = q.quoteData as unknown as CreateQuoteDto;
        const draftOrder = await this.shopify.createDraftOrder(
          this.buildDraftPayload(dto, q.id),
        );
        // Draft créé : on repart d'un statut neutre, syncStatuses fera le reste.
        await this.quotes.update(q.id, {
          draftOrderId: String(draftOrder.id),
          draftStatus: null,
        });
        this.logger.log(
          `Devis orphelin ${q.id} rattrapé -> draft order #${draftOrder.id}`,
        );
        retried++;
      } catch (e) {
        this.logger.warn(
          `Devis orphelin ${q.id} : nouvel échec de création, réessai plus tard : ${(e as Error).message}`,
        );
      }
    }
    if (retried) {
      this.logger.log(`Devis orphelins rattrapés : ${retried}.`);
    }
    return { retried };
  }

  /** Construit le payload du draft order Shopify à partir du devis. */
  private buildDraftPayload(
    dto: CreateQuoteDto,
    quoteId: string,
  ): CreateDraftOrderPayload {
    const { customer, coin } = dto;

    // Propriétés visibles sur la ligne du brouillon : détails du coin,
    // référence devis, et URLs des aperçus (recto/verso/côté).
    const properties: Array<{ name: string; value: string }> = [];
    properties.push({ name: 'Référence devis', value: quoteId });
    coin.details.forEach((d, i) => {
      properties.push({ name: `Détail ${i + 1}`, value: d });
    });
    coin.previews.forEach((p) => {
      if (p.base) properties.push({ name: `Aperçu ${p.label}`, value: p.base });
      if (p.logo) properties.push({ name: `Logo ${p.label}`, value: p.logo });
    });

    // Le formulaire de devis n'a qu'un champ "nom complet" : on le découpe.
    const parts = (customer.nom || '').trim().split(/\s+/);
    const firstName = parts.shift() || customer.nom;
    const lastName = parts.join(' ') || undefined;

    const noteLines = [
      'DEMANDE DE DEVIS (prix à définir)',
      `Référence : ${quoteId}`,
      customer.entreprise ? `Entreprise : ${customer.entreprise}` : null,
      customer.telephone ? `Téléphone : ${customer.telephone}` : null,
      customer.message ? `Message : ${customer.message}` : null,
    ].filter(Boolean);

    // Commande de GROUPE (textiles) : une ligne de brouillon par personne, pour
    // que l'atelier voie chaque taille / couleur / nom floqué. Sinon (coin,
    // patch…), une seule ligne comme avant.
    const group = dto.group;
    let lineItems: CreateDraftOrderPayload['line_items'];
    let tags = 'devis, coins, configurateur';

    if (group && Array.isArray(group.rows) && group.rows.length) {
      // URLs des aperçus/logos du design : communes à tout le groupe. Sans les
      // rattacher, une commande de groupe ne portait AUCUNE URL d'aperçu — ni
      // dans le brouillon Shopify, ni dans le ZIP de production de l'atelier
      // (buildAndSendZip ne collecte que les propriétés en http(s)). On les
      // met sur la première ligne, seul endroit nécessaire pour que le ZIP les
      // retrouve.
      const previewProps: Array<{ name: string; value: string }> = [];
      coin.previews.forEach((p) => {
        if (p.base) previewProps.push({ name: `Aperçu ${p.label}`, value: p.base });
        if (p.logo) previewProps.push({ name: `Logo ${p.label}`, value: p.logo });
      });

      lineItems = group.rows.map((r, i) => {
        const props: Array<{ name: string; value: string }> = [
          { name: 'Taille', value: r.size },
          { name: 'Couleur', value: r.color },
        ];
        if (r.name) props.push({ name: 'Nom / réf.', value: r.name });
        if (r.flock) props.push({ name: 'Floquage', value: r.flock });
        props.push({ name: 'Référence devis', value: quoteId });
        if (i === 0) props.push(...previewProps);
        return {
          title: `${group.productLabel || 'Textile'} — ${r.size} / ${r.color}`,
          price: '0.00', // devis : prix défini par l'équipe
          quantity: r.qty,
          custom: true,
          properties: props,
        };
      });
      tags = 'devis, groupe, textile, configurateur';
    } else {
      lineItems = [
        {
          title: coin.name,
          price: '0.00',
          quantity: coin.qty,
          custom: true,
          properties: properties.length ? properties : undefined,
        },
      ];
    }

    // En-tête de note enrichi pour une commande de groupe.
    if (group) {
      noteLines.unshift(
        `COMMANDE DE GROUPE — ${group.productLabel || 'Textile'} · ` +
          `${group.pieces} pièce(s)` +
          (group.hasFlock ? ' · avec flocage (à chiffrer)' : ''),
      );
    }

    return {
      line_items: lineItems,
      customer: {
        email: customer.email,
        first_name: firstName,
        last_name: lastName,
        phone: customer.telephone,
      },
      email: customer.email,
      note: noteLines.join('\n'),
      tags,
    };
  }

  /** Liste des devis en base (pour le futur dashboard admin — étape 3). */
  async findAll(): Promise<Quote[]> {
    return this.quotes.find({ order: { createdAt: 'DESC' } });
  }
}
