import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Quote } from '../../src/database/entities/quote.entity';

/**
 * Envoi de la facture avec des ARTICLES AJOUTÉS par l'admin depuis la
 * fenêtre de chiffrage (libellé libre, design optionnel).
 */
describe('POST /api/admin/quotes/:id/invoice — articles ajoutés', () => {
  let h: Harness;
  let cookie = '';
  const ID = '22222222-3333-4444-5555-666666666666';
  const DESIGN = { name: 'logo.png', url: 'https://res.cloudinary.com/x/image/upload/v1/customizer/commandes/devis-x/logo.png', type: 'image/png' };
  const repo = () => h.app.get(DataSource).getRepository(Quote);

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
    // Devis à PRODUIT UNIQUE : aucune ligne « N× » dans le détail.
    await repo().save({
      id: ID,
      draftOrderId: '1577212870991',
      draftStatus: 'open',
      quoteData: {
        customer: { nom: 'Client', email: 'client@exemple.fr' },
        coin: { name: 'Coin métal personnalisé', qty: 50, details: ['Face : logo', 'Finition : or'] },
      },
    } as Partial<Quote>);
  });

  const envoyer = (corps: Record<string, unknown>) =>
    request(h.app.getHttpServer())
      .post(`/api/admin/quotes/${ID}/invoice`)
      .set('Cookie', cookie)
      .send({ unitPrice: 10, message: 'Bonjour', taxesIncluses: true, ...corps });

  const ajout = { libelle: 'Patch brodé', options: 'Noir', qty: 20, fichier: DESIGN };

  it('ajoute l’article au devis et au brouillon, avec son design', async () => {
    const r = await envoyer({ prixParArticle: [12, 3.5], articlesAjoutes: [ajout] });
    expect(r.body.ok).toBe(true);
    const [, articles, prix] = h.shopify.callsTo('setDraftOrderArticles')[0].args as [unknown, any[], number[]];
    expect(articles.map((a) => [a.libelle, a.qty])).toEqual([['Coin métal personnalisé', 50], ['Patch brodé', 20]]);
    expect(articles[0].fichier).toBeUndefined();
    expect(articles[1].fichier).toEqual(DESIGN);
    expect(prix).toEqual([12, 3.5]);
    const data = (await repo().findOneByOrFail({ id: ID })).quoteData as any;
    expect(data.coin.qty).toBe(70);
    expect(data.articlesAjoutes[0]).toMatchObject({ libelle: 'Patch brodé', admin: 'patron@test.fr', fichier: DESIGN });
  });

  it('refuse une liste de prix sans le prix de l’article ajouté', async () => {
    const r = await envoyer({ prixParArticle: [12], articlesAjoutes: [ajout] });
    expect(r.status).toBe(400);
    expect(((await repo().findOneByOrFail({ id: ID })).quoteData as any).coin.qty).toBe(50);
    expect(h.shopify.callsTo('setDraftOrderArticles')).toHaveLength(0);
  });

  it('refuse un article ajouté sans nom', async () => {
    const r = await envoyer({ prixParArticle: [12, 3], articlesAjoutes: [{ libelle: ' ', qty: 2 }] });
    expect(r.status).toBe(400);
  });

  it('défait l’ajout si le garde-fou sur le montant bloque l’envoi', async () => {
    const r = await envoyer({ prixParArticle: [12, 3.5], articlesAjoutes: [ajout], totalAffiche: 1 });
    expect(r.status).toBe(409);
    const data = (await repo().findOneByOrFail({ id: ID })).quoteData as any;
    expect(data.coin.qty).toBe(50);
    expect(data.articlesAjoutes).toBeUndefined();
    expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(0);
  });

  it('devis à produit unique chiffré « par article » : quantité corrigée, une ligne', async () => {
    const r = await envoyer({ prixParArticle: [12], quantites: [30] });
    expect(r.body.ok).toBe(true);
    const [, articles, prix] = h.shopify.callsTo('setDraftOrderArticles')[0].args as [unknown, any[], number[]];
    expect(articles.map((a) => [a.libelle, a.qty])).toEqual([['Coin métal personnalisé', 30]]);
    expect(prix).toEqual([12]);
    expect(((await repo().findOneByOrFail({ id: ID })).quoteData as any).coin.qty).toBe(30);
  });
});
