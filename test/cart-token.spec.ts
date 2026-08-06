import { CartTokenService } from '../src/cart/cart-token.service';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Setting } from '../src/database/entities/setting.entity';

/**
 * Jeton de possession d'un panier.
 *
 * Les routes `/api/cart` sont publiques et l'identifiant de draft order Shopify
 * est un ENTIER SÉQUENTIEL : il ne prouve rien. Sans ce jeton, `GET
 * /api/cart/:id` renvoyait le draft order brut — e-mail, téléphone, adresses et
 * `invoice_url`, un lien de paiement non authentifié — et n'importe qui pouvait
 * énumérer les paniers voisins ou vider celui d'un autre client.
 */
function build(secret?: string): CartTokenService {
  const config = {
    get: (k: string) => (k === 'CART_TOKEN_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  const settings = {
    findOne: async () => null,
    save: async (x: unknown) => x,
    create: (x: unknown) => x,
  } as unknown as Repository<Setting>;
  return new CartTokenService(config, settings);
}

describe('CartTokenService', () => {
  const SECRET = 'a'.repeat(64);

  it('accepte le jeton du panier auquel il appartient', async () => {
    const s = build(SECRET);
    await s.onModuleInit();
    expect(s.verify('1234567890123', s.sign('1234567890123'))).toBe(true);
  });

  it("refuse le jeton d'un AUTRE panier (énumération d'ids)", async () => {
    const s = build(SECRET);
    await s.onModuleInit();
    // Les ids Shopify se suivent : le voisin immédiat est le cas réaliste.
    expect(s.verify('1234567890124', s.sign('1234567890123'))).toBe(false);
  });

  it('refuse un jeton absent, vide ou arbitraire', async () => {
    const s = build(SECRET);
    await s.onModuleInit();
    expect(s.verify('1234567890123', undefined)).toBe(false);
    expect(s.verify('1234567890123', '')).toBe(false);
    expect(s.verify('1234567890123', 'deadbeef')).toBe(false);
  });

  it('refuse un jeton signé avec un autre secret', async () => {
    const a = build(SECRET);
    const b = build('b'.repeat(64));
    await a.onModuleInit();
    await b.onModuleInit();
    expect(a.verify('999', b.sign('999'))).toBe(false);
  });

  it('génère un secret aléatoire quand la base est indisponible', async () => {
    const config = { get: () => undefined } as unknown as ConfigService;
    const settings = {
      findOne: async () => {
        throw new Error('ECONNREFUSED');
      },
      save: async (x: unknown) => x,
      create: (x: unknown) => x,
    } as unknown as Repository<Setting>;
    const s = new CartTokenService(config, settings);
    // Ne doit pas lever : le démarrage ne dépend pas de la base.
    await expect(s.onModuleInit()).resolves.toBeUndefined();
    expect(s.verify('42', s.sign('42'))).toBe(true);
  });
});
