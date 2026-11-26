/**
 * CHIFFRE D'AFFAIRES PAR MOIS ET PAR JOUR — fenêtre « Chiffre d'affaires ».
 *
 * Même règle que la carte « Chiffre d'affaires estimé » du dashboard
 * (admin.view.ts) : commandes du configurateur, montant TTC `totalPrice`,
 * commandes MANUELLES non payées exclues (une facture envoyée n'est qu'une
 * promesse ; payée, elle devient une commande Shopify qui compte).
 * Remboursements non déduits, comme sur la carte.
 *
 * Le jour et le mois d'une commande sont ceux de sa date EN HEURE DE PARIS
 * (dateBoutique) : une commande du 31/10 à 23 h 30 UTC (00 h 30 à Paris) compte
 * en novembre, comme dans les rapports Shopify et l'export comptable.
 */
import { estCommandeManuelle } from './commandes-manuelles';
import { dateBoutique } from './periodes';

export interface CommandeCa {
  shopifyOrderId: string;
  totalPrice: string | number | null;
  financialStatus: string | null;
  /** COALESCE(shopifyCreatedAt, receivedAt). */
  date: Date | string;
}

export interface LigneCa {
  /** 1 à 12 (vue par mois) ou 1 à 31 (vue par jour). */
  numero: number;
  nbCommandes: number;
  caTtc: number;
  panierMoyen: number;
  /** Variation (en %) par rapport à la ligne précédente ; null si non calculable. */
  evolution: number | null;
  /** Mois ou jour pas encore commencé. */
  futur: boolean;
  /** Mois ou jour en cours. */
  courant: boolean;
}

export interface BilanCa {
  lignes: LigneCa[];
  total: { nbCommandes: number; caTtc: number; panierMoyen: number };
}

const arrondi = (n: number) => Math.round(n * 100) / 100;

/** Compte-t-elle dans le chiffre d'affaires ? Même règle que la carte. */
export function compteDansCa(c: CommandeCa): boolean {
  return !(estCommandeManuelle(c.shopifyOrderId) && c.financialStatus !== 'paid');
}

function montant(c: CommandeCa): number {
  const n = parseFloat(String(c.totalPrice ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** { annee, mois (1-12), jour } de la commande, en heure de Paris ; null si date illisible. */
function jourParis(d: Date | string): { annee: number; mois: number; jour: number } | null {
  const s = dateBoutique(d);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? { annee: +m[1], mois: +m[2], jour: +m[3] } : null;
}

function bilan(cases: Array<{ nb: number; ca: number; futur: boolean; courant: boolean }>): BilanCa {
  const lignes: LigneCa[] = cases.map((c, i) => {
    const prec = i > 0 ? cases[i - 1] : null;
    return {
      numero: i + 1,
      nbCommandes: c.nb,
      caTtc: arrondi(c.ca),
      panierMoyen: c.nb ? arrondi(c.ca / c.nb) : 0,
      evolution: prec && prec.ca > 0 && !c.futur ? Math.round(((c.ca - prec.ca) / prec.ca) * 1000) / 10 : null,
      futur: c.futur,
      courant: c.courant,
    };
  });
  const nb = cases.reduce((s, c) => s + c.nb, 0);
  const ca = cases.reduce((s, c) => s + c.ca, 0);
  return { lignes, total: { nbCommandes: nb, caTtc: arrondi(ca), panierMoyen: nb ? arrondi(ca / nb) : 0 } };
}

/** Les 12 mois d'une année. */
export function caParMois(commandes: CommandeCa[], annee: number, maintenant: Date = new Date()): BilanCa {
  const auj = jourParis(maintenant)!;
  const cases = Array.from({ length: 12 }, (_x, i) => ({
    nb: 0,
    ca: 0,
    futur: annee > auj.annee || (annee === auj.annee && i + 1 > auj.mois),
    courant: annee === auj.annee && i + 1 === auj.mois,
  }));
  for (const c of commandes) {
    const j = jourParis(c.date);
    if (!j || j.annee !== annee || !compteDansCa(c)) continue;
    cases[j.mois - 1].nb++;
    cases[j.mois - 1].ca += montant(c);
  }
  return bilan(cases);
}

/** Nombre de jours d'un mois (1-12). */
export function joursDuMois(annee: number, mois: number): number {
  return new Date(Date.UTC(annee, mois, 0)).getUTCDate();
}

/** Les jours d'un mois (mois de 1 à 12). */
export function caParJour(
  commandes: CommandeCa[],
  annee: number,
  mois: number,
  maintenant: Date = new Date(),
): BilanCa {
  const auj = jourParis(maintenant)!;
  const avant = annee < auj.annee || (annee === auj.annee && mois < auj.mois);
  const ceMois = annee === auj.annee && mois === auj.mois;
  const cases = Array.from({ length: joursDuMois(annee, mois) }, (_x, i) => ({
    nb: 0,
    ca: 0,
    futur: !avant && (!ceMois || i + 1 > auj.jour),
    courant: ceMois && i + 1 === auj.jour,
  }));
  for (const c of commandes) {
    const j = jourParis(c.date);
    if (!j || j.annee !== annee || j.mois !== mois || !compteDansCa(c)) continue;
    cases[j.jour - 1].nb++;
    cases[j.jour - 1].ca += montant(c);
  }
  return bilan(cases);
}
