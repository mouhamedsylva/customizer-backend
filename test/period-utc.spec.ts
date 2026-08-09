import { periodStart } from '../src/admin/admin.service';

/**
 * Bornes de période des filtres et de l'export comptable.
 *
 * Les dates sont stockées en colonnes MySQL `datetime`, un type SANS fuseau :
 * la valeur écrite est l'instant UTC. Les bornes calendaires utilisaient
 * `getFullYear()` / `getMonth()` et le constructeur `Date`, qui lisent et
 * écrivent en heure LOCALE.
 *
 * Tant que le serveur tourne en UTC — le cas aujourd'hui — local et UTC
 * coïncident et rien ne se voit. Le jour où quelqu'un pose `TZ=Europe/Paris`
 * sur le conteneur, la borne du 1er août devient le 31 juillet à 22 h UTC :
 * une commande du 31 juillet 23 h UTC apparaîtrait alors dans l'export de
 * juillet ET dans celui d'août, comptée deux fois chez le comptable.
 *
 * Ce fichier interdit ce retour en arrière, quel que soit le fuseau.
 */
const CALENDAIRES = ['month', 'quarter', 'year'] as const;

/** Exécute une fonction sous un fuseau donné, puis restaure l'original. */
function sousFuseau<T>(tz: string, fn: () => T): T {
  const avant = process.env.TZ;
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = avant;
  }
}

describe('periodStart — ancrage UTC', () => {
  it('place les bornes calendaires à minuit UTC', () => {
    for (const p of CALENDAIRES) {
      const d = periodStart(p) as Date;
      expect(d).not.toBeNull();
      expect(d.getUTCHours()).toBe(0);
      expect(d.getUTCMinutes()).toBe(0);
      expect(d.getUTCSeconds()).toBe(0);
      expect(d.getUTCMilliseconds()).toBe(0);
      expect(d.getUTCDate()).toBe(1);
    }
  });

  it('démarre le mois au 1er du mois UTC courant', () => {
    const d = periodStart('month') as Date;
    const now = new Date();
    expect(d.getUTCMonth()).toBe(now.getUTCMonth());
    expect(d.getUTCFullYear()).toBe(now.getUTCFullYear());
  });

  it('démarre le trimestre sur un mois multiple de 3', () => {
    const d = periodStart('quarter') as Date;
    expect([0, 3, 6, 9]).toContain(d.getUTCMonth());
    // Le trimestre ne peut pas commencer après le mois courant.
    expect(d.getUTCMonth()).toBeLessThanOrEqual(new Date().getUTCMonth());
  });

  it('démarre l’année au 1er janvier UTC', () => {
    const d = periodStart('year') as Date;
    expect(d.getUTCMonth()).toBe(0);
    expect(d.getUTCDate()).toBe(1);
  });

  it('ne filtre pas sans période, ou pour « all »', () => {
    expect(periodStart(undefined)).toBeNull();
    expect(periodStart('all')).toBeNull();
    expect(periodStart('inconnu')).toBeNull();
  });

  it('donne la MÊME borne quel que soit le fuseau du serveur', () => {
    // Le test décisif : c'est exactement le scénario qui casserait l'export.
    for (const p of CALENDAIRES) {
      const utc = sousFuseau('UTC', () => (periodStart(p) as Date).toISOString());
      const paris = sousFuseau('Europe/Paris', () =>
        (periodStart(p) as Date).toISOString(),
      );
      const tokyo = sousFuseau('Asia/Tokyo', () =>
        (periodStart(p) as Date).toISOString(),
      );
      expect(paris).toBe(utc);
      expect(tokyo).toBe(utc);
    }
  });
});

describe('periodStart — fenêtres glissantes', () => {
  it('recule de la bonne durée depuis maintenant', () => {
    for (const [p, jours] of [
      ['7d', 7],
      ['30d', 30],
    ] as const) {
      const ecart = Date.now() - (periodStart(p) as Date).getTime();
      // Tolérance large : seul l'ordre de grandeur importe.
      expect(ecart).toBeGreaterThan((jours - 0.1) * 86400000);
      expect(ecart).toBeLessThan((jours + 0.1) * 86400000);
    }
  });

  it('est insensible au fuseau, par construction', () => {
    const utc = sousFuseau('UTC', () => (periodStart('7d') as Date).getTime());
    const paris = sousFuseau('Europe/Paris', () =>
      (periodStart('7d') as Date).getTime(),
    );
    // Quelques millisecondes d'écart d'exécution, pas une heure.
    expect(Math.abs(paris - utc)).toBeLessThan(1000);
  });
});
