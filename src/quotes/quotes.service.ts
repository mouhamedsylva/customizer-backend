import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { EmailService, QuoteEmailData } from '../shared/email.service';
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
    private readonly email: EmailService,
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

        if (
          status !== q.draftStatus ||
          orderId !== q.paidOrderId ||
          total !== q.totalPrice
        ) {
          await this.quotes.update(q.id, {
            draftStatus: status,
            paidOrderId: orderId,
            totalPrice: total,
          });
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
   *  - email a l'equipe + accuse de reception au client
   * Le draft et les emails sont "best effort" : la demande est toujours
   * enregistree et la reponse HTTP part immediatement.
   */
  async create(
    dto: CreateQuoteDto,
  ): Promise<{ success: boolean; quoteId: string }> {
    const quoteId = randomUUID();

    const emailData: QuoteEmailData = {
      customerName: dto.customer.nom,
      email: dto.customer.email,
      telephone: dto.customer.telephone,
      entreprise: dto.customer.entreprise,
      message: dto.customer.message,
      coinName: dto.coin.name,
      details: dto.coin.details,
      qty: dto.coin.qty,
      previews: dto.coin.previews,
      quoteId,
    };

    // On enregistre TOUJOURS la demande en base, même si l'email/Shopify échoue.
    await this.quotes.save(
      this.quotes.create({
        id: quoteId,
        quoteData: dto as unknown as Record<string, unknown>,
      }),
    );

    // Draft order Shopify puis emails, APRÈS avoir répondu au client
    // (setImmediate détache le traitement de la requête HTTP courante).
    setImmediate(() => {
      void this.processQuoteBestEffort(dto, quoteId, emailData);
    });

    return { success: true, quoteId };
  }

  /** Crée le draft order Shopify puis envoie les emails, sans bloquer la réponse. */
  private async processQuoteBestEffort(
    dto: CreateQuoteDto,
    quoteId: string,
    emailData: QuoteEmailData,
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
      this.logger.warn(
        `Devis ${quoteId} : draft order Shopify non créé: ${(error as Error).message}`,
      );
    }

    // 2) Emails (équipe + accusé client)
    await this.sendEmailsBestEffort(dto.customer.email, emailData);
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
      lineItems = group.rows.map((r) => {
        const props: Array<{ name: string; value: string }> = [
          { name: 'Taille', value: r.size },
          { name: 'Couleur', value: r.color },
        ];
        if (r.name) props.push({ name: 'Nom / réf.', value: r.name });
        if (r.flock) props.push({ name: 'Floquage', value: r.flock });
        props.push({ name: 'Référence devis', value: quoteId });
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

  /** Envoie l'email équipe + accusé client sans bloquer la réponse HTTP. */
  private async sendEmailsBestEffort(
    clientEmail: string,
    emailData: QuoteEmailData,
  ): Promise<void> {
    try {
      await this.email.sendQuoteEmail(emailData);
    } catch (error) {
      this.logger.warn(`Email équipe non envoyé: ${(error as Error).message}`);
    }
    try {
      await this.email.sendQuoteAck(clientEmail, emailData);
    } catch (error) {
      this.logger.warn(`Accusé de réception non envoyé: ${(error as Error).message}`);
    }
  }

  /** Liste des devis en base (pour le futur dashboard admin — étape 3). */
  async findAll(): Promise<Quote[]> {
    return this.quotes.find({ order: { createdAt: 'DESC' } });
  }
}
