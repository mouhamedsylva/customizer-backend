import request from 'supertest';
import { createHarness, freshIp, type Harness } from './harness';

/**
 * Dashboard admin : 21 routes.
 *
 * Deux exigences distinctes sont vérifiées ici.
 *
 * 1. AUTHENTIFICATION — aucune route ne doit répondre sans session. Ces routes
 *    exposent les données clients (noms, adresses, e-mails) et déclenchent des
 *    actions réelles : changer un prix sur Shopify, envoyer une facture,
 *    marquer une commande expédiée (ce qui envoie un e-mail au client).
 *
 * 2. RÔLE — la gestion des comptes est réservée au propriétaire. Un admin
 *    ordinaire ne doit pas pouvoir créer de compte, bloquer un collègue, ni
 *    réinitialiser un mot de passe.
 *
 * Le contrôleur n'utilise PAS de décorateur de garde : chaque route appelle
 * `isAuthed()` à la main. Un oubli ne se verrait donc pas à la lecture — d'où
 * la vérification exhaustive, route par route.
 */
describe('Dashboard admin', () => {
  let h: Harness;
  const srv = () => h.app.getHttpServer();

  /** Session valide : renvoie le cookie à rejouer. */
  async function connexion(
    email = 'patron@test.fr',
    password = 'MotDePasseTest123',
  ): Promise<string> {
    const r = await request(srv())
      .post('/api/admin/login')
      .set('X-Forwarded-For', freshIp())
      .send({ email, password });
    const set = r.headers['set-cookie'];
    const cookies = Array.isArray(set) ? set : set ? [set] : [];
    return cookies.map((c: string) => c.split(';')[0]).join('; ');
  }

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
  });

  // ────────────────────────── Authentification ──────────────────────────

  describe('POST /api/admin/login', () => {
    it('accepte les identifiants d’amorçage et pose un cookie', async () => {
      const r = await request(srv())
        .post('/api/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
      expect([200, 302]).toContain(r.status);
      const set = r.headers['set-cookie'];
      expect(set).toBeDefined();
      expect(String(set)).toContain('admin_session');
    });

    it('pose un cookie HttpOnly, Secure et SameSite=Strict', async () => {
      const r = await request(srv())
        .post('/api/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'patron@test.fr', password: 'MotDePasseTest123' });
      const brut = String(r.headers['set-cookie']);
      // HttpOnly : inaccessible au JavaScript, donc au vol par XSS.
      expect(brut).toMatch(/HttpOnly/i);
      expect(brut).toMatch(/Secure/i);
      expect(brut).toMatch(/SameSite=Strict/i);
    });

    it('refuse un mot de passe erroné', async () => {
      const r = await request(srv())
        .post('/api/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'patron@test.fr', password: 'mauvais' });
      expect(r.status).toBe(401);
      expect(String(r.headers['set-cookie'] || '')).not.toContain('admin_session');
    });

    it('ne révèle pas si un compte existe', async () => {
      // Réponses indiscernables : sinon l'attaquant énumère les comptes avant
      // de concentrer ses tentatives sur une adresse connue.
      const inconnu = await request(srv())
        .post('/api/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'personne@nulle-part.fr', password: 'x' });
      const connu = await request(srv())
        .post('/api/admin/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'patron@test.fr', password: 'mauvais' });
      expect(inconnu.status).toBe(connu.status);
    });

    it('limite les tentatives à 5 par minute et par IP', async () => {
      const ip = '10.77.77.77';
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await request(srv())
          .post('/api/admin/login')
          .set('X-Forwarded-For', ip)
          .send({ email: 'patron@test.fr', password: 'mauvais' });
        codes.push(r.status);
      }
      expect(codes).toContain(429);
    }, 30000);
  });

  describe('GET /api/admin', () => {
    it('affiche la page de connexion sans session', async () => {
      const r = await request(srv())
        .get('/api/admin')
        .set('X-Forwarded-For', freshIp());
      expect([200, 201]).toContain(r.status);
      expect(r.text).toMatch(/mot de passe|password/i);
      // Aucune donnée client ne doit apparaître sur la page de connexion.
      expect(r.text).not.toMatch(/Commandes reçues/);
    });

    it('affiche le dashboard avec une session valide', async () => {
      const cookie = await connexion();
      const r = await request(srv())
        .get('/api/admin')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([200, 201]).toContain(r.status);
      expect(r.text).toMatch(/Commandes|Devis/);
    });
  });

  describe('GET /api/admin/logout', () => {
    it('efface le cookie de session', async () => {
      const r = await request(srv())
        .get('/api/admin/logout')
        .set('X-Forwarded-For', freshIp());
      expect([200, 302]).toContain(r.status);
      // L'effacement doit porter les MÊMES attributs que la pose, sinon le
      // navigateur garde le cookie et la déconnexion est illusoire.
      const brut = String(r.headers['set-cookie'] || '');
      expect(brut).toContain('admin_session');
      expect(brut).toMatch(/HttpOnly/i);
    });
  });

  // ─────────────────── Toutes les routes exigent une session ───────────────────

  describe('Protection : aucune route accessible sans session', () => {
    /** Routes JSON : un client d'API doit recevoir un 401 explicite. */
    const lecturesJson = [
      '/api/admin/status',
      '/api/admin/pricing',
      '/api/admin/admins',
    ];

    it.each(lecturesJson)('GET %s renvoie 401', async (url) => {
      const r = await request(srv()).get(url).set('X-Forwarded-For', freshIp());
      expect(r.status).toBe(401);
    });

    /**
     * Routes ouvertes dans le navigateur (téléchargement, page imprimable).
     * Elles REDIRIGENT vers la page de connexion au lieu de renvoyer 401 : un
     * 401 nu afficherait une page blanche à l'opérateur. Le comportement est
     * différent, la protection identique — ce qui compte est qu'aucune donnée
     * ne sorte.
     */
    const lecturesNavigateur = [
      '/api/admin/export.csv',
      '/api/admin/orders/123/sheet',
      '/api/admin/quotes/456/sheet',
      '/api/admin/orders/123/assets.zip',
    ];

    it.each(lecturesNavigateur)('GET %s ne divulgue rien', async (url) => {
      const r = await request(srv()).get(url).set('X-Forwarded-For', freshIp());
      expect([301, 302, 401]).toContain(r.status);
      // Ni CSV, ni archive, ni fiche : aucun contenu métier ne doit filtrer.
      expect(r.headers['content-type'] || '').not.toMatch(/csv|zip/);
      expect(r.text || '').not.toMatch(/Commandes reçues|customerEmail/);
    });

    const ecritures: Array<[string, Record<string, unknown>]> = [
      ['/api/admin/pricing', { tshirt: 25 }],
      ['/api/admin/settings', { reminderEnabled: true }],
      ['/api/admin/seen', { orders: ['1'] }],
      ['/api/admin/orders/123/status', { status: 'producing' }],
      ['/api/admin/orders/123/note', { note: 'test' }],
      ['/api/admin/quotes/456/invoice', { unitPrice: 10 }],
      ['/api/admin/quotes/456/remind', {}],
      ['/api/admin/me/password', { current: 'a', next: 'b' }],
      ['/api/admin/admins', { email: 'x@y.fr' }],
      ['/api/admin/admins/1/blocked', { blocked: true }],
      ['/api/admin/admins/1/password', {}],
    ];

    it.each(ecritures)('POST %s renvoie 401', async (url, body) => {
      const r = await request(srv())
        .post(url)
        .set('X-Forwarded-For', freshIp())
        .send(body);
      expect(r.status).toBe(401);
    });

    it('ne déclenche AUCUNE action externe sans session', async () => {
      // Le point décisif : une route non protégée qui appelle Shopify
      // enverrait un e-mail au client ou modifierait un prix en boutique.
      await request(srv())
        .post('/api/admin/orders/123/status')
        .set('X-Forwarded-For', freshIp())
        .send({ status: 'shipped' });
      await request(srv())
        .post('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .send({ tshirt: 1 });
      expect(h.shopify.calls).toHaveLength(0);
    });

    it('refuse un cookie forgé', async () => {
      const r = await request(srv())
        .get('/api/admin/status')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', 'admin_session=nimporte.quoi.forge.abcdef');
      expect(r.status).toBe(401);
    });
  });

  // ────────────────────────── Routes authentifiées ──────────────────────────

  describe('Routes de lecture, session valide', () => {
    let cookie: string;
    beforeEach(async () => {
      cookie = await connexion();
    });

    it('GET /api/admin/status renvoie les compteurs', async () => {
      const r = await request(srv())
        .get('/api/admin/status')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([200, 201]).toContain(r.status);
      expect(typeof r.body.orders).toBe('number');
      expect(typeof r.body.quotes).toBe('number');
    });

    it('GET /api/admin/pricing expose clés, libellés et produits sur devis', async () => {
      const r = await request(srv())
        .get('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([200, 201]).toContain(r.status);
      expect(r.body.keys).toContain('manche');
      expect(r.body.labels.manche).toBeTruthy();
      // Le dashboard s'en sert pour masquer les champs non enregistrables.
      expect(r.body.quoteOnly).toContain('coins');
    });

    it('GET /api/admin/export.csv sert un fichier CSV', async () => {
      const r = await request(srv())
        .get('/api/admin/export.csv')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([200, 201]).toContain(r.status);
      expect(r.headers['content-type']).toMatch(/csv/);
    });

    it('GET /api/admin/admins liste les comptes pour le propriétaire', async () => {
      const r = await request(srv())
        .get('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([200, 201]).toContain(r.status);
      expect(Array.isArray(r.body.admins)).toBe(true);
    });

    it('ne divulgue jamais de hachage de mot de passe', async () => {
      const r = await request(srv())
        .get('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|scrypt|\$2[aby]\$/);
    });

    it('renvoie 404 sur une fiche de commande inexistante', async () => {
      const r = await request(srv())
        .get('/api/admin/orders/inexistante/sheet')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      expect([404, 400]).toContain(r.status);
    });
  });

  describe('Enregistrement des prix, session valide', () => {
    let cookie: string;
    beforeEach(async () => {
      cookie = await connexion();
    });

    it('enregistre un prix et le pousse vers Shopify', async () => {
      const r = await request(srv())
        .post('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie)
        .send({ tshirt: 27.5 });
      expect([200, 201]).toContain(r.status);
      expect(r.body.prices.tshirt).toBe(27.5);
      expect(h.shopify.callsTo('updateProductPrice')).toHaveLength(1);
    });

    it('NE POUSSE PAS un prix rejeté vers Shopify', async () => {
      // Le défaut corrigé : un prix invalide laissait pousser l'ANCIENNE
      // valeur, écrasant une correction faite directement dans Shopify.
      const r = await request(srv())
        .post('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie)
        .send({ tshirt: -5 });
      expect([200, 201]).toContain(r.status);
      expect(h.shopify.callsTo('updateProductPrice')).toHaveLength(0);
      expect(r.body.warnings.join(' ')).toMatch(/refusée|inchangé/i);
    });

    it('n’enregistre ni le prix ni la grille d’un produit sur devis', async () => {
      const avant = await request(srv())
        .get('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie);
      const r = await request(srv())
        .post('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie)
        .send({ coins: 9.99, tiers: { coins: [{ min: 10, price: 8 }] } });
      expect([200, 201]).toContain(r.status);
      expect(r.body.prices.coins).toBe(avant.body.prices.coins);
      expect(r.body.tiers.coins).toBeUndefined();
    });

    it('normalise et trie les grilles dégressives', async () => {
      const r = await request(srv())
        .post('/api/admin/pricing')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', cookie)
        .send({
          tshirt: 29.5,
          tiers: {
            tshirt: [
              { min: 10, price: 26.5 },
              { min: 50, price: 24.5 },
            ],
          },
        });
      expect(r.body.tiers.tshirt.map((t: { min: number }) => t.min)).toEqual([50, 10]);
    });
  });

  describe('Gestion des comptes : rôle propriétaire', () => {
    let owner: string;
    beforeEach(async () => {
      owner = await connexion();
    });

    it('le propriétaire peut créer un admin', async () => {
      const r = await request(srv())
        .post('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', owner)
        .send({ email: 'collegue@test.fr' });
      expect([200, 201]).toContain(r.status);
      expect(r.body.ok).toBe(true);
      // Le mot de passe généré n'est montré qu'une fois, à la création.
      expect(typeof r.body.password).toBe('string');
    });

    it('un admin ordinaire ne peut pas créer de compte', async () => {
      const cree = await request(srv())
        .post('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', owner)
        .send({ email: 'simple@test.fr' });
      const simple = await connexion('simple@test.fr', cree.body.password);

      const r = await request(srv())
        .post('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', simple)
        .send({ email: 'autre@test.fr' });
      expect(r.status).toBe(403);
    });

    it('un admin ordinaire ne peut pas réinitialiser un mot de passe', async () => {
      const cree = await request(srv())
        .post('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', owner)
        .send({ email: 'simple2@test.fr' });
      const simple = await connexion('simple2@test.fr', cree.body.password);

      const liste = await request(srv())
        .get('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', owner);
      const cible = liste.body.admins[0].id;

      const r = await request(srv())
        .post(`/api/admin/admins/${cible}/password`)
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', simple)
        .send({});
      expect(r.status).toBe(403);
      expect(r.body.password).toBeUndefined();
    });

    it('refuse un e-mail invalide à la création', async () => {
      const r = await request(srv())
        .post('/api/admin/admins')
        .set('X-Forwarded-For', freshIp())
        .set('Cookie', owner)
        .send({ email: 'pas-une-adresse' });
      expect(r.status).toBe(400);
    });
  });
});
