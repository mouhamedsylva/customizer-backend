import { periodStart } from '../src/admin/admin.service';
import { dateBoutique, minuitDans, plagePeriode } from '../src/admin/periodes';

/**
 * Bornes de période des filtres et de l'export comptable.
 *
 * Calendrier de la BOUTIQUE (Europe/Paris) : un mois commence le 1er à minuit
 * heure de Paris, comme dans les rapports Shopify. Les bornes sont des
 * instants, donc indépendantes du fuseau du serveur (TZ du conteneur).
 */
const CALENDAIRES = ['month', 'prev_month', 'quarter', 'year', 'prev_year'] as const;

function sousFuseau<T>(tz: string, fn: () => T): T {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = avant;
  }
}

describe('périodes — calendrier de la boutique (Paris)', () => {
  it('minuit à Paris : UTC+2 l’été, UTC+1 l’hiver', () => {
    expect(minuitDans(2026, 7, 1).toISOString()).toBe('2026-07-31T22:00:00.000Z');
    expect(minuitDans(2026, 0, 1).toISOString()).toBe('2025-12-31T23:00:00.000Z');
    // Jour du passage à l'heure d'été (29 mars 2026) : minuit est encore en UTC+1.
    expect(minuitDans(2026, 2, 29).toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });

  it('une commande du 1er août à 01:30 (Paris) est bien dans août', () => {
    const commande = new Date('2026-07-31T23:30:00Z'); // 01:30 à Paris
    const aout = plagePeriode('month', new Date('2026-08-15T12:00:00Z'));
    expect(commande.getTime()).toBeGreaterThanOrEqual(aout.debut!.getTime());
  });

  it('« mois précédent » est une plage CLOSE (le 1er octobre → septembre entier)', () => {
    const p = plagePeriode('prev_month', new Date('2026-10-01T08:00:00Z'));
    expect(p.debut!.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(p.fin!.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  it('janvier → mois précédent = décembre de l’année d’avant', () => {
    const p = plagePeriode('prev_month', new Date('2026-01-10T12:00:00Z'));
    expect(p.debut!.toISOString()).toBe('2025-11-30T23:00:00.000Z');
    expect(p.fin!.toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('le mois suit le calendrier de Paris, pas celui d’UTC', () => {
    // 31 juillet 23:30 UTC = 1er août 01:30 à Paris : on est déjà en août.
    const p = plagePeriode('month', new Date('2026-07-31T23:30:00Z'));
    expect(p.debut!.toISOString()).toBe('2026-07-31T22:00:00.000Z');
  });

  it('trimestre et année', () => {
    const now = new Date('2026-08-15T12:00:00Z');
    expect(plagePeriode('quarter', now).debut!.toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(plagePeriode('year', now).debut!.toISOString()).toBe('2025-12-31T23:00:00.000Z');
    const py = plagePeriode('prev_year', now);
    expect(py.debut!.toISOString()).toBe('2024-12-31T23:00:00.000Z');
    expect(py.fin!.toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('ne filtre pas sans période, ou pour « all »', () => {
    expect(periodStart(undefined)).toBeNull();
    expect(periodStart('all')).toBeNull();
    expect(periodStart('inconnu')).toBeNull();
  });

  it('donne la MÊME borne quel que soit le fuseau du serveur', () => {
    for (const p of CALENDAIRES) {
      const utc = sousFuseau('UTC', () => (periodStart(p) as Date).toISOString());
      const paris = sousFuseau('Europe/Paris', () => (periodStart(p) as Date).toISOString());
      const tokyo = sousFuseau('Asia/Tokyo', () => (periodStart(p) as Date).toISOString());
      expect(paris).toBe(utc);
      expect(tokyo).toBe(utc);
    }
  });

  it('date d’export dans le fuseau de la boutique', () => {
    expect(dateBoutique(new Date('2026-07-31T23:30:00Z'))).toBe('2026-08-01');
    expect(dateBoutique(null)).toBe('');
  });
});

describe('periodStart — fenêtres glissantes', () => {
  it('recule de la bonne durée depuis maintenant', () => {
    for (const [p, jours] of [
      ['7d', 7],
      ['30d', 30],
    ] as const) {
      const ecart = Date.now() - (periodStart(p) as Date).getTime();
      expect(ecart).toBeGreaterThan((jours - 0.1) * 86400000);
      expect(ecart).toBeLessThan((jours + 0.1) * 86400000);
    }
  });
});
