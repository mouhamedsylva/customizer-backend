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
