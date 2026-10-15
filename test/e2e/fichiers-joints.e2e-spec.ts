import request from 'supertest';
import { DataSource } from 'typeorm';
import { createHarness, freshIp, type Harness } from './harness';
import { Order } from '../../src/database/entities/order.entity';

/** Fichiers joints par l'admin à une commande (BAT signé, maquette…). */
describe('Fichiers joints aux commandes', () => {
  let h: Harness;
  const srv = () => h.app.getHttpServer();
  const PDF = Buffer.from('%PDF-1.4\n%test\n');
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

  async function connexion(): Promise<string> {
    const r = await request(srv())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
    const set = r.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    return cookies.map((c: string) => c.split(';')[0]).join('; ');
  }

  const repo = () => h.app.get(DataSource).getRepository(Order);

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
    h.cloudinary.reset();
    await repo().save({
      shopifyOrderId: '123',
      orderNumber: '#20500',
      lineItems: [{ title: 'Patchs personnalisés', quantity: 50, properties: [] }],
      fromConfigurator: true,
    } as Partial<Order>);
  });

  it('POST sans session : 401, rien n’est envoyé à Cloudinary', async () => {
    const r = await request(srv())
      .post('/api/admin/orders/123/fichiers')
      .set('X-Forwarded-For', freshIp())
      .attach('file', PDF, { filename: 'BAT.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(401);
    expect(h.cloudinary.callsTo('uploadFichierCommande')).toHaveLength(0);
  });

  it('DELETE sans session : 401', async () => {
    const r = await request(srv()).delete('/api/admin/orders/123/fichiers/x').set('X-Forwarded-For', freshIp());
    expect(r.status).toBe(401);
  });

  it('joint un PDF puis une image, et les retire', async () => {
    const cookie = await connexion();
    const a = await request(srv())
      .post('/api/admin/orders/123/fichiers')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie)
      .field('libelle', 'BAT signé')
      .attach('file', PDF, { filename: 'bat-final.pdf', contentType: 'application/pdf' });
    expect(a.status).toBe(201);
    expect(a.body.ok).toBe(true);
    expect(a.body.fichier).toMatchObject({ libelle: 'BAT signé', nom: 'bat-final.pdf', resourceType: 'raw', ajoutePar: 'patron@test.fr' });
    expect(a.body.html).toContain('BAT signé');
    // Dossier propre à la commande, hors des pièces temporaires des devis.
    expect(h.cloudinary.callsTo('uploadFichierCommande')[0].args[3]).toBe('20500');

    const b = await request(srv())
      .post('/api/admin/orders/123/fichiers')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie)
      .attach('file', PNG, { filename: 'maquette.png', contentType: 'image/png' });
    expect(b.body.fichiers).toHaveLength(2);
    expect(b.body.fichier.libelle).toBe('maquette.png');

    const enBase = await repo().findOneByOrFail({ shopifyOrderId: '123' });
    expect(enBase.fichiersJoints).toHaveLength(2);

    const d = await request(srv())
      .delete(`/api/admin/orders/123/fichiers/${b.body.fichier.id}`)
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie);
    expect(d.status).toBe(200);
    expect(d.body.fichiers).toHaveLength(1);
    expect(h.cloudinary.callsTo('deleteResource')[0].args).toEqual(['customizer/commandes/20500/maquette', 'image']);

    const sheet = await request(srv())
      .get('/api/admin/orders/123/sheet')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie);
    expect(sheet.text).toContain('Fichiers joints');
    expect(sheet.text).toContain('BAT signé');
    expect(sheet.text).not.toContain('maquette.png');
  });

  it('refuse un contenu qui ne correspond pas au type annoncé', async () => {
    const cookie = await connexion();
    const r = await request(srv())
      .post('/api/admin/orders/123/fichiers')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie)
      .attach('file', Buffer.from('MZ pas un pdf'), { filename: 'BAT.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(400);
    expect(h.cloudinary.callsTo('uploadFichierCommande')).toHaveLength(0);
  });

  it('refuse un type non accepté', async () => {
    const cookie = await connexion();
    const r = await request(srv())
      .post('/api/admin/orders/123/fichiers')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie)
      .attach('file', Buffer.from('#!/bin/sh'), { filename: 'x.sh', contentType: 'application/x-sh' });
    expect(r.status).toBe(400);
  });

  it('404 pour une commande inconnue, ou un fichier inconnu', async () => {
    const cookie = await connexion();
    const a = await request(srv())
      .post('/api/admin/orders/999/fichiers')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie)
      .attach('file', PDF, { filename: 'BAT.pdf', contentType: 'application/pdf' });
    expect(a.status).toBe(404);
    const d = await request(srv())
      .delete('/api/admin/orders/123/fichiers/inconnu')
      .set('X-Forwarded-For', freshIp())
      .set('Cookie', cookie);
    expect(d.status).toBe(404);
  });
});
