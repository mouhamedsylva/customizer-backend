import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Order } from '../../src/database/entities/order.entity';

/** Fenêtre « Chiffre d'affaires » : GET /api/admin/ca et /api/admin/ca.csv. */
describe('Chiffre d’affaires par mois / par jour', () => {
  let h: Harness;
  let cookie = '';
  const srv = () => h.app.getHttpServer();
  const repo = () => h.app.get(DataSource).getRepository(Order);

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
    const r = await request(srv())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
    const set = r.headers['set-cookie'];
    cookie = (Array.isArray(set) ? set : [set]).map((c: string) => c.split(';')[0]).join('; ');
    const base = { lineItems: [], fromConfigurator: true, financialStatus: 'paid' };
    await repo().save([
      { ...base, shopifyOrderId: '1', orderNumber: '#1', totalPrice: '100.00', shopifyCreatedAt: new Date('2025-03-10T10:00:00Z') },
      { ...base, shopifyOrderId: '2', orderNumber: '#2', totalPrice: '50.00', shopifyCreatedAt: new Date('2025-03-20T10:00:00Z') },
      { ...base, shopifyOrderId: '3', orderNumber: '#3', totalPrice: '30.00', shopifyCreatedAt: new Date('2025-04-02T10:00:00Z') },
      // Hors configurateur : ignorée.
      { ...base, shopifyOrderId: '4', orderNumber: '#4', totalPrice: '999.00', fromConfigurator: false, shopifyCreatedAt: new Date('2025-03-15T10:00:00Z') },
    ] as Partial<Order>[]);
  });

  it('refuse sans session', async () => {
    expect((await request(srv()).get('/api/admin/ca')).status).toBe(401);
  });

  it('vue par mois : 12 mois, commandes du configurateur seulement', async () => {
    const r = await request(srv()).get('/api/admin/ca?vue=mois&annee=2025').set('Cookie', cookie);
    expect(r.body.ok).toBe(true);
    expect(r.body.bilan.lignes).toHaveLength(12);
    expect(r.body.bilan.lignes[2]).toMatchObject({ nbCommandes: 2, caTtc: 150 });
    expect(r.body.bilan.lignes[3]).toMatchObject({ nbCommandes: 1, caTtc: 30, evolution: -80 });
    expect(r.body.bilan.total).toMatchObject({ nbCommandes: 3, caTtc: 180 });
    expect(r.body.annees).toContain(2025);
  });

  it('vue par jour : les 31 jours de mars', async () => {
    const r = await request(srv()).get('/api/admin/ca?vue=jour&annee=2025&mois=3').set('Cookie', cookie);
    expect(r.body.bilan.lignes).toHaveLength(31);
    expect(r.body.bilan.lignes[9]).toMatchObject({ numero: 10, caTtc: 100 });
    expect(r.body.bilan.total.caTtc).toBe(150);
  });

  it('paramètres invalides : 400 ; export CSV', async () => {
    expect((await request(srv()).get('/api/admin/ca?vue=jour&annee=2025&mois=13').set('Cookie', cookie)).status).toBe(400);
    const csv = await request(srv()).get('/api/admin/ca.csv?vue=mois&annee=2025').set('Cookie', cookie);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('"mars 2025";"2";"150,00"');
    expect(csv.text).toContain('"Total";"3";"180,00"');
  });
});
