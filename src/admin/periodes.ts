/**
 * PÉRIODES DES FILTRES ET DES EXPORTS — calendrier de la BOUTIQUE (Paris).
 *
 * Les bornes « mois / trimestre / année » étaient ancrées à minuit UTC : en
 * été, le mois commençait le 1er à 02:00 heure de Paris. Une commande passée
 * le 1er août à 01:30 (Paris) tombait dans juillet, et l'export comptable ne
 * correspondait plus aux rapports Shopify, établis dans le fuseau de la
 * boutique.
 *
 * Les bornes sont donc des INSTANTS (objets Date) correspondant à minuit
 * heure de Paris. Elles restent indépendantes du fuseau du serveur : un
 * instant est passé tel quel à MySQL, dans le même référentiel que les dates
 * stockées (le driver convertit les deux de la même façon).
 *
 * Les périodes calendaires ont aussi une borne de FIN. Sans elle, impossible
 * d'exporter un mois clos : le 1er octobre, « ce mois-ci » ne contient qu'une
 * journée. D'où « mois précédent ».
 */

export const FUSEAU_BOUTIQUE = 'Europe/Paris';

/** Décalage (ms) du fuseau par rapport à UTC à un instant donné. */
function decalage(instant: number, fuseau: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(instant))
      .map((x) => [x.type, x.value]),
  );
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return commeUtc - Math.floor(instant / 1000) * 1000;
}

/** Instant de minuit (heure du fuseau) le jour donné. `mois` de 0 à 11, débordement accepté. */
export function minuitDans(annee: number, mois: number, jour: number, fuseau = FUSEAU_BOUTIQUE): Date {
  const naif = Date.UTC(annee, mois, jour);
  // Deux passes : le décalage peut changer entre l'estimation et le résultat (passage à l'heure d'été).
  let t = naif - decalage(naif, fuseau);
  t = naif - decalage(t, fuseau);
  return new Date(t);
}

/** Année et mois (0-11) courants DANS le fuseau. */
function anneeMois(maintenant: Date, fuseau: string): { annee: number; mois: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuseau, year: 'numeric', month: '2-digit' })
      .formatToParts(maintenant)
      .map((x) => [x.type, x.value]),
  );
  return { annee: +p.year, mois: +p.month - 1 };
}

export interface Plage {
  debut: Date | null;
  /** Exclusive. null : jusqu'à maintenant. */
  fin: Date | null;
}

export function plagePeriode(
  period?: string,
  maintenant: Date = new Date(),
  fuseau = FUSEAU_BOUTIQUE,
): Plage {
  const { annee, mois } = anneeMois(maintenant, fuseau);
  switch (period) {
    case '7d':
      return { debut: new Date(maintenant.getTime() - 7 * 86400000), fin: null };
    case '30d':
      return { debut: new Date(maintenant.getTime() - 30 * 86400000), fin: null };
    case 'month':
      return { debut: minuitDans(annee, mois, 1, fuseau), fin: null };
    case 'prev_month':
      return {
        debut: minuitDans(annee, mois - 1, 1, fuseau),
        fin: minuitDans(annee, mois, 1, fuseau),
      };
    case 'quarter': {
      const q = Math.floor(mois / 3) * 3;
      return { debut: minuitDans(annee, q, 1, fuseau), fin: null };
    }
    case 'year':
      return { debut: minuitDans(annee, 0, 1, fuseau), fin: null };
    case 'prev_year':
      return { debut: minuitDans(annee - 1, 0, 1, fuseau), fin: minuitDans(annee, 0, 1, fuseau) };
    default:
      return { debut: null, fin: null }; // 'all' ou inconnu
  }
}

/** Date AAAA-MM-JJ dans le fuseau de la boutique (export comptable). */
export function dateBoutique(d: Date | string | null | undefined, fuseau = FUSEAU_BOUTIQUE): string {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(date.getTime())) return '';
  // en-CA formate en AAAA-MM-JJ.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
