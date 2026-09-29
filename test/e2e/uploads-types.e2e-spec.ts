import request from 'supertest';
import { createHarness, freshIp, type Harness } from './harness';

/**
 * Envois de fichiers : chaque route a son propre filtre. Le filtre « images
 * seulement » du module refusait les PDF des pièces jointes.
 */
describe('/api/uploads — types de fichiers', () => {
  let h: Harness;
  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(() => h.cloudinary.reset());

  const envoyer = (route: string, contenu: Buffer, nom: string, type: string) =>
    request(h.app.getHttpServer())
      .post(route)
      .set('X-Forwarded-For', freshIp())
      .attach('file', contenu, { filename: nom, contentType: type });

  it('accepte un PDF en pièce jointe', async () => {
    const r = await envoyer('/api/uploads/piece-jointe', Buffer.from('%PDF-1.7\n'), 'brief.pdf', 'application/pdf');
    expect(r.status).toBe(201);
    expect(h.cloudinary.callsTo('uploadPieceJointe')).toHaveLength(1);
  });

  it('refuse un exécutable déclaré en PDF', async () => {
    const r = await envoyer('/api/uploads/piece-jointe', Buffer.from([0x4d, 0x5a, 0, 0]), 'brief.pdf', 'application/pdf');
    expect(r.status).toBe(400);
    expect(h.cloudinary.callsTo('uploadPieceJointe')).toHaveLength(0);
  });

  it('refuse un PDF comme logo, et une fausse image', async () => {
    expect((await envoyer('/api/uploads/logo', Buffer.from('%PDF-1.7'), 'l.pdf', 'application/pdf')).status).toBe(400);
    expect((await envoyer('/api/uploads/logo', Buffer.from([0x4d, 0x5a, 0, 0]), 'l.png', 'image/png')).status).toBe(400);
    expect(h.cloudinary.callsTo('uploadLogo')).toHaveLength(0);
  });
});
