import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { Quote } from '../database/entities/quote.entity';
import { ShopifyService } from '../shared/shopify.service';
import { SettingsService } from '../admin/settings.service';
import { MessageTemplateService } from '../admin/message-template.service';

/**
 * Devis examinés par passe de relance.
 *
 * Une relance = un appel Shopify + un e-mail RÉEL au client. Le lot est borné
 * pour que la passe reste courte et, surtout, pour qu'aucun défaut de données
 * ne puisse déclencher une rafale de messages. Le reliquat est traité à la
 * passe suivante (toutes les heures), les plus en retard d'abord.
 */
const REMINDER_BATCH = 200;

/**
 * Relance automatique des devis facturés mais impayés.
 *
 * Le rythme est défini par l'équipe dans le dashboard (ex. J+3, J+7, J+14).
 * Garde-fous :
 *  - un devis payé n'est jamais relancé ;
 *  - une seule relance par palier (compteur `remindersSent`) ;
 *  - au maximum une relance par jour et par devis.
 */
@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;
  /** Première passe différée : annulée si l'app s'arrête avant son échéance. */
  private startTimer?: NodeJS.Timeout;

  constructor(
    private readonly shopify: ShopifyService,
    private readonly settings: SettingsService,
    private readonly messageTemplates: MessageTemplateService,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
  ) {}

  onModuleInit(): void {
    // Première passe peu après le démarrage, puis toutes les heures.
    this.startTimer = setTimeout(() => void this.run('démarrage'), 30000);
    this.timer = setInterval(() => void this.run('périodique'), 60 * 60 * 1000);
  }

  /**
   * Le `setTimeout` initial est annulé, pas seulement l'intervalle.
   *
   * Son handle n'était pas conservé : sur un arrêt survenant avant son
   * échéance — un `docker compose restart` prend souvent moins de 30 s — il se
   * déclenchait APRÈS la fermeture du pool TypeORM, sur une application déjà
   * détruite.
   */
  onModuleDestroy(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Parcourt les devis à relancer et envoie ce qui est dû.
   * Ne lève jamais : une panne Shopify ne doit pas arrêter le backend.
   */
  async run(reason = 'manuel'): Promise<{ sent: number }> {
    // La lecture des réglages est DANS le try, comme celle des devis juste en
    // dessous. Elle ne l'était pas : `settings.get()` fait un `find()` qui
    // rejette si MySQL est indisponible, et `run()` est appelée via
    // `void this.run(...)` depuis un timer — le rejet n'avait aucun récepteur.
    // Sans gestionnaire `unhandledRejection`, Node arrête alors le process :
    // un simple redémarrage de la base faisait tomber TOUT le backend
    // (configurateur, webhooks, dashboard) à cause des relances, une
    // fonctionnalité secondaire souvent désactivée.
    let cfg: Awaited<ReturnType<SettingsService['get']>>;
    try {
      cfg = await this.settings.get();
    } catch (e) {
      this.logger.warn(
        `Réglages de relance illisibles : ${(e as Error).message}`,
      );
      return { sent: 0 };
    }
    if (!cfg.reminderEnabled || !cfg.reminderDays.length) return { sent: 0 };

    let candidates: Quote[] = [];
    try {
      candidates = await this.quotes.find({
        where: { draftStatus: 'invoice_sent', invoiceSentAt: Not(IsNull()) },
        // Plafond : chaque relance déclenche un appel Shopify ET un e-mail
        // RÉEL au client. Un lot borné limite autant la pression sur l'API que
        // le risque d'une rafale de messages si un défaut de données rendait
        // soudainement des centaines de devis « à relancer ».
        take: REMINDER_BATCH,
        // Les plus anciennement facturés d'abord : ce sont les plus en retard.
        order: { invoiceSentAt: 'ASC' },
      });
    } catch (e) {
      this.logger.warn(`Lecture des devis impossible : ${(e as Error).message}`);
      return { sent: 0 };
    }

    let sent = 0;
    for (const q of candidates) {
      const due = this.reminderDue(q, cfg.reminderDays);
      if (!due) continue;

      /* DERNIER CONTRÔLE AVANT ENVOI : le devis a-t-il été payé entre-temps ?
         `draftStatus` vient de la synchro périodique (quotes.service.ts), qui
         ne passe que toutes les 10 minutes et peut échouer durablement sur un
         devis — un `getDraftOrder` en erreur laisse le statut à
         'invoice_sent' indéfiniment. La sélection ci-dessus se fiant à ce seul
         champ, un client AYANT DÉJÀ PAYÉ recevait « votre devis est en attente
         de paiement » à J+3, J+7 puis J+14.

         Le garde de admin.controller.ts ne couvre que le bouton manuel : cette
         boucle automatique n'avait aucune protection équivalente.

         Un appel de plus par relance seulement — pas par devis examiné : on est
         déjà après `reminderDue`, donc sur le point d'envoyer un e-mail réel.
         Au regard d'un message erroné à un client payant, le coût est nul. */
      if (await this.dejaPaye(q)) continue;

      try {
        await this.sendReminder(q, due.index);
        await this.quotes.update(q.id, {
          remindersSent: due.index,
          lastReminderAt: new Date(),
        });
        sent++;
      } catch (e) {
        this.logger.warn(
          `Relance du devis ${q.id} échouée : ${(e as Error).message}`,
        );
      }
    }

    if (sent) {
      this.logger.log(`Relances (${reason}) : ${sent} devis relancé(s).`);
    }
    return { sent };
  }

  /**
   * Le devis a-t-il été payé depuis l'envoi de la facture ?
   *
   * Interroge Shopify, seule source de vérité : `draftStatus` en base peut
   * dater de 10 minutes, ou n'avoir jamais été rafraîchi si la synchro échoue
   * sur ce devis précis.
   *
   * En cas de doute, on RELANCE. Un e-mail de trop sur un devis impayé est
   * gênant ; ne jamais relancer un client réellement en retard coûterait la
   * vente. C'est pourquoi une panne Shopify renvoie `false` et non `true`.
   *
   * Effet de bord utile : quand le paiement est constaté ici, le statut est
   * corrigé en base dans la foulée. Le devis sort donc du périmètre des
   * relances sans attendre la prochaine synchro, et quitte l'onglet Devis.
   */
  private async dejaPaye(q: Quote): Promise<boolean> {
    if (!q.draftOrderId) return false;

    try {
      const draft = await this.shopify.getDraftOrder(q.draftOrderId);
      const statut = (draft?.status as string) ?? null;
      if (statut !== 'completed') return false;

      /* Même prudence que quotes.service.ts : on n'écrit un champ que s'il est
         réellement renseigné, pour ne jamais effacer une valeur acquise avec
         une réponse Shopify partielle. */
      const patch: {
        draftStatus: string;
        paidOrderId?: string;
        totalPrice?: string;
      } = { draftStatus: 'completed' };
      if (draft?.order_id) patch.paidOrderId = String(draft.order_id);
      if (draft?.total_price) patch.totalPrice = String(draft.total_price);

      await this.quotes.update(q.id, patch);
      this.logger.log(
        `Relance du devis ${q.id} annulée : il a été payé entre-temps. ` +
          'Statut corrigé en base.',
      );
      return true;
    } catch (e) {
      /* Shopify injoignable : on ne bloque pas la relance (cf. ci-dessus). */
      this.logger.warn(
        `Paiement du devis ${q.id} non vérifiable avant relance : ` +
          `${(e as Error).message}. La relance est maintenue.`,
      );
      return false;
    }
  }

  /**
   * Détermine si une relance est due, et laquelle.
   * Renvoie { index } = numéro de la relance à envoyer (1re, 2e…), ou null.
   */
  private reminderDue(
    q: Quote,
    days: number[],
  ): { index: number; day: number } | null {
    if (!q.invoiceSentAt) return null;

    // Palier suivant à franchir (0 relance envoyée -> palier 1).
    const nextIndex = (q.remindersSent || 0) + 1;
    if (nextIndex > days.length) return null; // tous les paliers sont passés

    const dayThreshold = days[nextIndex - 1];
    const elapsed = Math.floor(
      (Date.now() - new Date(q.invoiceSentAt).getTime()) / 86400000,
    );
    if (elapsed < dayThreshold) return null;

    // Sécurité : pas plus d'une relance par 24 h.
    if (q.lastReminderAt) {
      const since = Date.now() - new Date(q.lastReminderAt).getTime();
      if (since < 20 * 3600000) return null;
    }

    return { index: nextIndex, day: dayThreshold };
  }

  /** Renvoie la facture Shopify avec un message de relance. */
  private async sendReminder(q: Quote, index: number): Promise<void> {
    const data = (q.quoteData || {}) as Record<string, any>;
    const customer = data.customer || {};
    const productName = data.coin?.name || 'votre commande personnalisée';

    // Essaie d'utiliser un template personnalisé
    let customMessage: string;
    try {
      // Génère le message de relance personnalisé
      const template = await this.messageTemplates.getDefaultTemplate('reminder');
      if (template) {
        customMessage = this.messageTemplates.replaceVariables(template.content, {
          nom: customer.nom,
          produit: productName,
          quantite: data.coin?.qty,
          total: q.totalPrice ? `${q.totalPrice} €` : undefined,
          entreprise: customer.entreprise
        });
      } else {
        throw new Error('Aucun template de relance configuré');
      }
    } catch (error) {
      // Fallback vers l'ancien message codé en dur
      const intro =
        index === 1
          ? `Nous revenons vers vous au sujet de votre devis pour ${productName}, qui reste en attente de règlement.`
          : `Sauf erreur de notre part, votre devis pour ${productName} n'a pas encore été réglé.`;

      customMessage = `Bonjour ${customer.nom || ''},\n\n` +
        `${intro}\n\n` +
        `Vous pouvez le régler directement via le lien ci-dessous. ` +
        `N'hésitez pas à nous écrire si vous avez la moindre question.\n\n` +
        `Bien cordialement,\nL'équipe Custom Textile`;
    }

    await this.shopify.sendDraftOrderInvoice(q.draftOrderId as string, {
      to: customer.email,
      subject: `Relance — votre devis ${productName}`,
      custom_message: customMessage,
    });
  }
}
