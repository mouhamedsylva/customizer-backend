import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Order } from '../../src/database/entities/order.entity';
import { WebhooksService } from '../../src/webhooks/webhooks.service';

/** Commandes saisies à la main par l'admin (reçues par e-mail, hors boutique). */
describe('Commandes manuelles', () => {
  let h: Harness;
  const srv = () => h.app.getHttpServer();
  const repo = () => h.app.get(DataSource).getRepository(Order);

  async function connexion(): Promise<string> {
    const r = await request(srv())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
    const set = r.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    return cookies.map((c: string) => c.split(';')[0]).join('; ');
  }

  const saisie = (p: Record<string, unknown> = {}) => ({
    client: { nom: 'Lucas Julien', email: 'lucas@exemple.fr' },
    articles: [{ titre: 'Patch personnalisé (PVC)', quantite: 250, details: 'Taille : 8 cm' }],
    total: '960',
    mode: 'facture',
    note: 'Reçue par e-mail',
    ...p,
  });

  const post = (url: string, cookie: string | null, body: unknown) => {
    const r = request(srv()).post(url).set('X-Forwarded-For', freshIp());
    if (cookie) r.set('Cookie', cookie);
    return r.send(body as object);
  };

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
    h.shopify.reset?.();
  });

  it('refuse la création sans session', async () => {
    expect((await post('/api/admin/orders/manuelles', null, saisie())).status).toBe(401);
    expect(await repo().count()).toBe(0);
  });

  it('crée des commandes numérotées M-1001, M-1002, visibles dans le dashboard', async () => {
    const cookie = await connexion();
    const a = await post('/api/admin/orders/manuelles', cookie, saisie());
    expect(a.status).toBe(201);
    expect(a.body).toEqual({ ok: true, id: '-1' });
    const b = await post('/api/admin/orders/manuelles', cookie, saisie({ client: { nom: 'Autre client', email: 'autre@exemple.fr' } }));
    expect(b.body.id).toBe('-2');

    const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
    expect(o).toMatchObject({
      orderNumber: 'M-1001',
      fromConfigurator: true,
      financialStatus: 'pending',
      totalPrice: '960.00',
      internalNote: 'Reçue par e-mail',
      productionStatus: 'to_produce',
    });

    const page = await request(srv()).get('/api/admin').set('X-Forwarded-For', freshIp()).set('Cookie', cookie);
    expect(page.text).toContain('M-1001');
    expect(page.text).toContain('M-1002');
    expect(page.text).toContain('card-manuelle');
    // Rien n'a été envoyé à Shopify.
    expect(h.shopify.calls.filter((c) => /order/i.test(c.method))).toHaveLength(0);
  });

  it('refuse une saisie invalide', async () => {
    const cookie = await connexion();
    const r = await post('/api/admin/orders/manuelles', cookie, saisie({ articles: [] }));
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('au moins un article');
  });

  it('ne se modifie ni ne se supprime plus', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    expect((await post('/api/admin/orders/-1/manuelle', cookie, saisie())).status).toBe(404);
    const d = await request(srv()).delete('/api/admin/orders/-1/manuelle').set('X-Forwarded-For', freshIp()).set('Cookie', cookie);
    expect(d.status).toBe(404);
    expect(await repo().count()).toBe(1);
  });

  it('expédie une commande manuelle sans appeler Shopify', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    const r = await post('/api/admin/orders/-1/status', cookie, { status: 'shipped', tracking: '6A123' });
    expect(r.body.ok).toBe(true);
    expect(r.body.shopify).toContain('Aucun e-mail');
    const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
    expect(o.productionStatus).toBe('shipped');
    expect(o.trackingNumber).toBe('6A123');
    expect(h.shopify.calls).toHaveLength(0);
  });

  describe('Rattachement à Shopify (facture)', () => {
    /* La doublure renvoie le prix UNITAIRE comme total : on la rend fidèle
       (prix × pièces), sauf quand un test veut provoquer un écart. */
    let ecart = 0;
    beforeEach(() => {
      ecart = 0;
      jest.spyOn(h.shopify, 'setDraftOrderPrice').mockImplementation(async (id: unknown, prix: unknown) => {
        h.shopify.calls.push({ method: 'setDraftOrderPrice', args: [id, prix] });
        return { id, total_price: (Number(prix) * 250 + ecart).toFixed(2) };
      });
    });
    afterEach(() => jest.restoreAllMocks());

    const facture = (cookie: string | null, mode?: string) => post('/api/admin/orders/-1/facture', cookie, mode ? { mode } : {});

    it('refuse sans session, et sur une commande Shopify', async () => {
      expect((await facture(null)).status).toBe(401);
      const cookie = await connexion();
      await repo().save({ shopifyOrderId: '123', orderNumber: '#20500', lineItems: [], fromConfigurator: true } as Partial<Order>);
      expect((await post('/api/admin/orders/123/facture', cookie, {})).status).toBe(403);
    });

    it('crée le brouillon, répartit le montant et envoie la facture au client', async () => {
      const cookie = await connexion();
      await post('/api/admin/orders/manuelles', cookie, saisie());
      const r = await facture(cookie, 'facture');
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ ok: true, total: '960.00', facture: { statut: 'envoyee', draftOrderId: '999001' } });

      const [brouillon] = h.shopify.callsTo('createDraftOrder')[0].args as any[];
      expect(brouillon.email).toBe('lucas@exemple.fr');
      expect(brouillon.line_items[0].properties).toContainEqual({ name: '_Commande manuelle', value: '-1' });
      expect(h.shopify.callsTo('setDraftOrderPrice')[0].args).toEqual(['999001', 960 / 250]);
      const [, invoice] = h.shopify.callsTo('sendDraftOrderInvoice')[0].args as any[];
      expect(invoice).toMatchObject({ to: 'lucas@exemple.fr', subject: 'Votre commande M-1001' });
      expect(invoice.custom_message).toContain('Bonjour Lucas Julien,');
      expect(invoice.custom_message).toContain('• 250 × Patch personnalisé (PVC)');
      expect(invoice.custom_message).toContain('Total : 960,00 € TTC.');
      expect(invoice.custom_message).not.toMatch(/devis/i);
      expect(h.shopify.callsTo('completeDraftOrder')).toHaveLength(0);

      const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
      expect((o.customerInfo as any).facture).toMatchObject({ statut: 'envoyee', draftOrderId: '999001', total: '960.00' });
      // Deuxième envoi refusé : pas de second brouillon ni de second e-mail.
      expect((await facture(cookie, 'facture')).status).toBe(409);
      expect(h.shopify.callsTo('createDraftOrder')).toHaveLength(1);
    });

    it('« déjà payé » : valide le brouillon comme payé, sans e-mail', async () => {
      const cookie = await connexion();
      await post('/api/admin/orders/manuelles', cookie, saisie({ mode: 'payee' }));
      const r = await facture(cookie, 'payee');
      expect(r.body).toMatchObject({ ok: true, facture: { statut: 'payee', orderId: '7000000000001' } });
      expect(h.shopify.callsTo('completeDraftOrder')[0].args).toEqual(['999001', false]);
      expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(0);
    });

    it('écart de total (TVA, arrondi) : rien n’est envoyé, nouvelle tentative possible', async () => {
      const cookie = await connexion();
      await post('/api/admin/orders/manuelles', cookie, saisie());
      ecart = 192;
      const r = await facture(cookie, 'facture');
      expect(r.status).toBe(409);
      expect(r.body.error).toContain('1152.00');
      expect(h.shopify.callsTo('sendDraftOrderInvoice')).toHaveLength(0);
      const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
      expect((o.customerInfo as any).facture).toMatchObject({ statut: 'echec', draftOrderId: '999001' });

      // Réessai : le MÊME brouillon est réutilisé.
      ecart = 0;
      expect((await facture(cookie, 'facture')).body.ok).toBe(true);
      expect(h.shopify.callsTo('createDraftOrder')).toHaveLength(1);
    });

    it('échec Shopify : 502, commande marquée « facture non envoyée »', async () => {
      const cookie = await connexion();
      await post('/api/admin/orders/manuelles', cookie, saisie());
      h.shopify.failNext.set('sendDraftOrderInvoice', new Error('Erreur Shopify (422)'));
      const r = await facture(cookie, 'facture');
      expect(r.status).toBe(502);
      const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
      expect((o.customerInfo as any).facture.statut).toBe('echec');
    });
  });

  it('au paiement, la commande Shopify remplace la commande manuelle (fichiers, note, suivi)', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    await post('/api/admin/orders/-1/status', cookie, { status: 'producing' });
    await repo().update(
      { shopifyOrderId: '-1' },
      {
        fichiersJoints: [
          { id: 'f1', libelle: 'BAT', nom: 'bat.pdf', url: 'https://res.cloudinary.com/c/raw/upload/v1/bat.pdf', type: 'application/pdf', taille: 1, ajoutePar: 'a', ajouteLe: 'x' },
        ] as any,
      },
    );

    const payload = {
      id: 7000000000001,
      name: '#20900',
      email: 'lucas@exemple.fr',
      financial_status: 'paid',
      total_price: '960.00',
      currency: 'EUR',
      created_at: '2026-10-16T12:00:00Z',
      line_items: [
        {
          title: 'Coin métal sur mesure',
          quantity: 250,
          price: '3.84',
          properties: [{ name: '_Commande manuelle', value: '-1' }],
        },
      ],
    };
    const webhooks = h.app.get(WebhooksService);
    await webhooks.saveOrder(payload);
    // Rejoué (webhook puis import) : la ligne manuelle n'existe plus, rien ne bouge.
    // (Le rejeu complet de saveOrder n'est pas testable sous SQLite : l'upsert
    // y échoue sur la clé, indépendamment des commandes manuelles.)
    await (webhooks as any).transfererCommandeManuelle('-1', '7000000000001');

    expect(await repo().findOneBy({ shopifyOrderId: '-1' })).toBeNull();
    const o = await repo().findOneByOrFail({ shopifyOrderId: '7000000000001' });
    expect(o.fromConfigurator).toBe(true);
    expect(o.fichiersJoints).toHaveLength(1);
    expect(o.internalNote).toBe('Reçue par e-mail');
    expect(o.productionStatus).toBe('producing');
  });
});
