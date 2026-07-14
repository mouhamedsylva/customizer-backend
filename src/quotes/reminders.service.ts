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

  constructor(
    private readonly shopify: ShopifyService,
    private readonly settings: SettingsService,
    @InjectRepository(Quote)
    private readonly quotes: Repository<Quote>,
  ) {}

  onModuleInit(): void {
    // Première passe peu après le démarrage, puis toutes les heures.
    setTimeout(() => void this.run('démarrage'), 30000);
    this.timer = setInterval(() => void this.run('périodique'), 60 * 60 * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Parcourt les devis à relancer et envoie ce qui est dû.
   * Ne lève jamais : une panne Shopify ne doit pas arrêter le backend.
   */
  async run(reason = 'manuel'): Promise<{ sent: number }> {
    const cfg = await this.settings.get();
    if (!cfg.reminderEnabled || !cfg.reminderDays.length) return { sent: 0 };

    let candidates: Quote[] = [];
    try {
      candidates = await this.quotes.find({
        where: { draftStatus: 'invoice_sent', invoiceSentAt: Not(IsNull()) },
      });
    } catch (e) {
      this.logger.warn(`Lecture des devis impossible : ${(e as Error).message}`);
      return { sent: 0 };
    }

    let sent = 0;
    for (const q of candidates) {
      const due = this.reminderDue(q, cfg.reminderDays);
      if (!due) continue;

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

    const intro =
      index === 1
        ? `Nous revenons vers vous au sujet de votre devis pour ${productName}, qui reste en attente de règlement.`
        : `Sauf erreur de notre part, votre devis pour ${productName} n'a pas encore été réglé.`;

    await this.shopify.sendDraftOrderInvoice(q.draftOrderId as string, {
      to: customer.email,
      subject: `Relance — votre devis ${productName}`,
      custom_message:
        `Bonjour ${customer.nom || ''},\n\n` +
        `${intro}\n\n` +
        `Vous pouvez le régler directement via le lien ci-dessous. ` +
        `N'hésitez pas à nous écrire si vous avez la moindre question.\n\n` +
        `Bien cordialement,\nL'équipe Custom Textile`,
    });
  }
}
