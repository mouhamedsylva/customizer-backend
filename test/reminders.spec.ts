import { RemindersService } from '../src/quotes/reminders.service';
import type { Repository } from 'typeorm';
import type { Quote } from '../src/database/entities/quote.entity';
import type { ShopifyService } from '../src/shared/shopify.service';
import type { SettingsService } from '../src/admin/settings.service';

/**
 * Relances automatiques des devis impayés.
 *
 * C'est le SEUL flux qui écrit spontanément à un client, sans action humaine.
 * Une erreur ici se traduit par un e-mail de relance envoyé à quelqu'un qui a
 * déjà payé, ou par une rafale de messages — le genre de défaut qu'on découvre
 * par une réclamation.
 */
const JOUR = 86_400_000;

function build(opts: {
  reminderEnabled?: boolean;
  reminderDays?: number[];
  quotes?: Partial<Quote>[];
  settingsThrows?: boolean;
  onSend?: (id: string) => void;
}) {
  const envois: string[] = [];
  const settings = {
    get: async () => {
      if (opts.settingsThrows) throw new Error('ECONNREFUSED mysql');
      return {
        reminderEnabled: opts.reminderEnabled ?? true,
        reminderDays: opts.reminderDays ?? [3, 7, 14],
      };
    },
  } as unknown as SettingsService;

  const shopify = {
    sendDraftOrderInvoice: async (id: string) => {
      envois.push(String(id));
      return {};
    },
  } as unknown as ShopifyService;

  const repo = {
    find: async () => (opts.quotes || []) as Quote[],
    update: async () => ({ affected: 1 }),
  } as unknown as Repository<Quote>;

  return { service: new RemindersService(shopify, settings, repo), envois };
}

function devis(p: Partial<Quote>): Partial<Quote> {
  return {
    id: 'q1',
    draftOrderId: '999',
    draftStatus: 'invoice_sent',
    remindersSent: 0,
    lastReminderAt: null,
    quoteData: { customer: { email: 'client@x.fr', nom: 'Dupont' } },
    ...p,
  };
}

describe('RemindersService.run', () => {
  it('ne relance rien quand la fonctionnalité est désactivée', async () => {
    const { service, envois } = build({
      reminderEnabled: false,
      quotes: [devis({ invoiceSentAt: new Date(Date.now() - 30 * JOUR) })],
    });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('ne relance pas avant le premier palier', async () => {
    const { service, envois } = build({
      quotes: [devis({ invoiceSentAt: new Date(Date.now() - 2 * JOUR) })],
    });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('relance une fois le palier franchi', async () => {
    const { service, envois } = build({
      quotes: [devis({ invoiceSentAt: new Date(Date.now() - 4 * JOUR) })],
    });
    await service.run('test');
    expect(envois).toEqual(['999']);
  });

  it('respecte le délai de 20 h entre deux relances', async () => {
    const { service, envois } = build({
      quotes: [
        devis({
          invoiceSentAt: new Date(Date.now() - 30 * JOUR),
          remindersSent: 1,
          lastReminderAt: new Date(Date.now() - 3600_000), // il y a 1 h
        }),
      ],
    });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('cesse de relancer une fois tous les paliers épuisés', async () => {
    const { service, envois } = build({
      quotes: [
        devis({
          invoiceSentAt: new Date(Date.now() - 90 * JOUR),
          remindersSent: 3, // [3,7,14] -> les trois sont passés
          lastReminderAt: new Date(Date.now() - 30 * JOUR),
        }),
      ],
    });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('ne relance pas un devis sans date de facturation', async () => {
    const { service, envois } = build({ quotes: [devis({ invoiceSentAt: null })] });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('ne relance pas si la date de facture est dans le futur (horloge décalée)', async () => {
    const { service, envois } = build({
      quotes: [devis({ invoiceSentAt: new Date(Date.now() + 5 * JOUR) })],
    });
    await service.run('test');
    expect(envois).toHaveLength(0);
  });

  it('NE LÈVE PAS quand la base est indisponible', async () => {
    // `run()` est appelée en `void this.run(...)` depuis un timer : un rejet
    // non capturé arrêtait le process Node entier — configurateur et webhooks
    // compris — à cause d'une simple coupure MySQL.
    const { service } = build({ settingsThrows: true });
    await expect(service.run('test')).resolves.toEqual({ sent: 0 });
  });
});
