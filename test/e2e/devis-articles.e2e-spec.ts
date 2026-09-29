import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Quote } from '../../src/database/entities/quote.entity';

/**
 * Envoi de la facture d'un devis multi-articles, chiffré ARTICLE PAR ARTICLE.
 */
describe('POST /api/admin/quotes/:id/invoice — prix par article', () => {
  let h: Harness;
  let cookie = '';
  const srv = () => h.app.getHttpServer();
  const ID = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
    h.shopify.reset();
    const r = await request(srv())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
    const set = r.headers['set-cookie'];
    cookie = (Array.isArray(set) ? set : [set]).map((c: string) => c.split(';')[0]).join('; ');
    await h.app.get(DataSource).getRepository(Quote).save({
      id: ID,
      draftOrderId: '1577212870990',
      draftStatus: 'open',
      quoteData: {
        customer: { nom: 'Guillermain', email: 'client@exemple.fr' },
        coin: {
          name: 'Commande sur devis (3 articles)',
          qty: 70,
          details: [
            'Commande sur devis : 2 famille(s), 3 ligne(s), 70 pièce(s).',
            '10× Patch personnalisé — Rond',
            '10× Patch personnalisé — Rond',
            '50× Coin métal — Recto verso',
          ],
        },
      },
    } as Partial<Quote>);
  });

  const envoyer = (corps: Record<string, unknown>) =>
    request(srv()).post(`/api/admin/quotes/${ID}/invoice`).set('Cookie', cookie).send({
      unitPrice: 10,
      message: 'Bonjour',
      taxesIncluses: true,
      ...corps,
    });

  it('applique un prix à chaque article, dans l’ordre', async () => {
    await envoyer({ prixParArticle: [4.2, 3.9, 12] });
    const appels = h.shopify.callsTo('setDraftOrderArticles');
    expect(appels).toHaveLength(1);
    const [, articles, prix] = appels[0].args as [unknown, Array<{ qty: number }>, number[]];
    expect(articles.map((a) => a.qty)).toEqual([10, 10, 50]);
    expect(prix).toEqual([4.2, 3.9, 12]);
    expect(h.shopify.callsTo('setDraftOrderPrice')).toHaveLength(0);
  });

  it('refuse un article sans prix', async () => {
    const r = await envoyer({ prixParArticle: [4.2, 0, 12] });
    expect(r.status).toBe(400);
    expect(r.body.error).toContain("l'article 2");
    expect(h.shopify.callsTo('setDraftOrderArticles')).toHaveLength(0);
  });

  it('refuse une liste de prix qui ne correspond plus aux articles', async () => {
    const r = await envoyer({ prixParArticle: [4.2, 12] });
    expect(r.status).toBe(400);
    expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(0);
  });
});

describe('POST /api/admin/quotes/:id/invoice — garde-fou sur le montant', () => {
  let h: Harness;
  let cookie = '';
  const ID = '99999999-2222-3333-4444-555555555555';

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
    h.shopify.reset();
    const r = await request(h.app.getHttpServer())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
    const set = r.headers['set-cookie'];
    cookie = (Array.isArray(set) ? set : [set]).map((c: string) => c.split(';')[0]).join('; ');
    await h.app.get(DataSource).getRepository(Quote).save({
      id: ID,
      draftOrderId: '1',
      draftStatus: 'open',
      quoteData: { customer: { nom: 'Client', email: 'c@exemple.fr' }, coin: { name: 'Coins', qty: 50 } },
    } as Partial<Quote>);
  });

  const envoyer = (totalAffiche?: number) =>
    request(h.app.getHttpServer())
      .post(`/api/admin/quotes/${ID}/invoice`)
      .set('Cookie', cookie)
      .send({ unitPrice: 12.5, message: 'Bonjour', taxesIncluses: false, totalAffiche });

  it('refuse d’envoyer quand Shopify facturerait un autre montant que celui affiché', async () => {
    // Le faux Shopify facture le prix sans taxe (12,50 €) ; la fenêtre affichait autre chose.
    const r = await envoyer(750);
    expect(r.status).toBe(409);
    expect(r.body.ecartTva).toBe(true);
    expect(r.body.error).toContain('750,00 €');
    expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(0);
    // Le prix refusé ne reste pas sur le brouillon : lignes d'avant remises.
    const restaure = h.shopify.callsTo('restaurerLignes');
    expect(restaure).toHaveLength(1);
    expect(restaure[0].args[1]).toEqual([{ id: 1, variant_id: 42, quantity: 2, properties: [] }]);
  });

  it('envoie quand le montant affiché est bien celui facturé', async () => {
    const r = await envoyer(12.5);
    expect(r.body.ok).toBe(true);
    expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(1);
    expect(h.shopify.callsTo('restaurerLignes')).toHaveLength(0);
  });

  it('ancienne page (sans totalAffiche) : comportement d’avant', async () => {
    const r = await envoyer(undefined);
    expect(r.body.ok).toBe(true);
  });
});
