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
      financialStatus: 'paid',
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

  it('joint un design à un article : il s’affiche avec l’article', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
    const envoi = (id: string, ligne: string) =>
      request(srv()).post('/api/admin/orders/' + id + '/manuelle/design').set('X-Forwarded-For', freshIp()).set('Cookie', cookie)
        .field('ligne', ligne).attach('file', png, { filename: 'design.png', contentType: 'image/png' });

    const r = await envoi('-1', '0');
    expect(r.status).toBe(201);
    const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
    expect((o.lineItems as any[])[0].properties).toContainEqual({ name: 'Design', value: r.body.url });
    expect((await envoi('-1', '3')).status).toBe(400);
    await repo().save({ shopifyOrderId: '123', orderNumber: '#20500', lineItems: [{ title: 'x', quantity: 1 }], fromConfigurator: true } as Partial<Order>);
    expect((await envoi('123', '0')).status).toBe(403);
    const anonyme = await request(srv()).post('/api/admin/orders/-1/manuelle/design').set('X-Forwarded-For', freshIp()).field('ligne', '0');
    expect(anonyme.status).toBe(401);

    const page = await request(srv()).get('/api/admin').set('X-Forwarded-For', freshIp()).set('Cookie', cookie);
    expect(page.text).toContain(r.body.url);
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

  it('ne crée rien sur Shopify : pas de brouillon, pas d’e-mail, pas de route /facture', async () => {
    const cookie = await connexion();
    const r = await post('/api/admin/orders/manuelles', cookie, saisie({ client: { nom: 'Sans e-mail' } }));
    expect(r.body.ok).toBe(true);
    const o = await repo().findOneByOrFail({ shopifyOrderId: r.body.id });
    expect(o.financialStatus).toBe('paid');
    expect(o.customerEmail).toBeNull();
    expect(h.shopify.calls).toHaveLength(0);
    expect((await post('/api/admin/orders/' + r.body.id + '/facture', cookie, {})).status).toBe(404);
  });

  /* Filet : un ANCIEN brouillon de commande manuelle payé (avant le passage au
     mode « dashboard seulement ») reste correctement rattaché. */
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
