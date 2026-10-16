import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Order } from '../../src/database/entities/order.entity';

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
    paiement: 'pending',
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

  it('refuse sans session (création, modification, suppression)', async () => {
    expect((await post('/api/admin/orders/manuelles', null, saisie())).status).toBe(401);
    expect((await post('/api/admin/orders/-1/manuelle', null, saisie())).status).toBe(401);
    const d = await request(srv()).delete('/api/admin/orders/-1/manuelle').set('X-Forwarded-For', freshIp());
    expect(d.status).toBe(401);
    expect(await repo().count()).toBe(0);
  });

  it('crée des commandes numérotées M-1001, M-1002, visibles dans le dashboard', async () => {
    const cookie = await connexion();
    const a = await post('/api/admin/orders/manuelles', cookie, saisie());
    expect(a.status).toBe(201);
    expect(a.body).toEqual({ ok: true, id: '-1' });
    const b = await post('/api/admin/orders/manuelles', cookie, saisie({ client: { nom: 'Autre client' } }));
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

  it('modifie une commande manuelle sans toucher à son suivi ni à sa note', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    await post('/api/admin/orders/-1/status', cookie, { status: 'producing' });
    const m = await post('/api/admin/orders/-1/manuelle', cookie, saisie({ paiement: 'paid', articles: [{ titre: 'Drapeau', quantite: 3 }] }));
    expect(m.body.ok).toBe(true);
    const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
    expect(o.financialStatus).toBe('paid');
    expect((o.lineItems as any[])[0]).toMatchObject({ title: 'Drapeau', quantity: 3 });
    expect(o.productionStatus).toBe('producing');
    expect(o.internalNote).toBe('Reçue par e-mail');
  });

  it('ne modifie ni ne supprime jamais une commande Shopify', async () => {
    const cookie = await connexion();
    await repo().save({ shopifyOrderId: '123', orderNumber: '#20500', lineItems: [], fromConfigurator: true } as Partial<Order>);
    expect((await post('/api/admin/orders/123/manuelle', cookie, saisie())).status).toBe(403);
    const d = await request(srv()).delete('/api/admin/orders/123/manuelle').set('X-Forwarded-For', freshIp()).set('Cookie', cookie);
    expect(d.status).toBe(403);
    expect(await repo().count()).toBe(1);
  });

  it('expédie une commande manuelle sans appeler Shopify', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    const r = await post('/api/admin/orders/-1/status', cookie, { status: 'shipped', tracking: '6A123' });
    expect(r.body.ok).toBe(true);
    expect(r.body.shopify).toContain("Aucun e-mail");
    const o = await repo().findOneByOrFail({ shopifyOrderId: '-1' });
    expect(o.productionStatus).toBe('shipped');
    expect(o.trackingNumber).toBe('6A123');
    expect(h.shopify.calls).toHaveLength(0);
  });

  it('supprime une commande manuelle', async () => {
    const cookie = await connexion();
    await post('/api/admin/orders/manuelles', cookie, saisie());
    const d = await request(srv()).delete('/api/admin/orders/-1/manuelle').set('X-Forwarded-For', freshIp()).set('Cookie', cookie);
    expect(d.body.ok).toBe(true);
    expect(await repo().count()).toBe(0);
  });
});
