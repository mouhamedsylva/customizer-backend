/**
 * Articles d'un devis multi-produits, pour le chiffrer LIGNE PAR LIGNE.
 *
 * Le thème (conf-cart-quote.js, `requestMultiProductQuote`) envoie une ligne
 * de détail par article du panier : « 10× Patch personnalisé — Face : … ».
 * C'est la seule trace fiable des articles pour TOUS les devis — ceux
 * d'avant le 23 septembre 2026 n'ont pas de `familles`, et les familles
 * regroupent de toute façon plusieurs articles sous un seul prix.
 *
 * Tout ou rien : si la somme des quantités ne retombe pas sur `coin.qty`,
 * on renvoie null et la fenêtre de chiffrage garde son mode actuel. Un
 * découpage deviné ferait facturer de mauvaises quantités.
 */
export interface ArticleDevis {
  /** Nom du produit (« Patch personnalisé »), titre de la ligne Shopify. */
  libelle: string;
  /** Options choisies (« Face : … · Taille : 8 cm »), ou chaîne vide. */
  options: string;
  qty: number;
}

const LIGNE = /^\s*(\d+)\s*×\s*(.+?)\s*$/;

/** Lignes « N× Produit — options » d'une liste brute ; le reste est ignoré. */
export function lire(lignes: unknown): ArticleDevis[] {
  if (!Array.isArray(lignes)) return [];
  const out: ArticleDevis[] = [];
  for (const brut of lignes) {
    const m = LIGNE.exec(String(brut ?? ''));
    if (!m) continue; // pastille résumé « Commande sur devis : … », texte libre
    const qty = Number(m[1]);
    if (!Number.isInteger(qty) || qty <= 0) continue;
    const [libelle, ...reste] = m[2].split(' — ');
    out.push({
      libelle: libelle.trim().slice(0, 200) || 'Article',
      options: reste.join(' — ').trim().slice(0, 500),
      qty,
    });
  }
  return out;
}

/**
 * Lignes « N× … » IDENTIQUES fusionnées, quantités additionnées, à la place de
 * la première occurrence. Les lignes sans quantité (résumé « Commande sur
 * devis : … ») restent telles quelles, à leur place.
 *
 * Une répartition par tailles envoyait une ligne PAR PIÈCE : 33 fois
 * « 1× T-shirt coton — Couleur : Camel — M ». La fenêtre de chiffrage en
 * listait 33, et le brouillon Shopify recevait 33 lignes. Après fusion :
 * « 33× T-shirt coton — Couleur : Camel — M ». Des options différentes
 * (Camel M / Camel L) ne sont jamais fusionnées.
 *
 * SEULES LES LIGNES « 1× » se fusionnent — la signature d'une ligne par
 * pièce. Deux lignes « 10× Patch personnalisé » identiques restent deux
 * articles : ce sont deux designs, qui peuvent porter deux prix différents.
 */
export function regrouperLignes(lignes: unknown): string[] {
  if (!Array.isArray(lignes)) return [];
  const out: Array<{ texte: string; qty: number | null }> = [];
  const parTexte = new Map<string, { texte: string; qty: number | null }>();
  for (const brut of lignes) {
    const s = String(brut ?? '');
    const m = LIGNE.exec(s);
    if (!m) {
      out.push({ texte: s, qty: null });
      continue;
    }
    if (Number(m[1]) !== 1) {
      out.push({ texte: m[2], qty: Number(m[1]) }); // jamais fusionnée
      continue;
    }
    const deja = parTexte.get(m[2]);
    if (deja && deja.qty !== null) {
      deja.qty += 1;
      continue;
    }
    const e = { texte: m[2], qty: 1 };
    parTexte.set(m[2], e);
    out.push(e);
  }
  return out.map((e) => (e.qty === null ? e.texte : `${e.qty}× ${e.texte}`));
}

export function articlesDuDevis(quoteData: any): ArticleDevis[] | null {
  const coin = quoteData?.coin;
  if (!coin || quoteData?.group?.rows?.length) return null; // commande de groupe : autre mode
  const total = Number(coin.qty);
  if (!Number.isFinite(total) || total <= 0) return null;

  /* Lignes identiques REGROUPÉES : un article par produit et options, et non
     un par pièce (voir regrouperLignes). */
  const candidats = [
    lire(regrouperLignes(coin.details)),
    lire(
      (Array.isArray(coin.familles) ? coin.familles : []).flatMap((f: any) =>
        regrouperLignes(f?.lignes ?? []),
      ),
    ),
  ];
  for (const articles of candidats) {
    if (articles.length >= 2 && articles.reduce((s, a) => s + a.qty, 0) === total) {
      return articles;
    }
  }
  return null;
}

/** Une quantité acceptable : entier de 1 à 100 000. */
export function quantiteValide(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 100000;
}

/** Réécrit les quantités des lignes « N× … » d'une liste, dans l'ordre. */
function reecrire(lignes: unknown, qtes: number[]): { lignes: unknown; ok: boolean } {
  if (!Array.isArray(lignes)) return { lignes, ok: false };
  let k = 0;
  const out = lignes.map((brut) => {
    const s = String(brut ?? '');
    const m = LIGNE.exec(s);
    if (!m || k >= qtes.length) return brut;
    return s.replace(/^\s*\d+\s*×/, `${qtes[k++]}×`);
  });
  return { lignes: out, ok: k === qtes.length };
}

/**
 * Pour chaque ligne des familles (ordre aplati), l'indice de l'article de même
 * contenu dans `articles`. Chaque article sert une seule fois ; null si une
 * ligne n'a pas d'équivalent (devis retouché, données incohérentes).
 */
function rattacherFamilles(articles: ArticleDevis[], familles: any[]): number[] | null {
  const pris = new Set<number>();
  const cle = (a: ArticleDevis) => `${a.qty}|${a.libelle}|${a.options}`;
  const out: number[] = [];
  for (const ligne of familles.flatMap((f: any) => lire(f?.lignes))) {
    const i = articles.findIndex((a, j) => !pris.has(j) && cle(a) === cle(ligne));
    if (i < 0) return null;
    pris.add(i);
    out.push(i);
  }
  return out;
}

/**
 * Applique de NOUVELLES QUANTITÉS à un devis (correction par l'admin, le
 * client s'étant trompé), et renvoie le devis modifié — sans toucher à
 * l'original.
 *
 * - `quantites` : une par article (ordre de `articlesDuDevis`), ou une seule
 *   pour un devis à produit unique ;
 * - réécrit les « N× » de `details` et des `familles`, recalcule
 *   `familles[].qty` et `coin.qty` ;
 * - garde la quantité DEMANDÉE à l'origine (`coin.qtyDemandee`, posée une
 *   seule fois) et ajoute une entrée à `historique`.
 *
 * null si rien ne change ; lève une Error si les quantités ne correspondent
 * pas au devis (nombre, valeurs, commande de groupe).
 */
export function appliquerQuantites(
  quoteData: any,
  quantites: number[],
  admin: string,
  maintenant: Date = new Date(),
): any | null {
  const coin = quoteData?.coin;
  if (!coin || quoteData?.group?.rows?.length) {
    throw new Error('La quantité d’une commande de groupe se corrige ligne par ligne, pas ici.');
  }
  if (!quantites.length || !quantites.every(quantiteValide)) {
    throw new Error('Chaque quantité doit être un nombre entier entre 1 et 100 000.');
  }

  const articles = articlesDuDevis(quoteData);
  const avant = articles ? articles.map((a) => a.qty) : [Number(coin.qty) || 0];
  if (avant.length !== quantites.length) {
    throw new Error('La liste des articles du devis a changé : rechargez la page.');
  }
  if (avant.every((q, i) => q === quantites[i])) return null;

  const copie = JSON.parse(JSON.stringify(quoteData));
  const c = copie.coin;
  /* Même découpage que `articlesDuDevis` : lignes identiques regroupées, sans
     quoi 66 lignes « 1× » ne correspondraient pas aux 4 quantités reçues. */
  if (Array.isArray(c.details)) c.details = regrouperLignes(c.details);
  if (Array.isArray(c.familles)) {
    for (const f of c.familles) if (Array.isArray(f?.lignes)) f.lignes = regrouperLignes(f.lignes);
  }

  // `details` : réécrit s'il porte exactement ces lignes « N× ».
  const nbDetails = lire(c.details).length;
  if (nbDetails === quantites.length) c.details = reecrire(c.details, quantites).lignes;

  // `familles` : chaque ligne reçoit la quantité de SON article, puis total par famille.
  if (Array.isArray(c.familles)) {
    const nbFam = c.familles.reduce((n: number, f: any) => n + lire(f?.lignes).length, 0);
    if (nbFam === quantites.length) {
      /* ORDRE DES ARTICLES ≠ ORDRE DES FAMILLES. Les articles viennent de
         `details`, dans l'ordre du panier (Patch A, Sweat B, Patch C) ; les
         familles regroupent par produit (A, C | B). Appliquer les quantités
         dans l'ordre aplati donnait à Patch C la quantité du Sweat B — et ces
         quantités fausses servaient ensuite au palier de prix.
         On rattache donc chaque ligne de famille à l'article de MÊME contenu
         (produit, options, quantité d'origine). Si les articles viennent
         eux-mêmes des familles, l'ordre aplati EST le bon. */
      // Produit unique (articles null) : une seule ligne, rien à rattacher.
      const depuisDetails = !!articles && lire(c.details).length === quantites.length;
      const cible = depuisDetails ? rattacherFamilles(articles || [], c.familles) : null;
      if (depuisDetails && !cible) {
        throw new Error(
          'Impossible de rattacher les lignes des familles aux articles du devis : ' +
            'corrigez la quantité dans Shopify.',
        );
      }
      let k = 0;
      for (const f of c.familles) {
        const n = lire(f?.lignes).length;
        const qs = cible
          ? cible.slice(k, k + n).map((idx) => quantites[idx])
          : quantites.slice(k, k + n);
        f.lignes = reecrire(f.lignes, qs).lignes;
        if (n) f.qty = qs.reduce((s, q) => s + q, 0);
        k += n;
      }
    } else if (c.familles.length === 1 && quantites.length === 1) {
      c.familles[0].qty = quantites[0];
      if (lire(c.familles[0].lignes).length === 1) c.familles[0].lignes = reecrire(c.familles[0].lignes, quantites).lignes;
    }
  }

  const total = quantites.reduce((s, q) => s + q, 0);
  // Pastille résumé « Commande sur devis : … 70 pièce(s). » : total à jour.
  if (Array.isArray(c.details)) {
    c.details = c.details.map((d: unknown) =>
      typeof d === 'string' && !LIGNE.test(d) ? d.replace(/\b\d+(\s*pièce\(s\))/, `${total}$1`) : d,
    );
  }
  if (c.qtyDemandee === undefined) c.qtyDemandee = Number(coin.qty) || total;
  c.qty = total;

  copie.historique = [
    ...(Array.isArray(copie.historique) ? copie.historique : []),
    { date: maintenant.toISOString(), admin, action: 'quantites', avant, apres: [...quantites] },
  ];
  return copie;
}

/**
 * RETIRE des articles d'un devis (le client s'est trompé), et renvoie le devis
 * modifié — sans toucher à l'original.
 *
 * - `indices` : positions dans l'ordre de `articlesDuDevis` ;
 * - supprime leurs lignes « N× » de `details` et des `familles` (les lignes
 *   identiques étant d'abord regroupées, comme partout) ; une famille vidée
 *   disparaît ;
 * - met à jour `coin.qty`, le nom « (N articles) » et la pastille résumé ;
 * - garde la quantité demandée à l'origine et trace le retrait dans
 *   `historique`.
 *
 * Lève une Error pour un indice invalide, ou si tous les articles seraient
 * retirés : une facture doit garder au moins un article.
 */
export function retirerArticles(
  quoteData: any,
  indices: number[],
  admin: string,
  maintenant: Date = new Date(),
): any {
  const articles = articlesDuDevis(quoteData);
  if (!articles) throw new Error('Ce devis ne se découpe pas en articles : retirez la ligne dans Shopify.');
  const retires = new Set<number>();
  for (const i of indices) {
    if (!Number.isInteger(i) || i < 0 || i >= articles.length) {
      throw new Error('La liste des articles du devis a changé : rechargez la page.');
    }
    retires.add(i);
  }
  if (!retires.size) return JSON.parse(JSON.stringify(quoteData));
  if (retires.size >= articles.length) throw new Error('Il doit rester au moins un article sur la facture.');

  const copie = JSON.parse(JSON.stringify(quoteData));
  const c = copie.coin;
  if (Array.isArray(c.details)) c.details = regrouperLignes(c.details);
  if (Array.isArray(c.familles)) {
    for (const f of c.familles) if (Array.isArray(f?.lignes)) f.lignes = regrouperLignes(f.lignes);
  }
  const cle = (a: ArticleDevis) => `${a.qty}|${a.libelle}|${a.options}`;
  const depuisDetails = lire(c.details).length === articles.length;

  // `details` : par position si les articles en viennent, sinon par contenu.
  if (Array.isArray(c.details)) {
    let k = 0;
    const aEnlever = depuisDetails ? null : [...retires].map((i) => cle(articles[i]));
    c.details = c.details.filter((brut: unknown) => {
      const s = String(brut ?? '');
      if (!LIGNE.test(s)) return true; // résumé : gardé, mis à jour plus bas
      if (depuisDetails) return !retires.has(k++);
      const [a] = lire([s]);
      const j = a ? aEnlever!.indexOf(cle(a)) : -1;
      if (j < 0) return true;
      aEnlever!.splice(j, 1);
      return false;
    });
  }

  // `familles` : chaque ligne rattachée à SON article (l'ordre diffère de details).
  if (Array.isArray(c.familles)) {
    const cible = depuisDetails ? rattacherFamilles(articles, c.familles) : null;
    if (depuisDetails && !cible) {
      throw new Error('Impossible de rattacher les lignes des familles aux articles du devis : retirez la ligne dans Shopify.');
    }
    let pos = 0;
    for (const f of c.familles) {
      if (!Array.isArray(f?.lignes)) continue;
      f.lignes = f.lignes.filter((brut: unknown) => {
        if (!LIGNE.test(String(brut ?? ''))) return true;
        const idx = cible ? cible[pos] : pos;
        pos++;
        return !retires.has(idx);
      });
      f.qty = lire(f.lignes).reduce((s, a) => s + a.qty, 0);
    }
    c.familles = c.familles.filter((f: any) => !Array.isArray(f?.lignes) || lire(f.lignes).length > 0);
  }

  const gardes = articles.filter((_a, i) => !retires.has(i));
  const total = gardes.reduce((s, a) => s + a.qty, 0);
  const nbFamilles = Array.isArray(c.familles) ? c.familles.length : null;
  if (Array.isArray(c.details)) {
    c.details = c.details.map((d: unknown) => {
      if (typeof d !== 'string' || LIGNE.test(d)) return d;
      let s = d.replace(/\b\d+(\s*pièce\(s\))/, `${total}$1`).replace(/\b\d+(\s*ligne\(s\))/, `${gardes.length}$1`);
      if (nbFamilles !== null) s = s.replace(/\b\d+(\s*famille\(s\))/, `${nbFamilles}$1`);
      return s;
    });
  }
  if (typeof c.name === 'string') c.name = c.name.replace(/\(\d+ articles?\)/, `(${gardes.length} articles)`);
  if (c.qtyDemandee === undefined) c.qtyDemandee = Number(quoteData.coin.qty) || total;
  c.qty = total;

  copie.historique = [
    ...(Array.isArray(copie.historique) ? copie.historique : []),
    {
      date: maintenant.toISOString(),
      admin,
      action: 'retrait',
      retires: [...retires].sort((a, b) => a - b).map((i) => `${articles[i].qty}× ${articles[i].libelle}${articles[i].options ? ' — ' + articles[i].options : ''}`),
    },
  ];
  return copie;
}

/**
 * Articles d'un devis, y compris quand il n'en reste qu'UN (après un
 * retrait) : `articlesDuDevis` exige au moins deux articles pour distinguer
 * un devis multi-articles d'un devis à produit unique.
 */
export function articlesOuUnique(quoteData: any): ArticleDevis[] | null {
  const a = articlesDuDevis(quoteData);
  if (a) return a;
  const seul = lire(regrouperLignes(quoteData?.coin?.details));
  return seul.length === 1 && seul[0].qty === Number(quoteData?.coin?.qty) ? seul : null;
}
