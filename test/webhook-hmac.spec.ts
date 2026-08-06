import { createHmac } from 'crypto';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import type { ConfigService } from '@nestjs/config';
import type { Repository } from 'typeorm';
import type { Order } from '../src/database/entities/order.entity';
import type { ShopifyService } from '../src/shared/shopify.service';

/**
 * Vérification de signature des webhooks Shopify.
 *
 * C'est la porte d'entrée de TOUTES les commandes : l'URL est publique par
 * nature et l'enregistrement est un upsert sur l'id Shopify. Une régression ici
 * permettrait à quiconque d'écraser le montant et le statut de paiement d'une
 * vraie commande. Ce fichier a déjà connu deux commits contradictoires sur le
 * comportement « secret absent » — d'où ces tests.
 */
const SECRET = 'un-secret-de-webhook-partage';

function build(secret?: string): WebhooksService {
  const config = {
    get: (k: string) => (k === 'SHOPIFY_WEBHOOK_SECRET' ? secret : undefined),
  } as unknown as ConfigService;
  const shopify = {} as ShopifyService;
  const orders = {} as Repository<Order>;
  return new WebhooksService(config, shopify, orders);
}

function sign(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

describe('verifyHmac', () => {
  const body = Buffer.from(JSON.stringify({ id: 123, total_price: '49.90' }));

  it('accepte une signature valide', () => {
    expect(build(SECRET).verifyHmac(body, sign(body, SECRET))).toBe(true);
  });

  it('REJETTE quand le secret est absent (jamais de mode tolérant)', () => {
    // Une version antérieure renvoyait `true` ici, faisant de l'absence de
    // configuration le chemin nominal : n'importe qui pouvait poster.
    expect(build(undefined).verifyHmac(body, sign(body, SECRET))).toBe(false);
  });

  it('rejette une signature forgée avec un autre secret', () => {
    expect(build(SECRET).verifyHmac(body, sign(body, 'mauvais-secret'))).toBe(false);
  });

  it('rejette un corps modifié après signature', () => {
    const sig = sign(body, SECRET);
    const altere = Buffer.from(JSON.stringify({ id: 123, total_price: '0.01' }));
    expect(build(SECRET).verifyHmac(altere, sig)).toBe(false);
  });

  it('rejette une signature absente, vide ou de longueur différente', () => {
    const s = build(SECRET);
    expect(s.verifyHmac(body, undefined)).toBe(false);
    expect(s.verifyHmac(body, '')).toBe(false);
    expect(s.verifyHmac(body, 'trop-court')).toBe(false);
  });

  it('rejette un corps brut absent (rawBody non capturé)', () => {
    expect(
      build(SECRET).verifyHmac(undefined as unknown as Buffer, sign(body, SECRET)),
    ).toBe(false);
  });
});
