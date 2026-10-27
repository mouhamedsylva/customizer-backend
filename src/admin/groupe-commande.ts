/**
 * COMMANDE DE GROUPE : lecture compacte et contrôles automatiques.
 *
 * Le design d'un groupe est COMMUN ; seuls le nom, la taille et la couleur
 * changent d'une personne à l'autre. Le dashboard répétait pourtant, pour
 * chacune, toutes les vignettes et toutes les pastilles : trente blocs presque
 * identiques à faire défiler, au milieu desquels une erreur passait inaperçue
 * (#21189 : la ligne d'AITO portait le visuel « MOMO »).
 *
 * Ce module isole la logique — design commun, visuel propre à chaque
 * personne, anomalies — pour que le rendu (admin.view.ts) n'ait plus qu'à
 * l'afficher, et qu'elle soit testable sans HTML.
 *
 * Entrée : les lignes de commande APRÈS `avecTypoRetrouvee` (admin.view.ts),
 * c'est-à-dire avec les fichiers remplacés appliqués et `__typoRetrouvee`
 * attaché : une réparation faite depuis le VPS lève donc ses alertes.
 */
import { pngRegenere } from '../shared/zones-texte';

export interface LigneGroupe {
  /** Position de la ligne dans la commande (0-based). */
  index: number;
  nom: string;
  taille: string;
  couleur: string;
  qty: number;
  /** Planche `_Aperçu` de la personne, ou ''. */
  apercu: string;
  /** Côté du nom : face (défaut) ou dos, lu dans `_TexteZone`. */
  cote: 'face' | 'dos';
  /** Visuel du nom de CETTE personne (éventuellement redessiné), ou ''. */
  texte: string;
  /** Le thème a signalé le visuel du nom comme manquant. */
  texteManquant: boolean;
  /** La ligne de commande d'origine (pour le détail replié). */
  li: any;
}

export interface FichierCommun {
  nom: string;
  url: string;
}

const props = (li: any): Array<{ name: string; value: string }> =>
  Array.isArray(li?.properties) ? li.properties : [];

const valeur = (li: any, nom: string): string => {
  const p = props(li).find((x) => String(x?.name).toLowerCase() === nom.toLowerCase());
  return p ? String(p.value ?? '') : '';
};

const https = (u: unknown): u is string => typeof u === 'string' && /^https:\/\//i.test(u);
const estSvg = (u: string) => /\.svg(\?|#|$)/i.test(u) || /\/raw\/upload\//.test(u);

/** Lignes du groupe (celles qui portent `Liste`), dans l'ordre de la commande. */
export function lignesDuGroupe(items: any[]): LigneGroupe[] {
  const out: LigneGroupe[] = [];
  (Array.isArray(items) ? items : []).forEach((li, index) => {
    if (!valeur(li, 'Liste')) return; // article hors groupe (supplément manche…)
    const cote: 'face' | 'dos' = valeur(li, '_TexteZone') === 'b' ? 'dos' : 'face';
    const libelle = cote === 'dos' ? '_Texte dos' : '_Texte face';
    const brut = valeur(li, libelle);
    const texte = pngRegenere(li?.__typoRetrouvee, libelle) || (https(brut) ? brut : '');
    out.push({
      index,
      nom: valeur(li, 'Personne').trim(),
      taille: valeur(li, 'Taille'),
      couleur: valeur(li, 'Détails').replace(/^\s*couleur\s*:\s*/i, ''),
      qty: Number(li?.quantity) || 1,
      apercu: https(valeur(li, '_Aperçu')) ? valeur(li, '_Aperçu') : '',
      cote,
      texte,
      texteManquant: props(li).some((p) => /^_Texte (face|dos|poitrine droite) \(manquant\)$/i.test(String(p?.name))),
      li,
    });
  });
  return out;
}

/**
 * Fichiers IDENTIQUES sur toutes les lignes du groupe : logos, textes communs
 * et leurs SVG. La planche et le visuel du nom, propres à chacun, en sont
 * exclus. Séparés en images (vignettes) et fichiers de découpe (liens).
 */
export function designCommun(lignes: LigneGroupe[]): { images: FichierCommun[]; svgs: FichierCommun[] } {
  const vide = { images: [] as FichierCommun[], svgs: [] as FichierCommun[] };
  if (!lignes.length) return vide;
  const [premiere, ...autres] = lignes;
  const propre = (l: LigneGroupe) => (l.cote === 'dos' ? '_Texte dos' : '_Texte face');

  for (const p of props(premiere.li)) {
    const nom = String(p?.name ?? '');
    const url = String(p?.value ?? '');
    if (!nom.startsWith('_') || !https(url) || nom === '_Aperçu') continue;
    if (nom === propre(premiere) || nom === propre(premiere) + ' (SVG)') continue;
    const partout = autres.every((l) => valeur(l.li, nom) === url);
    if (!partout) continue;
    (estSvg(url) ? vide.svgs : vide.images).push({ nom: nom.replace(/^_/, ''), url });
  }
  return vide;
}

/**
 * Alertes par ligne, indexées par `LigneGroupe.index`. Une ligne sans alerte
 * n'a pas d'entrée.
 */
export function anomaliesGroupe(lignes: LigneGroupe[]): Map<number, string[]> {
  const alertes = new Map<number, string[]>();
  const ajouter = (i: number, msg: string) => {
    const l = alertes.get(i) || [];
    if (!l.includes(msg)) l.push(msg);
    alertes.set(i, l);
  };
  const cleNom = (n: string) => n.trim().toUpperCase();

  // 1) Même visuel de texte pour des noms différents (#21189).
  const nomsParTexte = new Map<string, Set<string>>();
  lignes.forEach((l) => {
    if (!l.texte || !l.nom) return;
    if (!nomsParTexte.has(l.texte)) nomsParTexte.set(l.texte, new Set());
    nomsParTexte.get(l.texte)!.add(cleNom(l.nom));
  });
  lignes.forEach((l) => {
    if (!l.texte || !l.nom) return;
    const noms = nomsParTexte.get(l.texte)!;
    if (noms.size < 2) return;
    const autres = lignes
      .filter((x) => x.texte === l.texte && cleNom(x.nom) !== cleNom(l.nom))
      .map((x) => x.nom);
    ajouter(l.index, `Même visuel de texte que ${[...new Set(autres)].join(', ')}`);
  });

  // 2) Visuel du nom manquant (signalé par le thème, ou absent alors que les autres en ont un).
  const auMoinsUnTexte = lignes.some((l) => l.texte);
  lignes.forEach((l) => {
    if (!l.nom) return; // répartition par tailles : pas de nom propre
    if (l.texteManquant || (auMoinsUnTexte && !l.texte)) ajouter(l.index, 'Visuel du nom manquant');
  });

  // 3) Nom en double.
  const compte = new Map<string, number>();
  lignes.forEach((l) => l.nom && compte.set(cleNom(l.nom), (compte.get(cleNom(l.nom)) || 0) + 1));
  lignes.forEach((l) => {
    if (l.nom && (compte.get(cleNom(l.nom)) || 0) > 1) ajouter(l.index, 'Nom en double dans la liste');
  });

  // 4) Planche absente, ou vignette de face seule alors que le dos ou les manches sont personnalisés.
  lignes.forEach((l) => {
    if (!l.apercu) {
      ajouter(l.index, 'Planche absente');
      return;
    }
    const autresVues = props(l.li).some((p) =>
      /^_(Logo (dos|manche (gauche|droite))|Texte dos)$/i.test(String(p?.name)),
    );
    if (autresVues && !/share_multi_/i.test(l.apercu)) ajouter(l.index, 'Planche incomplète (face seule)');
  });

  return alertes;
}
