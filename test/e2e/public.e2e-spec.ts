import request from 'supertest';
import { createHarness, freshIp, type Harness } from './harness';

/**
 * Routes PUBLIQUES : celles qu'un visiteur du configurateur atteint sans
 * authentification.
 *
 * Elles sont exposées à Internet : on vérifie autant leur bon fonctionnement
 * que leur refus des entrées mal formées. Une validation trop laxiste ici,
 * c'est une porte ouverte ; une validation trop stricte, c'est un
 * configurateur qui ne marche plus.
 *
 * Couvre : /api/health, /api/pricing, /api/export/* (5 routes).
 */
describe('Routes publiques', () => {
  let h: Harness;
  const srv = () => h.app.getHttpServer();
  const get = (url: string) =>
    request(srv()).get(url).set('X-Forwarded-For', freshIp());
  const post = (url: string) =>
    request(srv()).post(url).set('X-Forwarded-For', freshIp());

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
  });

  describe('GET /api/health', () => {
    it('répond sans toucher à la base ni aux services externes', async () => {
      const r = await get('/api/health');
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ status: 'ok' });
      expect(typeof r.body.timestamp).toBe('string');
      expect(h.shopify.calls).toHaveLength(0);
    });

    it('renvoie un horodatage ISO valide', async () => {
      const r = await get('/api/health');
      expect(new Date(r.body.timestamp).toString()).not.toBe('Invalid Date');
    });
  });

  describe('GET /api/health/variants', () => {
    it('EXIGE une session admin (route de debug coûteuse)', async () => {
      // Cette route déclenche un appel Shopify par produit : publique, elle
      // permettait à n'importe qui d'épuiser le quota de toute l'application.
      const r = await get('/api/health/variants');
      expect(r.status).toBe(401);
      expect(h.shopify.calls).toHaveLength(0);
    });
  });

  describe('GET /api/pricing', () => {
    it('sert les prix et les grilles dégressives', async () => {
      const r = await get('/api/pricing');
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.prices).toBeDefined();
      expect(r.body.tiers).toBeDefined();
    });

    it('inclut tous les produits du configurateur', async () => {
      const r = await get('/api/pricing');
      for (const k of [
        'sweatshirt',
        'tshirt',
        'tshirt_polyester',
        'coins',
        'drapeaux',
        'patches',
        'manche',
      ]) {
        expect(typeof r.body.prices[k]).toBe('number');
      }
    });

    it('ne réclame aucune authentification', async () => {
      // Le configurateur l'appelle à chaque chargement de page, sans session.
      const r = await get('/api/pricing');
      expect(r.status).toBe(200);
    });

    it('ne divulgue aucune donnée sensible', async () => {
      const r = await get('/api/pricing');
      const brut = JSON.stringify(r.body);
      expect(brut).not.toMatch(/shpat_|passwordHash|secret/i);
    });
  });

  describe('POST /api/export/share', () => {
    it('enregistre un design et renvoie identifiant + lien partageable', async () => {
      const r = await post('/api/export/share').send({
        designData: { produit: 'tshirt', couleur: 'Noir' },
      });
      expect([200, 201]).toContain(r.status);
      // Contrat réel de la route : { shareId, shareUrl }, sans enveloppe `ok`.
      expect(typeof r.body.shareId).toBe('string');
      expect(r.body.shareId.length).toBeGreaterThan(8);
      expect(r.body.shareUrl).toContain(r.body.shareId);
    });

    it('refuse un corps sans designData', async () => {
      const r = await post('/api/export/share').send({});
      expect(r.status).toBe(400);
    });

    it('refuse un designData qui n’est pas un objet', async () => {
      const r = await post('/api/export/share').send({ designData: 'texte' });
      expect(r.status).toBe(400);
    });

    it('refuse un champ non déclaré (whitelist active)', async () => {
      const r = await post('/api/export/share').send({
        designData: { a: 1 },
        champInconnu: 'x',
      });
      expect(r.status).toBe(400);
    });
  });

  describe('GET /api/export/share/:shareId', () => {
    it('relit un design précédemment enregistré', async () => {
      const cree = await post('/api/export/share').send({
        designData: { produit: 'sweatshirt', taille: 'L' },
      });
      const r = await get(`/api/export/share/${cree.body.shareId}`);
      expect(r.status).toBe(200);
      // La route renvoie le design tel quel, sans enveloppe.
      expect(r.body).toMatchObject({ produit: 'sweatshirt', taille: 'L' });
    });

    it('renvoie 404 pour un identifiant inconnu', async () => {
      const r = await get('/api/export/share/inexistant-12345');
      expect(r.status).toBe(404);
    });

    it('ne se laisse pas berner par une tentative d’injection', async () => {
      const r = await get(
        `/api/export/share/${encodeURIComponent("' OR '1'='1")}`,
      );
      // Doit répondre proprement (404), jamais divulguer un design au hasard.
      expect(r.status).toBe(404);
    });
  });

  describe('POST /api/export/pdf', () => {
    it('annonce clairement que la route n’est pas implémentée', async () => {
      const r = await post('/api/export/pdf').send({});
      expect(r.status).toBe(501);
    });
  });

  describe('POST /api/export/preview-image', () => {
    const valide = {
      background: 'https://res.cloudinary.com/demo/image/upload/v1/fond.png',
      logos: [
        {
          src: 'https://res.cloudinary.com/demo/image/upload/v1/logo.png',
          x: 0.5,
          y: 0.5,
          w: 0.2,
        },
      ],
    };

    it('compose un aperçu et renvoie son URL', async () => {
      const r = await post('/api/export/preview-image').send(valide);
      expect(r.status).toBe(201);
      expect(h.cloudinary.callsTo('composeAndUploadPreview')).toHaveLength(1);
    });

    it('refuse un fond manquant', async () => {
      const r = await post('/api/export/preview-image').send({ logos: [] });
      expect(r.status).toBe(400);
    });

    it('refuse une position de logo hors du visuel', async () => {
      // Les bornes 0..1 empêchent un logo placé hors cadre — et surtout une
      // largeur démesurée, qui faisait exploser le temps de calcul.
      const r = await post('/api/export/preview-image').send({
        ...valide,
        logos: [{ ...valide.logos[0], x: 5 }],
      });
      expect(r.status).toBe(400);
    });

    it('refuse une largeur de logo démesurée', async () => {
      const r = await post('/api/export/preview-image').send({
        ...valide,
        logos: [{ ...valide.logos[0], w: 20 }],
      });
      expect(r.status).toBe(400);
      // Aucun calcul lancé : la validation a coupé avant.
      expect(h.cloudinary.callsTo('composeAndUploadPreview')).toHaveLength(0);
    });
  });

  describe('POST /api/export/preview-multi', () => {
    it('refuse une requête sans vue', async () => {
      const r = await post('/api/export/preview-multi').send({});
      expect(r.status).toBe(400);
    });
  });
});
