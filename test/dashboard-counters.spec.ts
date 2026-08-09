import {
  AdminService,
  ORDERS_LIMIT,
  QUOTES_LIMIT,
  periodStart,
} from '../src/admin/admin.service';
import { dashboardPage } from '../src/admin/admin.view';
import type { Repository } from 'typeorm';
import type { Order } from '../src/database/entities/order.entity';
import type { Quote } from '../src/database/entities/quote.entity';
import type { Design } from '../src/database/entities/design.entity';

/**
 * Compteurs d'auto-rafraîchissement du dashboard.
 *
 * Le front compare ces compteurs à ce qu'il affiche déjà et propose un
 * rechargement s'ils diffèrent. Ils DOIVENT donc être plafonnés comme les
 * listes : une boutique de 350 commandes comparait 350 (table entière) à 300
 * (liste tronquée), et la bannière « De nouvelles données sont disponibles »
 * réapparaissait toutes les 30 s sans qu'aucun rechargement ne l'éteigne.
 */
function build(counts: {
  orders: number;
  quotes: number;
  designs?: number;
  newOrders?: number;
  newQuotes?: number;
}): AdminService {
  const repo = (n: number, unseen = 0) =>
    ({
      count: async (opts?: { where?: { seen?: boolean } }) =>
        opts?.where?.seen === false ? unseen : n,
    }) as unknown as Repository<never>;

  return new AdminService(
    repo(counts.orders, counts.newOrders ?? 0) as Repository<Order>,
    repo(counts.quotes, counts.newQuotes ?? 0) as Repository<Quote>,
    repo(counts.designs ?? 0) as Repository<Design>,
  );
}

describe('AdminService.getStatus', () => {
  it('plafonne les compteurs aux limites des listes affichées', async () => {
    const s = build({ orders: 350, quotes: 640 });
    const st = await s.getStatus();
    expect(st.orders).toBe(ORDERS_LIMIT);
    expect(st.quotes).toBe(QUOTES_LIMIT);
  });

  it('laisse les compteurs intacts sous le plafond', async () => {
    const s = build({ orders: 42, quotes: 7 });
    const st = await s.getStatus();
    expect(st.orders).toBe(42);
    expect(st.quotes).toBe(7);
  });

  it('est stable d’un appel à l’autre au-delà du plafond', async () => {
    // C'est LE test qui verrouille la bannière : deux relevés successifs sur
    // une boutique saturée doivent être identiques, sinon le front conclut
    // « nouvelles données » à chaque sondage.
    const s = build({ orders: 350, quotes: 640 });
    const a = await s.getStatus();
    const b = await s.getStatus();
    expect(b.orders).toBe(a.orders);
    expect(b.quotes).toBe(a.quotes);
  });

  it('ne plafonne pas le compteur de nouveautés', async () => {
    // `newOrders` compte les non-vues : il doit rester exact, c'est lui qui
    // porte l'information utile à l'opérateur.
    const s = build({ orders: 350, quotes: 10, newOrders: 12 });
    const st = await s.getStatus();
    expect(st.newOrders).toBe(12);
  });
});

describe('Avertissement de troncature', () => {
  // On cherche la BALISE, pas la chaîne « trunc-note » : celle-ci figure aussi
  // dans la feuille de style, toujours présente. Un test qui la cherchait
  // brutalement passait au vert quelle que soit la longueur de la liste.
  const affiche = (html: string) => /<p class="trunc-note">/.test(html);

  const commande = (i: number) =>
    ({
      shopifyOrderId: String(i),
      orderNumber: i,
      customerName: `Client ${i}`,
      totalPrice: '10.00',
      lineItems: [],
      productionStatus: 'to_produce',
      financialStatus: 'paid',
      receivedAt: new Date(),
      shopifyCreatedAt: new Date(),
    }) as unknown as Order;

  const page = (n: number, limits?: { orders: number; quotes: number }) =>
    dashboardPage(
      Array.from({ length: n }, (_, i) => commande(i)),
      [],
      [],
      'https://exemple.fr',
      'boutique',
      limits ? { limits } : {},
    );

  const LIMITS = { orders: ORDERS_LIMIT, quotes: QUOTES_LIMIT };

  it('avertit quand la liste atteint le plafond', () => {
    expect(affiche(page(ORDERS_LIMIT, LIMITS))).toBe(true);
  });

  it('reste silencieux sous le plafond', () => {
    expect(affiche(page(12, LIMITS))).toBe(false);
  });

  it('reste silencieux si aucun plafond n’est transmis', () => {
    expect(affiche(page(ORDERS_LIMIT))).toBe(false);
  });

  it('nomme le nombre réellement affiché', () => {
    expect(page(ORDERS_LIMIT, LIMITS)).toContain(`${ORDERS_LIMIT} commandes`);
  });
});

describe('periodStart', () => {
  it('ne filtre pas pour « toutes périodes »', () => {
    expect(periodStart('all')).toBeNull();
    expect(periodStart(undefined)).toBeNull();
  });

  it('renvoie une borne passée pour les fenêtres glissantes', () => {
    const now = Date.now();
    const d7 = periodStart('7d');
    expect(d7).not.toBeNull();
    const ecart = now - (d7 as Date).getTime();
    // ~7 jours, à la seconde d'exécution près.
    expect(ecart).toBeGreaterThan(6.9 * 86400000);
    expect(ecart).toBeLessThan(7.1 * 86400000);
  });

  it('ancre « mois » au premier jour du mois courant', () => {
    const d = periodStart('month') as Date;
    expect(d.getDate()).toBe(1);
    expect(d.getMonth()).toBe(new Date().getMonth());
  });
});
