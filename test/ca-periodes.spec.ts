import { caParJour, caParMois, CommandeCa, joursDuMois } from '../src/admin/ca-periodes';

const cmd = (date: string, total: number, id = String(Math.random()), statut = 'paid'): CommandeCa => ({
  shopifyOrderId: id,
  totalPrice: String(total),
  financialStatus: statut,
  date: new Date(date),
});

/** « Maintenant » : 26 novembre 2026, 15 h à Paris. */
const MAINTENANT = new Date('2026-11-26T14:00:00Z');

describe('caParMois', () => {
  const commandes = [
    cmd('2026-10-05T10:00:00Z', 100),
    cmd('2026-10-20T10:00:00Z', 50),
    // 31/10 à 23 h 30 UTC = 1er novembre 00 h 30 à Paris → novembre.
    cmd('2026-10-31T23:30:00Z', 200),
    cmd('2026-11-10T10:00:00Z', 100),
    cmd('2025-11-10T10:00:00Z', 999), // autre année
  ];

  it('répartit par mois en heure de Paris, panier moyen et évolution', () => {
    const b = caParMois(commandes, 2026, MAINTENANT);
    expect(b.lignes).toHaveLength(12);
    expect(b.lignes[9]).toMatchObject({ numero: 10, nbCommandes: 2, caTtc: 150, panierMoyen: 75 });
    expect(b.lignes[10]).toMatchObject({ numero: 11, nbCommandes: 2, caTtc: 300, courant: true, futur: false, evolution: 100 });
    expect(b.lignes[11]).toMatchObject({ futur: true, caTtc: 0, evolution: null });
    expect(b.lignes[0]).toMatchObject({ nbCommandes: 0, caTtc: 0, panierMoyen: 0, evolution: null });
    expect(b.total).toEqual({ nbCommandes: 4, caTtc: 450, panierMoyen: 112.5 });
  });

  it('exclut les commandes manuelles non payées, garde celles payées', () => {
    const b = caParMois(
      [cmd('2026-03-01T10:00:00Z', 80, '-1', 'pending'), cmd('2026-03-02T10:00:00Z', 70, '-2', 'paid')],
      2026,
      MAINTENANT,
    );
    expect(b.total).toEqual({ nbCommandes: 1, caTtc: 70, panierMoyen: 70 });
  });

  it('année entièrement passée : aucun mois « à venir »', () => {
    expect(caParMois(commandes, 2025, MAINTENANT).lignes.every((l) => !l.futur && !l.courant)).toBe(true);
  });
});

describe('caParJour', () => {
  it('un élément par jour du mois (28, 30, 31)', () => {
    expect(joursDuMois(2026, 2)).toBe(28);
    expect(joursDuMois(2028, 2)).toBe(29);
    expect(caParJour([], 2026, 11, MAINTENANT).lignes).toHaveLength(30);
    expect(caParJour([], 2026, 12, MAINTENANT).lignes).toHaveLength(31);
  });

  it('jour en heure de Paris ; jour courant et jours à venir ; total = mois', () => {
    const commandes = [
      cmd('2026-11-09T23:30:00Z', 40), // 10/11 00 h 30 à Paris
      cmd('2026-11-10T08:00:00Z', 60),
      cmd('2026-11-26T09:00:00Z', 25),
    ];
    const b = caParJour(commandes, 2026, 11, MAINTENANT);
    expect(b.lignes[8]).toMatchObject({ numero: 9, nbCommandes: 0 });
    expect(b.lignes[9]).toMatchObject({ numero: 10, nbCommandes: 2, caTtc: 100, panierMoyen: 50 });
    expect(b.lignes[25]).toMatchObject({ numero: 26, courant: true, futur: false, caTtc: 25 });
    expect(b.lignes[26].futur).toBe(true);
    expect(b.total.caTtc).toBe(caParMois(commandes, 2026, MAINTENANT).lignes[10].caTtc);
  });

  it('mois passé : aucun jour à venir ; mois futur : tous à venir', () => {
    expect(caParJour([], 2026, 10, MAINTENANT).lignes.some((l) => l.futur)).toBe(false);
    expect(caParJour([], 2026, 12, MAINTENANT).lignes.every((l) => l.futur)).toBe(true);
  });
});
