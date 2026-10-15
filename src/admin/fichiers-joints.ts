/**
 * FICHIERS JOINTS À UNE COMMANDE par l'admin (BAT signé, maquette, consignes…),
 * affichés sur la carte du dashboard, la fiche de production et dans le ZIP.
 *
 * Stockés dans `orders.fichiersJoints` (colonne à part : la resynchronisation
 * Shopify réécrit `lineItems`, jamais cette colonne) et sur Cloudinary dans
 * `customizer/commandes/<commande>/` — dossier que le nettoyage automatique
 * des pièces de devis ne touche pas.
 */
import { randomUUID } from 'crypto';

export interface FichierJoint {
  id: string;
  libelle: string;
  nom: string;
  url: string;
  type: string;
  taille: number;
  /** Ressource Cloudinary, pour la suppression. */
  publicId?: string;
  resourceType?: 'image' | 'raw';
  ajoutePar: string;
  ajouteLe: string;
}

export const MAX_FICHIERS_JOINTS = 20;
export const TAILLE_MAX_FICHIER_JOINT = 10 * 1024 * 1024;

const CLOUDINAIRE = /^https:\/\/res\.cloudinary\.com\//;

/** Libellé affiché : une ligne, 80 caractères au plus ; repli sur le nom du fichier. */
export function libelleFichier(libelle: unknown, nomFichier: string): string {
  const l = String(libelle ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const base = l || String(nomFichier || '').trim() || 'Fichier';
  return base.length > 80 ? base.slice(0, 79) + '…' : base;
}

/** Liste valide lue en base (entrées incomplètes ou URL hors Cloudinary écartées). */
export function fichiersJointsValides(brut: unknown): FichierJoint[] {
  if (!Array.isArray(brut)) return [];
  return brut.filter(
    (f: any) => f && typeof f.id === 'string' && typeof f.libelle === 'string' && CLOUDINAIRE.test(String(f.url)),
  ) as FichierJoint[];
}

/** Nouvelle entrée, prête à être ajoutée à la liste. */
export function nouveauFichierJoint(p: {
  libelle: unknown;
  nom: string;
  url: string;
  type: string;
  taille: number;
  publicId?: string;
  resourceType?: 'image' | 'raw';
  ajoutePar: string;
  maintenant?: Date;
}): FichierJoint {
  return {
    id: randomUUID(),
    libelle: libelleFichier(p.libelle, p.nom),
    nom: String(p.nom || 'fichier').slice(0, 200),
    url: p.url,
    type: String(p.type || '').slice(0, 120),
    taille: Number(p.taille) || 0,
    ...(p.publicId ? { publicId: p.publicId } : {}),
    ...(p.resourceType ? { resourceType: p.resourceType } : {}),
    ajoutePar: String(p.ajoutePar || 'admin').slice(0, 200),
    ajouteLe: (p.maintenant || new Date()).toISOString(),
  };
}

/** Le fichier est-il une image (vignette) ? */
export function estImageJointe(f: Pick<FichierJoint, 'type' | 'url'>): boolean {
  return /^image\//i.test(f.type || '') || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(f.url || '');
}
