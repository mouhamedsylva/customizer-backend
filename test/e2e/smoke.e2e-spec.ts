import request from 'supertest';
import { createHarness, freshIp, type Harness } from './harness';

/**
 * Vérification du harnais lui-même.
 *
 * Si ces tests échouent, aucun autre test e2e n'a de valeur : ils mesureraient
 * un environnement cassé plutôt que l'application.
 */
describe('Harnais e2e', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.resetDb();
  });

  it('démarre l’application et sert /api/health', async () => {
    const r = await request(h.app.getHttpServer())
      .get('/api/health')
      .set('X-Forwarded-For', freshIp());
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
  });

  it('applique le préfixe global /api', async () => {
    // Sans préfixe, la route n'existe pas : confirme qu'on teste bien les
    // mêmes URL qu'en production.
    const r = await request(h.app.getHttpServer())
      .get('/health')
      .set('X-Forwarded-For', freshIp());
    expect(r.status).toBe(404);
  });

  it('a bien une base fonctionnelle (lecture réelle)', async () => {
    // /api/pricing lit la table `settings` : une réponse 200 prouve que le
    // schéma SQLite a été créé et que TypeORM interroge vraiment la base.
    const r = await request(h.app.getHttpServer())
      .get('/api/pricing')
      .set('X-Forwarded-For', freshIp());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.prices.tshirt).toBe('number');
  });

  it('neutralise le limiteur avec une IP par requête', async () => {
    // Le limiteur autorise 120 req/min par IP. 150 requêtes depuis des IP
    // distinctes doivent toutes passer, sinon les suites longues échoueraient
    // pour une raison sans rapport avec le code testé.
    //
    // SÉQUENTIEL, volontairement : 150 connexions simultanées saturent le
    // serveur de test (ECONNRESET) et on mesurerait sa file d'attente, pas le
    // limiteur. Ce qui compte ici est l'absence de 429, pas la concurrence.
    const codes: number[] = [];
    for (let i = 0; i < 150; i++) {
      const r = await request(h.app.getHttpServer())
        .get('/api/health')
        .set('X-Forwarded-For', freshIp());
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 429)).toHaveLength(0);
    expect(codes.every((c) => c === 200)).toBe(true);
  }, 60000);

  it('applique TOUJOURS le limiteur sur une IP unique', async () => {
    // Contre-épreuve : le limiteur doit rester actif. S'il ne l'était pas, le
    // test précédent ne prouverait rien.
    const ip = '10.200.200.200';
    const codes: number[] = [];
    for (let i = 0; i < 130; i++) {
      const r = await request(h.app.getHttpServer())
        .get('/api/health')
        .set('X-Forwarded-For', ip);
      codes.push(r.status);
    }
    expect(codes).toContain(429);
  }, 60000);

  it('n’effectue AUCUN appel externe réel', async () => {
    await request(h.app.getHttpServer())
      .get('/api/health')
      .set('X-Forwarded-For', freshIp());
    // Les doublures sont en place et rien n'a fui vers Shopify/Cloudinary.
    expect(h.shopify.calls).toHaveLength(0);
    expect(h.cloudinary.calls).toHaveLength(0);
  });

  it('repart d’une base vide entre deux tests', async () => {
    const r = await request(h.app.getHttpServer())
      .get('/api/pricing')
      .set('X-Forwarded-For', freshIp());
    // Aucun prix personnalisé enregistré : on retombe sur les valeurs par
    // défaut, preuve que `resetDb` a bien vidé la table.
    expect(r.body.prices.sweatshirt).toBe(60);
  });
});
