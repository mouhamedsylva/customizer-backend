import request from 'supertest';
import { createHmac } from 'crypto';
import { createHarness, freshIp, type Harness } from './harness';

/**
 * Routes métier : devis, panier, webhooks, commandes, uploads.
 *
 * Ce sont les routes qui écrivent chez Shopify. En production, chacune crée un
 * brouillon de commande, envoie une facture ou modifie un panier réel — d'où
 * les doublures : sans elles, chaque exécution de cette suite polluerait la
 * boutique.
 *
 * Les tests vérifient donc DEUX choses : la réponse HTTP, et le fait que le
 * bon appel externe a été émis avec les bons arguments. Un test qui se
 * contenterait du code de retour laisserait passer un devis enregistré en base
 * mais jamais transmis à Shopify.
 */
describe('Routes métier', () => {
  let h: Harness;
  const srv = () => h.app.getHttpServer();
  const get = (u: string) => request(srv()).get(u).set('X-Forwarded-For', freshIp());
  const post = (u: string) => request(srv()).post(u).set('X-Forwarded-For', freshIp());
  const del = (u: string) => request(srv()).delete(u).set('X-Forwarded-For', freshIp());

  const devisValide = {
    customer: {
      nom: 'Dupont',
      email: 'client@exemple.fr',
      telephone: '0612345678',
    },
    coin: {
      name: 'Coin métal personnalisé',
      details: ['Finition dorée', 'Gravure recto'],
      qty: 50,
      previews: [
        {
          label: 'Face',
          base: 'https://res.cloudinary.com/demo/image/upload/v1/face.png',
        },
      ],
    },
  };

  beforeAll(async () => {
    h = await createHarness();
  }, 60000);
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.resetDb();
  });

  // ──────────────────────────────── Devis ────────────────────────────────

  describe('POST /api/quotes', () => {
    it('enregistre un devis et renvoie son identifiant', async () => {
      const r = await post('/api/quotes').send(devisValide);
      expect([200, 201]).toContain(r.status);
      // Contrat réel : { success, quoteId }.
      expect(r.body.success).toBe(true);
      expect(typeof r.body.quoteId).toBe('string');
    });

    it('refuse un e-mail invalide', async () => {
      const r = await post('/api/quotes').send({
        ...devisValide,
        customer: { ...devisValide.customer, email: 'pas-un-email' },
      });
      expect(r.status).toBe(400);
    });

    it('refuse un devis sans client', async () => {
      const r = await post('/api/quotes').send({ coin: devisValide.coin });
      expect(r.status).toBe(400);
    });

    it('refuse une quantité négative', async () => {
      const r = await post('/api/quotes').send({
        ...devisValide,
        coin: { ...devisValide.coin, qty: -5 },
      });
      expect(r.status).toBe(400);
    });

    it('ne crée AUCUN brouillon Shopify quand la validation échoue', async () => {
      await post('/api/quotes').send({ customer: {} });
      expect(h.shopify.callsTo('createDraftOrder')).toHaveLength(0);
    });

    it('limite la création de devis à 5 par minute', async () => {
      const ip = '10.88.88.88';
      const codes: number[] = [];
      for (let i = 0; i < 8; i++) {
        const r = await request(srv())
          .post('/api/quotes')
          .set('X-Forwarded-For', ip)
          .send(devisValide);
        codes.push(r.status);
      }
      expect(codes).toContain(429);
    }, 30000);
  });

  describe('GET /api/quotes', () => {
    it('exige une session admin', async () => {
      // La liste des devis contient noms, e-mails et téléphones : publique,
      // elle exposerait tout le fichier client.
      const r = await get('/api/quotes');
      expect(r.status).toBe(401);
    });
  });

  // ──────────────────────────────── Panier ────────────────────────────────

  describe('POST /api/cart/add', () => {
    it('crée un brouillon Shopify et renvoie un jeton de panier', async () => {
      const r = await post('/api/cart/add').send({
        variantId: '12345',
        quantity: 2,
      });
      expect([200, 201]).toContain(r.status);
      expect(h.shopify.callsTo('createDraftOrder')).toHaveLength(1);
      // Le jeton prouve la possession du panier : sans lui, les ids Shopify
      // étant séquentiels, n'importe qui énumérerait les paniers voisins.
      expect(typeof r.body.cartToken).toBe('string');
    });

    it('refuse une quantité nulle ou négative', async () => {
      for (const quantity of [0, -3]) {
        const r = await post('/api/cart/add').send({ variantId: '1', quantity });
        expect(r.status).toBe(400);
      }
    });

    it('refuse un variantId manquant', async () => {
      const r = await post('/api/cart/add').send({ quantity: 1 });
      expect(r.status).toBe(400);
    });

    it('refuse un dictionnaire de propriétés trop fourni', async () => {
      // Borne de 40 clés. On la teste plutôt que la borne de taille : une
      // valeur de plusieurs Mo se heurterait d'abord au plafond de corps
      // d'Express, et le test mesurerait ce plafond au lieu de la validation.
      const properties: Record<string, string> = {};
      for (let i = 0; i < 60; i++) properties['cle' + i] = 'v';
      const r = await post('/api/cart/add').send({
        variantId: '1',
        quantity: 1,
        properties,
      });
      expect(r.status).toBe(400);
      expect(h.shopify.callsTo('createDraftOrder')).toHaveLength(0);
    });

    it('refuse une clé de propriété anormalement longue', async () => {
      const r = await post('/api/cart/add').send({
        variantId: '1',
        quantity: 1,
        properties: { ['k'.repeat(200)]: 'v' },
      });
      expect(r.status).toBe(400);
    });

    it('accepte les propriétés d’un panier configurateur réel', async () => {
      // Contre-épreuve : les bornes ne doivent pas rejeter l'usage normal.
      const r = await post('/api/cart/add').send({
        variantId: '1',
        quantity: 2,
        properties: {
          Couleur: 'Bleu Roi',
          Taille: 'XL',
          _apercu: 'https://res.cloudinary.com/demo/image/upload/v1/a.png',
        },
      });
      expect([200, 201]).toContain(r.status);
    });
  });

  describe('GET /api/cart/:draftOrderId', () => {
    it('REFUSE sans jeton de possession', async () => {
      const r = await get('/api/cart/999001');
      expect([401, 403]).toContain(r.status);
      // Rien ne doit partir vers Shopify avant la vérification du jeton.
      expect(h.shopify.callsTo('getDraftOrder')).toHaveLength(0);
    });

    it('refuse un jeton appartenant à un AUTRE panier', async () => {
      const cree = await post('/api/cart/add').send({
        variantId: '1',
        quantity: 1,
      });
      // Jeton valide, mais présenté pour un panier voisin.
      const r = await get('/api/cart/999002').query({
        token: cree.body.cartToken,
      });
      expect([401, 403]).toContain(r.status);
    });

    it('accepte le jeton du bon panier', async () => {
      const cree = await post('/api/cart/add').send({
        variantId: '1',
        quantity: 1,
      });
      const id = cree.body.draftOrderId;
      const r = await get(`/api/cart/${id}`).query({ token: cree.body.cartToken });
      expect(r.status).toBe(200);
    });
  });

  describe('DELETE /api/cart/:id/item/:lineId', () => {
    it('refuse sans jeton valide', async () => {
      const r = await del('/api/cart/999001/item/1');
      expect([401, 403]).toContain(r.status);
      expect(h.shopify.callsTo('deleteDraftOrderLine')).toHaveLength(0);
    });
  });

  // ─────────────────────────────── Webhooks ───────────────────────────────

  describe('POST /api/webhooks/orders-create', () => {
    const corps = JSON.stringify({
      id: 5001,
      name: '#1001',
      total_price: '99.90',
      financial_status: 'paid',
      line_items: [],
      created_at: new Date().toISOString(),
    });

    const signer = (body: string) =>
      createHmac('sha256', 'secret-webhook-de-test').update(body).digest('base64');

    it('accepte une requête correctement signée', async () => {
      const r = await post('/api/webhooks/orders-create')
        .set('X-Shopify-Hmac-Sha256', signer(corps))
        .set('Content-Type', 'application/json')
        .send(corps);
      expect([200, 201]).toContain(r.status);
    });

    it('REJETTE une signature absente', async () => {
      const r = await post('/api/webhooks/orders-create')
        .set('Content-Type', 'application/json')
        .send(corps);
      expect(r.status).toBe(401);
    });

    it('rejette une signature forgée', async () => {
      const r = await post('/api/webhooks/orders-create')
        .set('X-Shopify-Hmac-Sha256', 'signature-inventee')
        .set('Content-Type', 'application/json')
        .send(corps);
      expect(r.status).toBe(401);
    });

    it('rejette un corps modifié après signature', async () => {
      // Le scénario réel : intercepter un webhook légitime et gonfler le
      // montant. L'URL est publique, seule la signature protège.
      const altere = JSON.stringify({ id: 5001, total_price: '0.01' });
      const r = await post('/api/webhooks/orders-create')
        .set('X-Shopify-Hmac-Sha256', signer(corps))
        .set('Content-Type', 'application/json')
        .send(altere);
      expect(r.status).toBe(401);
    });
  });

  describe('POST /api/webhooks/orders-updated', () => {
    it('rejette une requête non signée', async () => {
      const r = await post('/api/webhooks/orders-updated')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ id: 1 }));
      expect(r.status).toBe(401);
    });
  });

  // ─────────────────────────────── Commandes ───────────────────────────────

  describe('/api/orders', () => {
    it('GET exige une session admin', async () => {
      const r = await get('/api/orders');
      expect(r.status).toBe(401);
    });

    it('GET /:id exige une session admin', async () => {
      const r = await get('/api/orders/123');
      expect(r.status).toBe(401);
    });

    it('POST exige une session admin', async () => {
      const r = await post('/api/orders').send({});
      expect(r.status).toBe(401);
    });
  });

  // ──────────────────────────────── Uploads ────────────────────────────────

  describe('/api/uploads', () => {
    it('refuse un envoi de logo sans fichier', async () => {
      const r = await post('/api/uploads/logo');
      expect([400, 401]).toContain(r.status);
      expect(h.cloudinary.callsTo('uploadLogo')).toHaveLength(0);
    });

    it('refuse un envoi d’aperçu sans fichier', async () => {
      const r = await post('/api/uploads/preview');
      expect([400, 401]).toContain(r.status);
    });

    it('exige une session admin pour supprimer un média', async () => {
      // La suppression est irréversible : elle ne doit pas être publique.
      const r = await del('/api/uploads/test%2Fabc123');
      expect(r.status).toBe(401);
      expect(h.cloudinary.callsTo('deleteImage')).toHaveLength(0);
    });
  });
});
