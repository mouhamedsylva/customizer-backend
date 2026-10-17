import { ShopifyService } from '../src/shared/shopify.service';
import type { ConfigService } from '@nestjs/config';

/**
 * Réessai sur quota Shopify dépassé (429).
 *
 * Shopify applique un seau percé d'environ 2 requêtes/seconde. Sans réessai,
 * un dépassement remontait comme une erreur fatale à TOUS les appelants en
 * même temps : prix non synchronisés, statuts d'expédition figés, relances
 * perdues. Un 429 signifie « trop tôt », pas « impossible ».
 *
 * La règle inverse est tout aussi importante : un 5xx ne doit PAS être rejoué.
 * Il peut correspondre à une écriture déjà appliquée côté Shopify, et la
 * rejouer créerait un doublon — une commande expédiée deux fois, un brouillon
 * en double. C'est le test le plus important de ce fichier.
 */
function build(): ShopifyService {
  const config = {
    get: (k: string) =>
      ({
        SHOPIFY_STORE_URL: 'boutique-test.myshopify.com',
        SHOPIFY_ACCESS_TOKEN: 'shpat_test',
        SHOPIFY_API_VERSION: '2024-10',
      })[k],
  } as unknown as ConfigService;
  return new ShopifyService(config);
}

/** Accès à la méthode privée `fetchShopify`, seul point d'entrée HTTP. */
function callFetch(s: ShopifyService, url = 'https://x/test.json') {
  return (
    s as unknown as {
      fetchShopify: (u: string, i?: RequestInit) => Promise<Response>;
    }
  ).fetchShopify(url);
}

const reponse = (status: number, headers: Record<string, string> = {}) =>
  new Response('{}', { status, headers });

describe('fetchShopify — réessai sur 429', () => {
  const vraiFetch = global.fetch;
  afterEach(() => {
    global.fetch = vraiFetch;
    jest.restoreAllMocks();
  });

  it('réessaie après un 429 et renvoie la réponse réussie', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return n === 1 ? reponse(429) : reponse(200);
    }) as unknown as typeof fetch;

    const r = await callFetch(build());
    expect(r.status).toBe(200);
    expect(n).toBe(2);
  });

  it('respecte l’en-tête Retry-After envoyé par Shopify', async () => {
    let n = 0;
    const debut = Date.now();
    global.fetch = jest.fn(async () => {
      n++;
      // 0,3 s demandé : plus court que le repli d'1 s, donc mesurable.
      return n === 1 ? reponse(429, { 'retry-after': '0.3' }) : reponse(200);
    }) as unknown as typeof fetch;

    await callFetch(build());
    const ecoule = Date.now() - debut;
    expect(ecoule).toBeGreaterThanOrEqual(250);
    expect(ecoule).toBeLessThan(900); // n'a PAS attendu le repli d'1 s
  });

  it('abandonne après le nombre maximal de tentatives', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return reponse(429);
    }) as unknown as typeof fetch;

    const r = await callFetch(build());
    expect(r.status).toBe(429); // rendu à l'appelant, qui le signalera
    expect(n).toBe(3); // 1 tentative + 2 réessais
  }, 15000);

  it('NE REJOUE PAS un 5xx — une écriture peut déjà être passée', async () => {
    // C'est la garde anti-doublon : rejouer un POST dont la réponse s'est
    // perdue créerait une seconde commande ou une seconde expédition.
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return reponse(500);
    }) as unknown as typeof fetch;

    const r = await callFetch(build());
    expect(r.status).toBe(500);
    expect(n).toBe(1);
  });

  it('ne rejoue pas une réponse valide', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return reponse(200);
    }) as unknown as typeof fetch;

    await callFetch(build());
    expect(n).toBe(1);
  });

  it('ne rejoue pas un 404', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return reponse(404);
    }) as unknown as typeof fetch;

    const r = await callFetch(build());
    expect(r.status).toBe(404);
    expect(n).toBe(1);
  });

  it('ignore un Retry-After aberrant plutôt que de bloquer la requête', async () => {
    let n = 0;
    const debut = Date.now();
    global.fetch = jest.fn(async () => {
      n++;
      // 3600 s : une valeur pareille retiendrait la requête une heure.
      return n === 1 ? reponse(429, { 'retry-after': '3600' }) : reponse(200);
    }) as unknown as typeof fetch;

    await callFetch(build());
    // Borné à 10 s ; le test resterait bloqué une heure sans ce plafond.
    expect(Date.now() - debut).toBeLessThan(11000);
  }, 15000);
});

/**
 * Brouillon en cours de calcul (422 « This order has not finished
 * calculating ») : Shopify recalcule un brouillon de façon asynchrone après
 * une modification de ses lignes. Ce 422 n'a rien écrit : on rejoue.
 */
describe('envoi de facture — brouillon en cours de calcul', () => {
  const vraiFetch = global.fetch;
  const vraisDelais = ShopifyService.DELAIS_CALCUL_MS;
  const calcul = () =>
    new Response(JSON.stringify({ errors: 'This order has not finished calculating, please try again later' }), { status: 422 });
  const ok = () => new Response(JSON.stringify({ draft_order_invoice: { to: 'a@b.fr' } }), { status: 200 });

  beforeEach(() => {
    ShopifyService.DELAIS_CALCUL_MS = [0, 0, 0, 0, 0];
  });
  afterEach(() => {
    global.fetch = vraiFetch;
    ShopifyService.DELAIS_CALCUL_MS = vraisDelais;
    jest.restoreAllMocks();
  });

  it('rejoue l’envoi jusqu’à la fin du calcul', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (++n < 3 ? calcul() : ok())) as unknown as typeof fetch;
    const r = await build().sendDraftOrderInvoice(1, { to: 'a@b.fr' });
    expect(r).toEqual({ to: 'a@b.fr' });
    expect(n).toBe(3);
  });

  it('ne rejoue pas un autre 422 (adresse invalide…)', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return new Response(JSON.stringify({ errors: { to: ['is invalid'] } }), { status: 422 });
    }) as unknown as typeof fetch;
    await expect(build().sendDraftOrderInvoice(1, { to: 'x' })).rejects.toThrow('422');
    expect(n).toBe(1);
  });

  it('abandonne après 6 essais si le calcul ne finit pas', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => {
      n++;
      return calcul();
    }) as unknown as typeof fetch;
    await expect(build().sendDraftOrderInvoice(1, {})).rejects.toThrow('not finished calculating');
    expect(n).toBe(6);
  });

  it('même rejeu pour la validation d’un brouillon', async () => {
    let n = 0;
    global.fetch = jest.fn(async () =>
      ++n < 2 ? calcul() : new Response(JSON.stringify({ draft_order: { order_id: 7 } }), { status: 200 }),
    ) as unknown as typeof fetch;
    expect(await build().completeDraftOrder(1, true)).toEqual({ order_id: 7 });
    expect(n).toBe(2);
  });
});
