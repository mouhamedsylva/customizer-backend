/**
 * Rendu HTML du dashboard admin (page autonome, styles inline).
 * UI de production : scan rapide des commandes, détail dépliable, dark/light.
 */
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

/**
 * Échappement HTML.
 *
 * `\` est échappé en plus des cinq caractères habituels. Sans lui, une valeur
 * terminée par un antislash — `nom: "Bob\"` depuis le formulaire PUBLIC de
 * devis — échappait le guillemet fermant d'un argument `onclick="fn('…')"` :
 * la chaîne JavaScript ne se refermait pas et le champ suivant devenait du code
 * exécutable, dans une page sans CSP.
 *
 * Ceci ne rend PAS `esc()` sûr en contexte JavaScript : le parseur HTML décode
 * les entités AVANT que JS ne lise l'attribut. Les valeurs venant de sources
 * non fiables (formulaire de devis, checkout) passent donc par des `data-*`,
 * lus par un écouteur délégué.
 *
 * Quelques `onclick` interpolent encore une valeur, mais UNIQUEMENT des
 * identifiants générés par nous : UUID `char(36)` et `shopifyOrderId` (bigint).
 * Aucun n'est influençable par un tiers. Si un jour un identifiant devient
 * saisissable, il DOIT basculer en `data-*` — l'échappement ne suffira pas.
 */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"'\\]/g, (c) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
      '\\': '&#92;',
    }[c] as string),
  );
}
/**
 * Hôtes dont les images peuvent être affichées dans le dashboard.
 *
 * Ces URLs viennent des propriétés de commande et du formulaire PUBLIC de
 * devis : elles sont donc contrôlables par un tiers. Or toute URL acceptée est
 * chargée AUTOMATIQUEMENT à l'ouverture de la page — une adresse arbitraire
 * révélait l'IP, l'User-Agent et le Referer de l'admin à un serveur tiers, et
 * servait d'accusé de lecture.
 */
/*
 * Volontairement RESTREINTE aux deux hôtes qui servent les assets de cette
 * application. Une liste plus large avait été essayée puis retirée :
 * `myshopify.com` autorise n'importe quelle boutique — or une boutique de
 * développement se crée gratuitement en deux minutes. Un tiers obtenait ainsi
 * une URL de confiance, chargée AUTOMATIQUEMENT à l'ouverture du dashboard,
 * qui lui révélait l'IP, l'User-Agent et le Referer de l'administrateur.
 * Même raisonnement pour les apex `cloudinary.com` / `shopifycdn.*`.
 */
const IMG_HOSTS = [
  'res.cloudinary.com', 
  'cdn.shopify.com', 
  'massacre-officiel.com'
];

function isAllowedImgHost(u: string): boolean {
  try {
    const { hostname, protocol } = new URL(u);
    if (protocol !== 'https:') return false;
    const h = hostname.toLowerCase();
    return IMG_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch {
    return false;
  }
}

/**
 * Est-ce une URL d'image affichable ?
 *
 * L'hôte est la vraie garantie ; l'extension n'est qu'un indice. On la teste
 * sur le CHEMIN seul et ancrée en fin : `https://evil.com/a.png/../payload`
 * ne doit pas passer, mais `…/a.png?v=2` doit passer.
 *
 * Une URL SANS extension est acceptée si l'hôte est de confiance : Cloudinary
 * sert des images transformées (`f_auto`, redimensionnements) dont l'URL n'a
 * pas de suffixe. Les rejeter faisait disparaître des visuels du dashboard ET
 * des fiches de production imprimées — l'atelier produisait à l'aveugle, sans
 * le moindre message d'erreur.
 *
 * `.svg` reste exclu : c'est un format XML, et ces URLs sont chargées
 * automatiquement à l'ouverture de la page.
 */
function isImg(u: unknown): u is string {
  if (typeof u !== 'string') return false;

  /* Data-URL : c'est le format NOMINAL des aperçus de devis, générés au
     navigateur (cf. create-quote.dto.ts). Les rejeter les faisait disparaître
     du dashboard ET des fiches de production imprimées — et, n'étant ni image
     ni lien, la chaîne base64 de plusieurs Mo était rendue en CLAIR dans le
     HTML de la page. Le type MIME est vérifié, et `svg+xml` exclu comme pour
     les URLs distantes. */
  if (u.startsWith('data:')) {
    return /^data:image\/(png|jpe?g|jpg|webp|gif|avif);base64,/i.test(u);
  }

  if (!isAllowedImgHost(u)) return false;
  let path: string;
  try {
    path = new URL(u).pathname;
  } catch {
    return false;
  }
  if (/\.svg$/i.test(path)) return false;
  // Extension d'image reconnue, ou aucune extension du tout (image transformée).
  return (
    /\.(png|jpe?g|webp|gif|avif)$/i.test(path) || !/\.[a-z0-9]{1,5}$/i.test(path)
  );
}
function isUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}
function money(amount: unknown): string {
  const n = parseFloat(String(amount ?? ''));
  if (Number.isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',') + ' €';
}

/**
 * Montant ABRÉGÉ pour la carte de statistique : « 12,4 k€ », « 1,05 M€ ».
 *
 * Le montant exact (`money`) est conservé partout ailleurs — sur une commande
 * ou un devis, arrondir serait une perte d'information. Ici la carte a une
 * largeur fixe et le chiffre est un ordre de grandeur : à 1 234 567,89 €, la
 * version longue débordait ou rognait, et forçait toute la rangée à s'élargir.
 *
 * Le seuil est à 10 000 : en dessous, « 9 999,00 € » tient sans gêne et reste
 * plus parlant qu'un « 10,0 k€ » arrondi.
 *
 * @returns le texte affiché et le montant exact, pour l'infobulle
 */
function moneyCompact(amount: unknown): { texte: string; exact: string } {
  const n = parseFloat(String(amount ?? ''));
  if (Number.isNaN(n)) return { texte: '0,00 €', exact: '0,00 €' };

  const exact = money(n);
  const absolu = Math.abs(n);

  /* Une décimale au-delà de 100 (« 124 k€ » plutôt que « 124,3 k€ ») : à cette
     échelle la décimale n'apporte rien et rallonge le chiffre. */
  const abreger = (valeur: number, suffixe: string): string => {
    const reduit = n / valeur;
    const decimales = Math.abs(reduit) >= 100 ? 0 : 1;
    return reduit.toFixed(decimales).replace('.', ',') + ' ' + suffixe;
  };

  /* Seuils légèrement sous le palier : à 999 999 €, arrondir en milliers
     donnerait « 1000 k€ », plus long ET moins juste que « 1,0 M€ ». On bascule
     donc à l'unité supérieure dès que l'arrondi y mènerait. */
  if (absolu >= 999_500_000) return { texte: abreger(1_000_000_000, 'Md€'), exact };
  if (absolu >= 999_500) return { texte: abreger(1_000_000, 'M€'), exact };
  if (absolu >= 10_000) return { texte: abreger(1_000, 'k€'), exact };
  return { texte: exact, exact };
}
function initials(name: unknown): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '·';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}
function fdate(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}
function ftime(d: Date | string | null | undefined): string {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
/** Nombre de jours écoulés depuis une date (0 si aujourd'hui / inconnue). */
function daysSince(d: Date | string | null | undefined): number {
  if (!d) return 0;
  const ms = Date.now() - new Date(d).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}

/**
 * 🆕 Détecte si plusieurs line items partagent le même _sizeGroupSummary
 * (commande groupée par tailles via le modal quantités)
 */
function getSizeGroupSummary(items: any[]): string | null {
  if (!items || items.length === 0) return null;

  /* On balaie TOUS les articles, pas seulement le premier.
     Deux cas échappaient à l'ancienne version :
       - un article hors groupe placé en tête (ajout unitaire) faisait
         retourner null, et le groupe n'était pas détecté du tout ;
       - une commande groupée sur UNE seule taille (une ligne, quantité 3)
         était écartée par le test « plusieurs articles le partagent ».
     La présence de la propriété suffit : elle n'est posée que par la modale
     de commande groupée. */
  for (const it of items) {
    const summary = it?.properties?.find?.(
      (p: any) => p?.name === '_sizeGroupSummary',
    )?.value;
    if (typeof summary === 'string' && summary.trim()) return summary;
  }
  return null;
}

/**
 * 🆕 Génère un tableau HTML récapitulatif des quantités par taille
 * pour les commandes groupées
 */
function renderSizeGroupTable(items: any[], summary: string): string {
  // Compter les quantités par taille
  const sizeQtys: Record<string, number> = {};

  items.forEach((item: any) => {
    /* Seules les lignes DU GROUPE comptent : un article ajouté à l'unité dans
       la même commande porte aussi une taille, et l'inclure ici gonflerait le
       total du groupe. */
    const inGroup =
      item?.properties?.find?.((p: any) => p?.name === '_sizeGroupSummary')?.value === summary;
    if (!inGroup) return;

    const size = item?.properties?.find?.((p: any) => p?.name === 'Taille')?.value;
    if (size && typeof size === 'string') {
      /* `quantity` traverse le webhook puis une colonne JSON sans jamais être
         normalisé : rien ne garantit que ce soit un nombre. Sans `Number()`,
         deux lignes à "2" et "3" donnaient la CHAÎNE "023" — le dashboard
         affichait 23 pièces là où la fiche de production, elle, en comptait 5.
         Même règle que sheetSizeTable() : on ignore 0, les négatifs et
         l'illisible plutôt que de les compter pour 1. */
      const qty = Number(item?.quantity);
      if (Number.isFinite(qty) && qty >= 1) {
        sizeQtys[size] = (sizeQtys[size] || 0) + qty;
      }
    }
  });
  
  if (Object.keys(sizeQtys).length === 0) return '';
  
  // Ordre de tri des tailles
  const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  
  const rows = Object.entries(sizeQtys)
    .sort(([a], [b]) => {
      const idxA = sizeOrder.indexOf(a);
      const idxB = sizeOrder.indexOf(b);
      // Si les deux sont dans l'ordre, trier normalement
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      // Sinon, mettre les inconnus à la fin
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return 0;
    })
    .map(([size, qty]) => `
      <tr>
        <td><strong>${esc(size)}</strong></td>
        <td class="num">${qty}</td>
      </tr>
    `).join('');
  
  const total = Object.values(sizeQtys).reduce((sum, qty) => sum + qty, 0);
  
  return `
    <div class="size-group-recap">
      <div class="lbl section-lbl">📦 COMMANDE GROUPÉE PAR TAILLES</div>
      <div class="grp-list-wrap">
        <table class="grp-list">
          <thead>
            <tr>
              <th>TAILLE</th>
              <th class="num">QUANTITÉ</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>TOTAL</strong></td>
              <td class="num"><strong>${total} pièce${total > 1 ? 's' : ''}</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

/**
 * Tableau COULEUR × TAILLE pour la FICHE DE PRODUCTION.
 *
 * La fiche est une page autonome (styles en dur, pensée pour l'impression) :
 * elle ne peut pas réutiliser renderSizeGroupTable(), qui dépend des classes
 * et des variables du dashboard. Même donnée, présentation adaptée au papier.
 *
 * @returns '' si la commande n'est pas groupée par tailles.
 */
function sheetSizeTable(items: any[]): string {
  const summary = getSizeGroupSummary(items);
  if (!summary) return '';

  const prop = (it: any, name: string) =>
    it?.properties?.find?.((p: any) => p?.name === name)?.value;

  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  const byColor = new Map<string, Record<string, number>>();
  const sizeSet = new Set<string>();

  for (const it of items || []) {
    // Comme dans renderSizeGroupTable : on n'agrège que les lignes du groupe.
    if (prop(it, '_sizeGroupSummary') !== summary) continue;

    const size = String(prop(it, 'Taille') || '?').trim();
    /* La couleur arrive dans la propriété « Détails » (voir la construction du
       panier dans recapitulatif.liquid), sous la forme « Couleur : Black ».
       Replis : « Couleur » si le nom change un jour, puis la variante Shopify,
       qui porte aussi la teinte. */
    const rawColor = String(
      prop(it, 'Détails') || prop(it, 'Couleur') || it?.variantTitle || '—',
    ).trim();
    // On ne garde que la valeur : « Couleur : Black » -> « Black ».
    const color = rawColor.replace(/^couleur\s*:\s*/i, '').trim() || '—';
    const qty = Number(it?.quantity) || 0;
    if (qty < 1) continue;
    sizeSet.add(size);
    if (!byColor.has(color)) byColor.set(color, {});
    const row = byColor.get(color)!;
    row[size] = (row[size] || 0) + qty;
  }

  if (!sizeSet.size) return '';

  const sizes = [...sizeSet].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const colTotals: Record<string, number> = {};
  let grand = 0;

  const body = [...byColor.entries()]
    .map(([color, counts]) => {
      const cells = sizes
        .map((sz) => {
          const n = counts[sz] || 0;
          colTotals[sz] = (colTotals[sz] || 0) + n;
          grand += n;
          // Un zéro plein alourdit la lecture : on le laisse en gris pâle.
          return `<td class="num${n ? '' : ' zero'}">${n || '·'}</td>`;
        })
        .join('');
      const rowTotal = sizes.reduce((s, sz) => s + (counts[sz] || 0), 0);
      return `<tr><th scope="row">${esc(color)}</th>${cells}<td class="num tot">${rowTotal}</td></tr>`;
    })
    .join('');

  return `
    <div class="ps-block">
      <div class="ps-lbl">Répartition par taille</div>
      <table class="ps-grid">
        <thead>
          <tr>
            <th scope="col">Couleur</th>
            ${sizes.map((sz) => `<th scope="col" class="num">${esc(sz)}</th>`).join('')}
            <th scope="col" class="num tot">Total</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
        <tfoot>
          <tr>
            <th scope="row">Total</th>
            ${sizes.map((sz) => `<td class="num">${colTotals[sz] || 0}</td>`).join('')}
            <td class="num tot">${grand}</td>
          </tr>
        </tfoot>
      </table>
    </div>`;
}

/**
 * Réduit une commande groupée par tailles à UNE ligne par design.
 *
 * Shopify crée une ligne par taille (même produit, même visuel) : les lister
 * toutes affichait quatre fois le même sweatshirt. Le détail par taille est
 * déjà porté par renderSizeGroupTable().
 *
 * Les lignes conservées cumulent la quantité du groupe et perdent leurs
 * propriétés propres à une taille (Taille, Ligne n/N), qui n'auraient plus de
 * sens sur une ligne agrégée.
 *
 * @returns les articles à afficher — inchangés si la commande n'est pas groupée.
 */
function collapseSizeGroup(items: any[]): any[] {
  if (!getSizeGroupSummary(items)) return items || [];

  const prop = (it: any, name: string) =>
    it?.properties?.find?.((p: any) => p?.name === name)?.value;

  // Regroupement par design : un même visuel peut couvrir plusieurs tailles.
  // À défaut de visuel identifiable, le titre + la variante font la clé.
  const groups = new Map<string, any>();

  for (const it of items || []) {
    const summary = prop(it, '_sizeGroupSummary');
    if (!summary) {
      // Article hors groupe (ex. ajout unitaire) : conservé tel quel.
      groups.set(`solo:${groups.size}`, it);
      continue;
    }
    const key = [it?.title, it?.variantTitle, summary].join('|');
    const seen = groups.get(key);
    if (!seen) {
      groups.set(key, {
        ...it,
        quantity: Number(it?.quantity) || 1,
        // On retire ce qui ne vaut que pour une taille précise.
        properties: (it?.properties || []).filter(
          (p: any) => p?.name !== 'Taille' && !/^Ligne\b/i.test(String(p?.name || '')),
        ),
      });
    } else {
      seen.quantity = (Number(seen.quantity) || 0) + (Number(it?.quantity) || 1);
    }
  }

  return [...groups.values()];
}

const STYLE = `
:root{
  --paper:#fbfaf8; --surface:#ffffff; --raise:#f6f4f0;
  --ink:#1b1f24; --muted:#8b8478; --faint:#b3ada2;
  --line:#e9e6e0; --line-soft:#f0ede8;
  --accent:#c2410c; --accent-soft:#fbeae1;
  --ok:#3f7d4e; --ok-soft:#e7f0e9;
  --warn:#b45309; --warn-soft:#fbefd9;
  --danger:#c0392b; --danger-soft:#fbe6e3;
  --shadow:0 1px 2px rgba(27,31,36,.04),0 8px 24px rgba(27,31,36,.05);
  --shadow-hover:0 2px 4px rgba(27,31,36,.05),0 14px 34px rgba(27,31,36,.10);
  --radius:14px;
}
/* Thème CLAIR par défaut : plus de bascule automatique sur la préférence
   système. Le sombre ne s'applique que si l'utilisateur le choisit
   explicitement (data-theme="dark", mémorisé dans localStorage). */
:root[data-theme="light"]{
  --paper:#fbfaf8; --surface:#ffffff; --raise:#f6f4f0;
  --ink:#1b1f24; --muted:#8b8478; --faint:#b3ada2;
  --line:#e9e6e0; --line-soft:#f0ede8;
  --accent:#c2410c; --accent-soft:#fbeae1;
  --ok:#3f7d4e; --ok-soft:#e7f0e9; --warn:#b45309; --warn-soft:#fbefd9;
  --danger:#c0392b; --danger-soft:#fbe6e3;
  --shadow:0 1px 2px rgba(27,31,36,.04),0 8px 24px rgba(27,31,36,.05);
  --shadow-hover:0 2px 4px rgba(27,31,36,.05),0 14px 34px rgba(27,31,36,.10);
}
/* Thème sombre — palette Night Owl (Sarah Drasner, VS Code).
   Bleu nuit profond plutôt que gris neutre, accents saturés froids.
   Couleurs d'origine : fond #011627, panneaux #0b2942, texte #d6deeb,
   accent cyan #7fdbca, bleu #82aaff, orange #f78c6c, rouge #ef5350. */
:root[data-theme="dark"]{
  --paper:#011627; --surface:#0b2942; --raise:#1d3b53;
  --ink:#d6deeb; --muted:#8badc1; --faint:#5f7e97;
  --line:#1d3b53; --line-soft:#122d42;
  --accent:#7fdbca; --accent-soft:#0e3a3a;
  --ok:#addb67; --ok-soft:#16351f;
  --warn:#ecc48d; --warn-soft:#3a2f1c;
  --danger:#ef5350; --danger-soft:#3d1f22;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 12px 30px rgba(0,0,0,.45);
  --shadow-hover:0 2px 6px rgba(0,0,0,.5),0 18px 40px rgba(0,0,0,.6);
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  background:var(--paper); color:var(--ink);
  -webkit-font-smoothing:antialiased; line-height:1.5;
}
.mono{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.lbl{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}

/* Top bar */
.topbar{
  position:sticky;top:0;z-index:20;background:var(--surface);
  border-bottom:1px solid var(--line);
  display:flex;align-items:center;justify-content:space-between;
  padding:0 clamp(16px,4vw,32px);height:60px;
}
.brand{display:flex;align-items:center;gap:12px}
.brand-mark{
  width:34px;height:34px;border-radius:9px;flex-shrink:0;
  background:linear-gradient(135deg,var(--accent),#e2612a);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;
  box-shadow:0 2px 8px rgba(194,65,12,.3);
}
/* La pastille portait un caractère texte ; elle accueille désormais une icône,
   qui a besoin d'une taille explicite. */
.brand-mark svg{width:18px;height:18px;display:block}
.brand-txt b{font-size:14px;font-weight:800;letter-spacing:-.01em;display:block}
.brand-txt span{font-size:11px;color:var(--muted)}
.topbar-actions{display:flex;align-items:center;gap:14px}
.theme-btn,.logout{
  font-size:12px;color:var(--muted);background:none;border:none;cursor:pointer;
  text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:8px;
}
.theme-btn:hover,.logout:hover{color:var(--ink);background:var(--raise)}
/* Déconnexion : action de sortie, signalée en rouge (règle placée après la
   règle commune .theme-btn,.logout pour l'emporter). */
.logout{color:var(--danger);font-weight:600}
.logout:hover{color:#fff;background:var(--danger)}
.logout svg{flex:none}

/* ── Menu « Paramètres » ─────────────────────────────────────────────────
   Regroupe Prix, Réglages, Admins, Mon compte et Thème. Même vocabulaire
   visuel que le panneau des notifications : même rayon, même ombre, même
   flèche d'ancrage — deux panneaux voisins dans la barre, ils doivent se
   ressembler. */
.menu-wrap{position:relative}
.menu-caret{flex:none;opacity:.6;transition:transform .15s ease}
.menu-wrap.open .menu-caret{transform:rotate(180deg)}
/* Déclencheur ouvert : il reste allumé tant que son panneau l'est. */
.menu-wrap.open #cog-btn{color:var(--ink);background:var(--raise)}
.cog-menu{
  display:none;position:absolute;right:0;top:calc(100% + 10px);z-index:60;
  width:262px;max-width:calc(100vw - 32px);padding:6px;
  background:var(--surface);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 18px 44px rgba(0,0,0,.18);
}
.cog-menu.open{display:block;animation:notifIn .16s ease-out}
.cog-menu::before{
  content:'';position:absolute;top:-6px;right:18px;width:11px;height:11px;
  background:var(--surface);border-left:1px solid var(--line);border-top:1px solid var(--line);
  transform:rotate(45deg);
}
.cog-item{
  position:relative;                        /* passe au-dessus de la flèche */
  display:flex;align-items:center;gap:11px;width:100%;
  padding:9px 10px;border:none;background:none;cursor:pointer;
  font:inherit;color:var(--ink);text-align:left;border-radius:9px;
}
.cog-item:hover{background:var(--paper)}
.cog-item:hover svg{color:var(--accent)}
.cog-item svg{flex:none;color:var(--muted)}
.cog-item span{display:flex;flex-direction:column;gap:1px;min-width:0}
.cog-item b{font-size:13px;font-weight:600}
/* L'adresse e-mail peut être longue : elle se coupe plutôt que d'élargir. */
.cog-item small{
  font-size:11px;color:var(--muted);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.cog-sep{height:1px;background:var(--line-soft);margin:5px 8px}

.wrap{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,34px) clamp(16px,4vw,32px) 80px}

/* Stat strip */
/* Le minimum de colonne tient compte du plus long libellé (~150px à 10px en
   capitales), du médaillon (42px) et des marges : en dessous, l'étiquette
   serait tronquée avant que la grille ne se réorganise. */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:14px;margin-bottom:26px}

/* Chaque carte porte sa propre teinte via --t : quatre mesures distinctes se
   reconnaissent alors à la couleur, sans lire le libellé. La teinte est posée
   par les classes .t-* plus bas ; l'orange de la marque reste sur la carte
   « À fabriquer », la seule qui appelle une action. */
.stat{
  --t:var(--accent);
  position:relative;overflow:hidden;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  /* Le filet coloré occupe 3px à gauche : le contenu est décalé d'autant. */
  padding:17px 18px 17px 21px;box-shadow:var(--shadow);
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  transition:border-color .16s, transform .16s, box-shadow .16s;
}
/* Filet coloré à gauche : il signe la carte sans peser sur le fond. */
.stat::before{
  content:'';position:absolute;left:0;top:0;bottom:0;width:3px;
  background:var(--t);opacity:.85;
}
.stat:hover{
  border-color:color-mix(in srgb,var(--t) 42%,var(--line));
  transform:translateY(-2px);
  box-shadow:0 10px 26px rgba(0,0,0,.09);
}
/* L'écart sépare le chiffre de son étiquette. Trop serré, les deux se lisent
   comme un seul bloc ; il respire à 9px. */
.stat-body{min-width:0;display:flex;flex-direction:column-reverse;gap:9px}
.stat .num{font-size:27px;font-weight:800;letter-spacing:-.02em;line-height:1.05;color:var(--ink)}
/* Libellé en capitales : il devient une étiquette, le chiffre garde la vedette.

   Taille et espacement sont calés sur le plus long des quatre — « Chiffre
   d'affaires estimé », 25 caractères — pour qu'il tienne sur une seule ligne.
   D'où 10px et un interlettrage réduit, appliqués à TOUTES les cartes : des
   étiquettes de tailles différentes dans une même rangée se verraient. */
.stat .cap{
  color:var(--muted);font-size:10px;font-weight:700;
  letter-spacing:.03em;text-transform:uppercase;line-height:1.35;
  /* Une ligne, toujours. Si la colonne devient trop étroite pour le tenir,
     l'ellipse vaut mieux qu'un débordement hors de la carte. */
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.stat.accent .num{color:var(--t)}

/* Médaillon de l'icône, teinté par la carte. */
.stat-ico{
  flex:none;width:42px;height:42px;border-radius:12px;
  display:grid;place-items:center;
  background:color-mix(in srgb,var(--t) 12%,transparent);
  color:var(--t);
  transition:background .16s, transform .16s;
}
.stat-ico svg{width:20px;height:20px}
.stat:hover .stat-ico{
  background:color-mix(in srgb,var(--t) 19%,transparent);
  transform:scale(1.06);
}

/* Les teintes, calibrées pour le fond clair : assez sombres pour rester
   lisibles sur blanc. */
.stat.t-blue{--t:#2f74d0}
.stat.t-green{--t:#18915f}
.stat.t-violet{--t:#7a5af0}
/* Sur le fond nuit de Night Owl, ces mêmes tons s'éteindraient. On reprend
   les couleurs claires de sa propre palette. */
:root[data-theme="dark"] .stat.t-blue{--t:#82aaff}
:root[data-theme="dark"] .stat.t-green{--t:#addb67}
:root[data-theme="dark"] .stat.t-violet{--t:#c792ea}

/* ── Onglets ──────────────────────────────────────────────────────────────
   La gouttière portait un fond trop proche de celui de la page : elle
   était invisible, et l'onglet inactif — sans bordure ni fond propre —
   flottait dans le vide. Un administrateur n'avait pas vu « Devis », faute de
   quoi que ce soit qui le désigne comme cliquable.

   Le contraste se joue en trois temps : la gouttière se détache de la page,
   la carte active se détache de la gouttière, et l'inactif réagit au survol. */
.tabs{
  display:inline-flex;background:var(--raise);border:1px solid var(--line);
  border-radius:12px;padding:4px;gap:3px;margin-bottom:16px;
}
.tab{
  border:none;background:none;cursor:pointer;font:inherit;
  padding:8px 16px;border-radius:9px;font-size:13px;font-weight:600;color:var(--muted);
  display:inline-flex;align-items:center;gap:8px;transition:.15s;
}
/* L'inactif prend un fond au survol : il se révèle comme bouton avant même
   le clic. Le simple changement de couleur du texte ne suffisait pas. */
.tab:hover:not(.active){background:var(--surface);color:var(--ink)}
.tab.active{
  background:var(--surface);color:var(--ink);
  box-shadow:0 1px 2px rgba(0,0,0,.05),0 2px 6px rgba(0,0,0,.06);
}
/* Icône de l'onglet. Le gap de .tab (8px) sépare bien le compteur du texte,
   mais détacherait trop l'icône de son libellé : elle reprend la main avec
   une marge propre. Elle s'efface légèrement sur l'onglet inactif, et prend
   la couleur d'accent sur l'actif — un repère de plus. */
.tab-ico{width:15px;height:15px;flex:none;margin-right:-2px;opacity:.65;transition:.15s}
.tab:hover .tab-ico{opacity:1}
.tab.active .tab-ico{opacity:1;color:var(--accent)}
.tab .count{font-size:11px;font-weight:700;color:var(--muted)}
.tab.active .count{color:var(--accent)}
/* Compteur non nul : pastille pleine, pour attirer l'oeil là où il y a du
   travail en attente. À zéro, il reste un simple chiffre discret. */
.tab .count.has-items{
  background:var(--accent);color:#fff;
  min-width:17px;height:17px;padding:0 5px;border-radius:9px;
  display:inline-flex;align-items:center;justify-content:center;
  font-size:10.5px;line-height:1;
}
.tab.active .count.has-items{color:#fff}
/* Sur le fond nuit, une ombre noire ne détache rien : la carte active se
   distingue par un contour clair, et la gouttière s'assombrit sous elle.

   La bordure est posée sur TOUS les onglets, transparente par défaut : la
   donner au seul actif décalerait le texte d'un pixel à chaque changement
   d'onglet. */
:root[data-theme="dark"] .tabs{background:var(--paper)}
:root[data-theme="dark"] .tab{border:1px solid transparent}
:root[data-theme="dark"] .tab.active{box-shadow:none;border-color:var(--line)}

/* Toolbar */
.toolbar{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
/* C'est un <form> (il isole le champ de l'autocomplétion d'identifiants) :
   margin:0 neutralise la marge que certains navigateurs lui donnent. */
.search{position:relative;flex:1;min-width:220px;margin:0}
.search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--faint)}
.search input{
  width:100%;padding:11px 14px 11px 38px;border:1px solid var(--line);border-radius:10px;
  background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;outline:none;transition:.15s;
}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.search input::placeholder{color:var(--faint)}
/* type="search" ajoute une croix et une apparence natives : on les neutralise
   pour garder le style du dashboard. */
.search input{-webkit-appearance:none;appearance:none}
.search input::-webkit-search-cancel-button,
.search input::-webkit-search-decoration{-webkit-appearance:none;appearance:none;display:none}
.btn{
  padding:11px 15px;border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:10px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;
  text-decoration:none;display:inline-flex;align-items:center;gap:7px;transition:.15s;
}
.btn:hover{border-color:var(--accent);color:var(--accent)}

/* Panels */
.panel{display:none}
.panel.active{display:flex;flex-direction:column;gap:12px}

/* Row card */
.card{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  box-shadow:var(--shadow);overflow:hidden;
  /* Survol fluide : soulèvement + ombre + bordure teintée. */
  transition:border-color .2s ease, box-shadow .25s ease, transform .2s ease;
  will-change:transform;
}
.card:hover{
  border-color:var(--accent);
  transform:translateY(-2px);
  box-shadow:var(--shadow-hover);
}
/* La carte dépliée ne « saute » pas au survol : elle reste posée. */
.card.open{border-color:var(--accent);transform:none}
.card.open:hover{transform:none}
.head{
  display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;
  padding:15px 18px;cursor:pointer;user-select:none;
}
/* La flèche pivote doucement à l'ouverture. */
.caret{transition:transform .2s ease}
.card.open .head .caret{transform:rotate(90deg)}

/* Pagination */
.pager{
  display:flex;align-items:center;justify-content:center;gap:14px;
  margin:18px 0 6px;
}
.pg-btn{
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:9px;padding:8px 14px;font:inherit;font-size:13px;font-weight:600;
  cursor:pointer;transition:border-color .15s, color .15s, background .15s;
}
.pg-btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}
.pg-btn:disabled{opacity:.4;cursor:default}
.pg-info{font-size:12.5px;color:var(--muted);font-variant-numeric:tabular-nums}
/* Numéros de page cliquables (pagination standard). */
.pg-nums{display:flex;align-items:center;gap:6px}
.pg-num{
  min-width:34px;border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:8px;padding:7px 9px;font:inherit;font-size:13px;font-weight:600;
  cursor:pointer;text-align:center;font-variant-numeric:tabular-nums;
  transition:border-color .15s, color .15s, background .15s;
}
.pg-num:hover:not(.active){border-color:var(--accent);color:var(--accent)}
.pg-num.active{background:var(--accent);border-color:var(--accent);color:#fff;cursor:default}
.pg-ellipsis{color:var(--muted);padding:0 2px;font-size:13px;user-select:none}
/* Loader de pagination : voile léger + spinner, sur la zone des cartes. */
.panel{position:relative}
.pg-loader{
  position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb, var(--bg) 62%, transparent);
  backdrop-filter:blur(1.5px);opacity:0;pointer-events:none;
  transition:opacity .18s ease;
}
.pg-loader.on{opacity:1;pointer-events:auto}
.pg-spinner{
  width:34px;height:34px;border-radius:50%;
  border:3px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-top-color:var(--accent);
  animation:pgspin .7s linear infinite;
}
@keyframes pgspin{to{transform:rotate(360deg)}}
.avatar{
  width:38px;height:38px;border-radius:10px;flex-shrink:0;
  background:var(--accent-soft);color:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;
}
.head .id{font-size:15px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:7px}
.head .sub{color:var(--muted);font-size:12.5px;margin-top:2px}
/* Colonne droite : montant, statuts, date — dans cet ordre de lecture.
   Largeur bornée pour que les trois pastilles ne repoussent pas le titre
   de la commande, et que la date ne vienne pas chevaucher le montant. */
.head .right{
  text-align:right;display:flex;flex-direction:column;align-items:flex-end;
  gap:7px;max-width:340px;flex:none;
}
.amount{font-size:16px;font-weight:800;letter-spacing:-.015em;line-height:1.1}
.when{color:var(--faint);font-size:11px;white-space:nowrap}
.caret{color:var(--faint);transition:transform .2s;flex-shrink:0;margin-left:2px}
.card.open .caret{transform:rotate(90deg);color:var(--accent)}

/* Status pill.
   Une bordure de la même teinte que le texte (transparence) remplace
   l'aplat seul : les trois pastilles côte à côte se distinguent mieux,
   y compris la neutre qui se confondait avec le fond de la carte. */
.pill{
  display:inline-flex;align-items:center;gap:5px;
  font-size:10.5px;font-weight:700;padding:3.5px 9px;
  border-radius:20px;letter-spacing:.01em;line-height:1.35;
  white-space:nowrap;border:1px solid transparent;
}
.pill::before{content:'';width:5.5px;height:5.5px;border-radius:50%;background:currentColor;flex:none}
.pill.ok{background:var(--ok-soft);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 22%,transparent)}
.pill.warn{background:var(--warn-soft);color:var(--warn);border-color:color-mix(in srgb,var(--warn) 22%,transparent)}
.pill.neutral{background:var(--raise);color:var(--muted);border-color:var(--line)}
.pill.danger{background:var(--danger-soft);color:var(--danger);border-color:color-mix(in srgb,var(--danger) 22%,transparent)}

/* Detail body */
.body{display:none;padding:0 18px 18px;border-top:1px solid var(--line-soft)}
.card.open .body{display:block}
.section-lbl{margin:16px 0 10px}
.client{
  background:var(--raise);border-radius:11px;padding:14px 16px;
  display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 22px;
}
.kv{font-size:13px}
.kv .k{display:block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);margin-bottom:1px}
.kv a{color:var(--accent);text-decoration:none}
.kv a:hover{text-decoration:underline}
.kv .empty{color:var(--faint)}

.item{display:grid;grid-template-columns:auto 1fr;gap:16px;padding:14px 0;border-top:1px solid var(--line-soft)}
.item:first-of-type{border-top:none}
.thumbs{display:flex;gap:8px;flex-wrap:wrap}
.thumb{
  width:72px;height:72px;border-radius:10px;border:1px solid var(--line);object-fit:contain;
  /* Damier gris clair : un asset transparent (ex. texte blanc) reste visible,
     alors qu'un fond blanc uni le rendrait invisible. */
  background-color:#d4d4d8;
  background-image:
    linear-gradient(45deg,#bcbcc2 25%,transparent 25%,transparent 75%,#bcbcc2 75%),
    linear-gradient(45deg,#bcbcc2 25%,transparent 25%,transparent 75%,#bcbcc2 75%);
  background-size:14px 14px;
  background-position:0 0,7px 7px;
  cursor:zoom-in;transition:.15s;
}
.thumb:hover{border-color:var(--accent);transform:scale(1.03)}
.no-thumb{
  width:72px;height:72px;border-radius:10px;border:1px dashed var(--line);
  display:flex;align-items:center;justify-content:center;color:var(--faint);font-size:10px;text-align:center;padding:6px;
}
.item-body .title{font-size:14px;font-weight:700}
.item-body .title .qty{color:var(--muted);font-weight:600}
.specs{margin-top:6px;display:flex;flex-wrap:wrap;gap:5px 6px}
.spec{
  font-size:11.5px;background:var(--raise);border-radius:6px;padding:3px 8px;color:var(--ink);
}
.spec b{color:var(--muted);font-weight:600}
.dl{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:var(--accent);text-decoration:none;
  border:1px solid var(--line);border-radius:6px;padding:3px 8px;margin:4px 4px 0 0}
.dl:hover{background:var(--accent-soft)}

/* Empty */
.empty-state{text-align:center;padding:70px 24px;color:var(--muted)}
.empty-state .ico{font-size:34px;margin-bottom:12px;opacity:.5}
.empty-state p{font-size:14px}
.empty-state small{display:block;margin-top:6px;color:var(--faint);font-size:12px}

/* Suivi de production.
   Les pastilles restent sur UNE ligne et ne se replient jamais : trois
   éléments qui passent à la ligne déséquilibraient la hauteur des cartes
   d'une commande à l'autre. Elles défilent plutôt que de déborder. */
.pills{
  display:flex;gap:5px;justify-content:flex-end;align-items:center;
  flex-wrap:nowrap;max-width:100%;
}
.pill.prod::before{width:5.5px;height:5.5px}
.pill.prod.todo{background:var(--raise);color:var(--muted);border-color:var(--line)}
.pill.prod.doing{background:var(--warn-soft);color:var(--warn);border-color:color-mix(in srgb,var(--warn) 22%,transparent)}
.pill.prod.ready{background:#e6eefc;color:#2b57c4;border-color:rgba(43,87,196,.22)}
.pill.prod.done{background:var(--ok-soft);color:var(--ok);border-color:color-mix(in srgb,var(--ok) 22%,transparent)}
:root[data-theme="dark"] .pill.prod.ready{background:#12314f;color:#82aaff;border-color:rgba(130,170,255,.28)}

.steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.step{
  border:1px solid var(--line);background:var(--surface);color:var(--muted);
  border-radius:9px;padding:8px 14px;font:inherit;font-size:12.5px;font-weight:600;
  cursor:pointer;transition:.15s;display:inline-flex;align-items:center;gap:6px;
}
.step::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--line);transition:.15s}
.step:hover{border-color:var(--accent);color:var(--ink)}
.step.active{border-color:currentColor;font-weight:700}
.step.active.todo{color:var(--muted)}
.step.active.doing{color:var(--warn);background:var(--warn-soft)}
.step.active.ready{color:#2b57c4;background:#e6eefc}
.step.active.done{color:var(--ok);background:var(--ok-soft)}
.step.active::before{background:currentColor}
.step:disabled{opacity:.6;cursor:wait}

/* Note interne */
.note-input{
  width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:9px;
  background:var(--paper);color:var(--ink);font:inherit;font-size:13px;
  outline:none;resize:vertical;line-height:1.5;
}
.note-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}

/* Actions d'une commande */
.order-actions{display:flex;gap:10px;flex-wrap:wrap;
  margin-top:16px;padding-top:14px;border-top:1px solid var(--line-soft)}

/* Sous-filtres (onglet Devis) */
/* Ligne de filtres de la liste : statut + période, alignés côte à côte. */
.subfilters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.chip-filter{
  border:1px solid var(--line);background:var(--surface);color:var(--muted);
  border-radius:20px;padding:6px 14px;font:inherit;font-size:12.5px;font-weight:600;
  cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:.15s;
}
.chip-filter:hover{border-color:var(--accent);color:var(--ink)}
.chip-filter.active{background:var(--accent);border-color:var(--accent);color:#fff}
.chip-filter .count{font-size:11px;font-weight:700;opacity:.75}
.chip-filter.active .count{opacity:.9}

/* Filtres serveur (période, paiement, tri) */
.filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
/* ── Menu déroulant personnalisé (remplace <select>) ──
   Le menu natif est dessiné par l'OS par-dessus la page : impossible de
   contrôler sa largeur, il débordait de l'écran sur mobile. Ici, tout est
   rendu DANS la page, donc entièrement maîtrisé. */
.dd{position:relative;display:inline-block;min-width:0}
.dd-btn{
  display:flex;align-items:center;justify-content:space-between;gap:8px;
  width:100%;max-width:100%;
  border:1px solid var(--line);background:var(--surface);color:var(--ink);
  border-radius:10px;padding:10px 12px;font:inherit;font-size:13px;font-weight:600;
  cursor:pointer;outline:none;transition:border-color .15s;
}
.dd-btn:hover{border-color:var(--accent)}
.dd.open .dd-btn{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
/* Le libellé se tronque proprement plutôt que d'élargir le bouton. */
.dd-txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.dd-caret{flex:none;color:var(--muted);transition:transform .18s}
.dd.open .dd-caret{transform:rotate(180deg)}

.dd-menu{
  position:absolute;z-index:60;top:calc(100% + 6px);left:0;
  /* Jamais plus large que le déclencheur : le menu ne peut pas déborder. */
  min-width:100%;max-width:100%;
  background:var(--surface);border:1px solid var(--line);border-radius:12px;
  box-shadow:0 16px 40px rgba(0,0,0,.18);
  padding:5px;display:none;
  max-height:min(300px,60vh);overflow-y:auto;overscroll-behavior:contain;
}
.dd.open .dd-menu{display:block}
/* Près du bord droit : on aligne le menu à droite (posé en JS). */
.dd.to-left .dd-menu{left:auto;right:0}

.dd-item{
  display:block;width:100%;text-align:left;
  border:none;background:none;color:var(--ink);
  font:inherit;font-size:13px;font-weight:500;
  padding:9px 10px;border-radius:8px;cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.dd-item:hover{background:var(--raise)}
.dd-item.on{background:var(--accent-soft);color:var(--accent);font-weight:700}
.chip-clear{
  color:var(--muted);font-size:12.5px;font-weight:600;text-decoration:none;
  padding:8px 10px;border-radius:8px;
}
.chip-clear:hover{color:var(--accent);background:var(--surface)}
.filter-note{
  background:var(--surface);border:1px solid var(--line);border-left:3px solid var(--accent);
  border-radius:8px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:var(--muted);
}

/* Menu d'export */
.export-wrap{position:relative}
.export-menu{
  display:none;position:absolute;right:0;top:calc(100% + 6px);z-index:40;min-width:230px;
  background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px;
  box-shadow:0 12px 32px rgba(0,0,0,.14);
}
.export-menu.open{display:block}
.export-menu a{
  display:block;padding:10px 12px;border-radius:8px;color:var(--ink);
  text-decoration:none;font-size:13.5px;font-weight:600;
}
.export-menu a:hover{background:var(--paper);color:var(--accent)}
.export-menu small{display:block;padding:6px 12px 4px;color:var(--faint);font-size:11.5px}

/* Notifications */
.bell-wrap{position:relative}
#bell-btn{position:relative}
/* Pastille de comptage. Elle chevauche la cloche : un liseré de la couleur de
   la barre la détache du tracé, sans quoi les deux se confondent. */
.bell-dot{
  position:absolute;top:-3px;right:-3px;
  min-width:15px;height:15px;padding:0 3px;
  background:var(--accent);color:#fff;border-radius:8px;
  border:2px solid var(--surface);
  font-size:9.5px;font-weight:800;line-height:15px;text-align:center;
  font-variant-numeric:tabular-nums;
}
/* Sans contenu, min-width laissait un disque nu de la taille du badge —
   visible alors qu'il n'y a rien à signaler. */
.bell-dot:empty{display:none}
/* Rappel visuel quand une nouvelle commande arrive (badge live). */
@keyframes bellRing{
  0%,100%{transform:rotate(0)}
  20%{transform:rotate(-13deg)}40%{transform:rotate(11deg)}
  60%{transform:rotate(-7deg)}80%{transform:rotate(4deg)}
}

/* Panneau déroulant, ancré sous la cloche */
.notif-pop{
  display:none;position:absolute;right:0;top:calc(100% + 10px);z-index:60;
  width:360px;max-width:calc(100vw - 32px);
  background:var(--surface);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 18px 44px rgba(0,0,0,.18);overflow:hidden;
}
.notif-pop.open{display:block;animation:notifIn .16s ease-out}
@keyframes notifIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
/* Petite flèche vers la cloche */
.notif-pop::before{
  content:'';position:absolute;top:-6px;right:16px;width:11px;height:11px;
  background:var(--surface);border-left:1px solid var(--line);border-top:1px solid var(--line);
  transform:rotate(45deg);
}
.notif-head{
  display:flex;align-items:center;justify-content:space-between;gap:10px;
  padding:13px 15px;border-bottom:1px solid var(--line-soft);
}
.notif-head b{font-size:13.5px}
.notif-clear{
  border:none;background:none;cursor:pointer;font:inherit;
  color:var(--accent);font-size:12px;font-weight:600;padding:2px 4px;border-radius:6px;
}
.notif-clear:hover{text-decoration:underline}
.notif-list{max-height:340px;overflow-y:auto}
.notif{
  display:flex;align-items:center;gap:11px;padding:11px 15px;cursor:pointer;
  border-bottom:1px solid var(--line-soft);text-decoration:none;color:var(--ink);
}
.notif:last-child{border-bottom:none}
.notif:hover{background:var(--paper)}
.notif-ico{
  flex:none;width:32px;height:32px;border-radius:9px;
  display:grid;place-items:center;font-size:14px;background:var(--raise);
}
.notif-txt{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.notif-txt b{font-size:13px;font-weight:700}
.notif-txt small{color:var(--muted);font-size:11.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notif-when{flex:none;color:var(--faint);font-size:11px}
.notif-empty{padding:30px 18px;text-align:center;color:var(--muted)}
.notif-empty .ico{font-size:26px;margin-bottom:8px;color:var(--accent)}
.notif-empty p{font-size:13.5px;font-weight:600;margin-bottom:4px}
.notif-empty small{font-size:11.5px;color:var(--faint)}
/* Carte mise en avant quand on arrive depuis une notification */
.card.flash{animation:flash 1.6s ease-out}
@keyframes flash{
  0%,100%{box-shadow:var(--shadow)}
  15%,60%{box-shadow:0 0 0 3px rgba(194,65,12,.35)}
}
.badge-new{
  display:inline-block;vertical-align:middle;margin-left:7px;
  background:var(--accent);color:#fff;border-radius:20px;padding:2px 8px;
  font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
}
/* Badge « Groupe » sur une carte devis de commande groupée. */
.badge-group{
  display:inline-block;vertical-align:middle;margin-left:7px;
  background:var(--ok-soft);color:var(--ok);border-radius:20px;padding:2px 8px;
  font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;
}
/* Tableau de la liste des personnes (commande de groupe). */
.grp-list-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-top:6px}
.grp-list{width:100%;border-collapse:collapse;font-size:12.5px;min-width:420px}
.grp-list th{
  text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
  color:var(--muted);padding:8px 10px;background:var(--raise);border-bottom:1px solid var(--line);
}
.grp-list td{padding:7px 10px;border-bottom:1px solid var(--line-soft)}
.grp-list tr:last-child td{border-bottom:none}
.grp-list .num{text-align:right;font-variant-numeric:tabular-nums}
/* Colonne typographie : police et corps du texte floqué, avec sa couleur. */
.typo-cell{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.typo-dot{
  width:11px;height:11px;border-radius:50%;flex:none;
  border:1px solid rgba(0,0,0,.18);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35);
}

/* Upload de fichiers dans le modal de devis/facturation */
.attach-section{margin-top:16px}
.drop-zone{
  border:2px dashed var(--line);border-radius:12px;padding:32px 20px;
  background:var(--paper);cursor:pointer;transition:all .2s ease;
  text-align:center;margin-top:8px;
}
.drop-zone:hover{border-color:var(--accent);background:var(--accent-soft)}
.drop-zone.drag-over{border-color:var(--accent);background:var(--accent-soft);transform:scale(1.02)}
.drop-content{pointer-events:none}
.files-list{margin-top:12px;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.file-item{
  display:flex;align-items:center;gap:12px;padding:12px 14px;
  border-bottom:1px solid var(--line-soft);background:var(--surface);
}
.file-item:last-child{border-bottom:none}
.file-item.uploading{background:var(--warn-soft)}
.file-item.uploaded{background:var(--ok-soft)}
.file-item.error{background:var(--danger-soft)}
.file-icon{
  flex:none;width:24px;height:24px;display:grid;place-items:center;
  background:var(--line);border-radius:6px;font-size:12px;color:var(--surface);
}
.file-icon.pdf{background:#e53e3e;color:#fff}
.file-icon.doc{background:#2b6cb0;color:#fff}
.file-icon.xls{background:#38a169;color:#fff}
.file-icon.img{background:#805ad5;color:#fff}
.file-info{flex:1;min-width:0}
.file-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.file-size{font-size:11px;color:var(--muted);margin-top:2px}
.file-actions{flex:none;display:flex;gap:8px}
.file-remove{
  width:28px;height:28px;border:none;background:var(--danger);color:#fff;
  border-radius:6px;cursor:pointer;display:grid;place-items:center;
  font-size:16px;line-height:1;transition:.2s;
}
.file-remove:hover{background:#c53030}
.upload-progress{
  width:100%;height:3px;background:var(--line-soft);border-radius:2px;
  margin-top:6px;overflow:hidden;
}
.upload-bar{
  height:100%;background:var(--accent);border-radius:2px;
  transition:width .3s ease;transform-origin:left;
}
.grp-list tfoot td{font-weight:800;background:var(--raise)}
.grp-list .empty{color:var(--faint)}
/* 🆕 Récap commande groupée par tailles (modal quantités) */
.size-group-recap{background:var(--accent-soft);border:1px solid var(--accent);border-radius:12px;padding:16px;margin:16px 0}
.size-group-recap .lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--accent);margin-bottom:10px}
/* Pastille de couleur devant le nom de la teinte.
   Bordure semi-opaque : sans elle, White et Ash disparaissent sur fond clair. */
.color-cell{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
.color-dot{
  width:13px;height:13px;border-radius:50%;flex:0 0 13px;
  border:1px solid rgba(0,0,0,.22);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.12);
  -webkit-print-color-adjust:exact;print-color-adjust:exact
}

/* Récap agrégé couleur × taille (production). */
.grp-agg-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px;margin-top:6px}
.grp-agg{width:100%;border-collapse:collapse;font-size:12.5px;min-width:360px}
.grp-agg th{
  font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
  color:var(--muted);padding:8px 10px;background:var(--raise);border-bottom:1px solid var(--line);
  text-align:left;
}
.grp-agg th.num, .grp-agg td.num{text-align:center;font-variant-numeric:tabular-nums;min-width:38px}
.grp-agg td{padding:7px 10px;border-bottom:1px solid var(--line-soft)}
.grp-agg td:first-child{font-weight:600}
.grp-agg td.zero{color:var(--faint)}
.grp-agg td.tot{font-weight:800}
.grp-agg tfoot td{background:var(--raise);font-weight:800;border-bottom:none}

/* Liste des flocages. */
.grp-flocks{margin-top:10px}
.grp-flocks-lbl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--muted);margin-bottom:6px}
.grp-flock-list{display:flex;flex-wrap:wrap;gap:6px}
.grp-flock{
  font-size:12px;background:var(--raise);border:1px solid var(--line);border-radius:7px;
  padding:5px 9px;display:inline-flex;align-items:center;gap:5px;
}
.grp-flock em{color:var(--faint);font-style:normal;font-size:11px}

/* Modale de réglages */
.set-block{
  border:1px solid var(--line);border-radius:12px;padding:16px;margin-top:16px;
  background:var(--paper);
}
.switch{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:14px;font-weight:600}
.switch input{width:17px;height:17px;accent-color:var(--accent);cursor:pointer}
.mail-row{display:flex;gap:8px;align-items:stretch}
.mail-row .price-input{flex:1;min-width:0}
.mail-row .btn{flex:none;white-space:nowrap}

/* ── Modale Messages ──────────────────────────────────────────────────────
   Un seul écran : le texte s'édite sur place, l'aperçu vit dessous. Remplace
   les cartes de modèles, leurs badges et leurs boutons d'action — la gestion
   multi-modèles a disparu, un seul texte par type étant jamais envoyé. */
.msg-editor{
  /* Le reste est hérité de la règle .modal-box textarea : bordure, fond,
     focus. L'ancien champ redéclarait tout en style inline, à l'identique. */
  min-height:190px;
}
/* Jetons cliquables : un clic insère la variable au curseur. */
.msg-vars{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.msg-var{
  border:1px solid var(--line);background:var(--surface);color:var(--muted);
  border-radius:6px;padding:3px 8px;cursor:pointer;transition:.15s;
  font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:11.5px;
}
.msg-var:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
.msg-preview-lbl{margin-top:16px;margin-bottom:6px;display:block}
/* Aperçu : le texte tel que le client le lira, variables remplacées. */
.msg-preview{
  background:var(--surface);border:1px solid var(--line-soft);border-radius:10px;
  padding:13px 15px;font-size:13px;line-height:1.55;color:var(--ink);
  white-space:pre-line;max-height:170px;overflow-y:auto;
}
.msg-preview.is-empty{color:var(--faint);font-style:italic}

/* ── Modale Prix ── */
.price-line{
  display:flex;align-items:center;justify-content:space-between;gap:14px;
  padding:10px 0;border-bottom:1px solid var(--line-soft);
}
.price-line:last-child{border-bottom:none}
.price-line label{font-size:13.5px;font-weight:600;margin:0}
.price-lbl{display:flex;flex-direction:column;gap:2px;min-width:0}
/* Précision sous le nom du produit (ex. « toutes couleurs et tailles »). */
.price-note{font-size:11px;color:var(--faint);font-weight:500}
/* Avertissement de troncature : discret, mais au-dessus des onglets — c'est là
   que l'opérateur lit les compteurs qu'il croirait sinon exhaustifs. */
.trunc-note{margin:0 0 12px;padding:8px 12px;border-left:3px solid var(--accent);
  border-top:1px solid var(--line);border-right:1px solid var(--line);
  border-bottom:1px solid var(--line);font-size:12.5px;color:var(--muted);
  border-radius:0 4px 4px 0}
.price-field{display:flex;align-items:center;gap:8px;flex:none}
.price-field .price-input{width:110px;text-align:right;font-size:14px}
.price-cur{font-size:11.5px;color:var(--faint);font-weight:700;min-width:34px}

/* ── Tarifs dégressifs ────────────────────────────────────────────
   Bloc repliable sous chaque produit. La ligne de prix perd sa bordure
   quand un bloc la suit : c'est le bloc qui ferme le groupe. */
.price-line:has(+ .tier-block){border-bottom:none;padding-bottom:4px}
.tier-block{
  padding:0 0 12px;margin-bottom:2px;
  border-bottom:1px solid var(--line-soft);
}
.tier-sum{
  display:flex;align-items:center;gap:7px;
  list-style:none;cursor:pointer;user-select:none;
  font-size:11.5px;font-weight:700;color:var(--muted);
  padding:5px 0;
}
.tier-sum::-webkit-details-marker{display:none}
.tier-sum:hover{color:var(--ink)}
.tier-caret{width:12px;height:12px;flex:none;transition:transform .18s}
.tier-block[open] .tier-caret{transform:rotate(90deg);color:var(--accent)}
/* Compteur : pousse à droite, sert de résumé quand le bloc est replié. */
.tier-count{
  margin-left:auto;font-weight:600;font-size:11px;color:var(--faint);
  background:var(--raise);border-radius:20px;padding:2px 9px;
}

.tier-rows{display:flex;flex-direction:column;gap:6px;margin:8px 0 4px}
.tier-row{
  display:flex;align-items:center;gap:7px;
  background:var(--raise);border-radius:9px;padding:6px 8px;
}
.tier-from,.tier-unit,.tier-cur{font-size:11px;color:var(--faint);font-weight:600;flex:none}
.tier-row input{
  border:1px solid var(--line);border-radius:7px;
  background:var(--surface);color:var(--ink);
  font:inherit;font-size:12.5px;padding:5px 8px;text-align:right;outline:none;
  transition:border-color .15s,box-shadow .15s;
}
.tier-row input:focus{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent-soft)}
.tier-min{width:62px}
.tier-price{width:76px}
/* Le prix est poussé à droite : les colonnes s'alignent d'un palier à l'autre. */
.tier-price{margin-left:auto}
.tier-del{
  width:24px;height:24px;flex:none;display:grid;place-items:center;
  border:none;border-radius:6px;background:none;color:var(--faint);
  cursor:pointer;transition:color .15s,background .15s;
}
.tier-del:hover{color:var(--danger);background:var(--danger-soft)}
.tier-del svg{width:13px;height:13px}

.tier-add{
  border:1px dashed var(--line);border-radius:8px;background:none;
  color:var(--muted);font:inherit;font-size:11.5px;font-weight:700;
  padding:6px 11px;cursor:pointer;transition:all .15s;
}
.tier-add:hover{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}

/* Écrans étroits : le palier passe sur deux lignes plutôt que de comprimer
   les champs au point de les rendre illisibles. */
@media (max-width:520px){
  .tier-row{flex-wrap:wrap}
  .tier-price{margin-left:0}
}

/* ── Modale Administrateurs ── */
.adm-row{
  display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);
  border-radius:12px;background:var(--surface);margin-bottom:8px;
}
.adm-row.is-blocked{opacity:.62}
.adm-av{
  width:36px;height:36px;flex:none;border-radius:50%;display:flex;align-items:center;
  justify-content:center;background:var(--accent-soft);color:var(--accent);
  font-size:12px;font-weight:800;letter-spacing:.02em;
}
.adm-main{flex:1;min-width:0}
.adm-mail{
  font-weight:700;font-size:13.5px;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis;display:flex;align-items:center;gap:6px;
}
.adm-you{
  font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;
  background:var(--raise);color:var(--muted);padding:2px 6px;border-radius:5px;
}
.adm-meta{
  font-size:11.5px;color:var(--faint);margin-top:3px;display:flex;
  align-items:center;gap:8px;flex-wrap:wrap;
}
.adm-shop{
  font-weight:700;color:var(--ok,#16a34a);
}
.adm-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:none}
.adm-acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.btn.adm-mini{padding:5px 9px;font-size:11.5px;border-radius:8px}

/* Bloc identifiants générés */
.adm-cred-box{
  margin-top:12px;background:var(--raise);border:1px solid var(--line);
  border-radius:12px;padding:14px;
}
.adm-cred-line{
  display:flex;gap:8px;font-size:12.5px;padding:5px 0;align-items:baseline;
}
.adm-cred-line span{color:var(--faint);flex:none;min-width:86px}
.adm-cred-line b{word-break:break-all;user-select:all}

@media (max-width:560px){
  .adm-row{flex-wrap:wrap}
  .adm-side{width:100%;align-items:flex-start;flex-direction:row;justify-content:space-between}
}
.opt{font-weight:500;color:var(--faint);text-transform:none;letter-spacing:0}

/* Message éphémère (confirmation d'expédition) */
.toast{
  position:fixed;left:50%;bottom:28px;transform:translate(-50%,20px);z-index:90;
  background:var(--ink);color:var(--paper);border-radius:10px;
  padding:12px 20px;font-size:13.5px;font-weight:600;max-width:90vw;
  box-shadow:0 12px 30px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transition:opacity .2s, transform .2s;
}
.toast.show{opacity:1;transform:translate(-50%,0)}

/* ── Modale de confirmation (style « SweetAlert ») ──
   Affichée au-dessus des autres modales (z-index > .modal). */
.alert-modal{
  position:fixed;inset:0;background:rgba(10,10,12,.55);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;z-index:200;padding:24px;
}
.alert-modal.open{display:flex}
.alert-box{
  background:var(--surface);border:1px solid var(--line);border-radius:18px;
  width:min(92vw,380px);padding:30px 26px 22px;text-align:center;
  box-shadow:0 30px 70px rgba(0,0,0,.32);
  animation:alertPop .22s cubic-bezier(.2,1.3,.5,1);
}
@keyframes alertPop{from{opacity:0;transform:scale(.88)}to{opacity:1;transform:scale(1)}}
/* Pastille de l'icône : verte (succès) ou rouge (erreur). */
.alert-ico{
  width:66px;height:66px;margin:0 auto 16px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;
  background:var(--ok-soft);color:var(--ok);
}
.alert-modal.is-error .alert-ico{background:var(--danger-soft);color:var(--danger)}
/* Le trait de la coche se dessine à l'ouverture. */
.alert-ico svg{stroke-dasharray:32;stroke-dashoffset:32;animation:alertDraw .4s .12s ease forwards}
@keyframes alertDraw{to{stroke-dashoffset:0}}
.alert-box h4{font-size:17px;font-weight:800;letter-spacing:-.01em;margin-bottom:6px}
.alert-box p{font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:20px}
.alert-box .btn{width:100%;justify-content:center}
@media (prefers-reduced-motion:reduce){
  .alert-box,.alert-ico svg{animation:none}
  .alert-ico svg{stroke-dashoffset:0}
}
.set-block code{
  background:var(--surface);border:1px solid var(--line);border-radius:5px;
  padding:1px 5px;font-size:12px;
}

/* Actions sur un devis */
.quote-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  margin-top:14px;padding-top:14px;border-top:1px solid var(--line-soft)}
.btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}
.btn.primary:hover{background:#a83809;border-color:#a83809;color:#fff}
.btn:disabled{opacity:.55;cursor:not-allowed}
.hint{font-size:12px;color:var(--muted)}
.hint.ok{color:var(--ok);font-weight:600}
.hint.err{color:var(--accent);font-weight:600}

/* Lightbox */
.lightbox{position:fixed;inset:0;background:rgba(10,10,12,.86);display:none;align-items:center;justify-content:center;z-index:100;padding:30px;cursor:zoom-out}
.lightbox.open{display:flex}
.lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;box-shadow:0 30px 80px rgba(0,0,0,.5);
  /* Damier : un aperçu transparent (texte blanc) reste lisible en grand. */
  background-color:#d4d4d8;
  background-image:
    linear-gradient(45deg,#bcbcc2 25%,transparent 25%,transparent 75%,#bcbcc2 75%),
    linear-gradient(45deg,#bcbcc2 25%,transparent 25%,transparent 75%,#bcbcc2 75%);
  background-size:22px 22px;background-position:0 0,11px 11px}

/* Modale : envoi de facture */
.modal{position:fixed;inset:0;background:rgba(10,10,12,.6);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;z-index:110;padding:24px;
  overflow-y:auto}
.modal.open{display:flex}
/* Une modale longue ne doit jamais dépasser l'écran : on borne sa hauteur et on
   fait défiler son contenu à l'intérieur. */
.modal-box{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  width:min(94vw,480px);padding:24px;box-shadow:0 30px 70px rgba(0,0,0,.3);
  max-height:calc(100vh - 48px);overflow-y:auto;overscroll-behavior:contain}
.modal-box::-webkit-scrollbar{width:8px}
.modal-box::-webkit-scrollbar-thumb{background:var(--line);border-radius:8px}
.modal-box h3{font-size:17px;font-weight:800;letter-spacing:-.01em;margin-bottom:4px}
.modal-box p.sub{font-size:13px;color:var(--muted);margin-bottom:16px}
.modal-box label{display:block;margin-bottom:6px}
.modal-box textarea{width:100%;min-height:120px;padding:11px 13px;border:1px solid var(--line);
  border-radius:10px;background:var(--paper);color:var(--ink);font:inherit;font-size:13.5px;
  outline:none;resize:vertical;line-height:1.5}
.modal-box textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.modal-actions{display:flex;gap:10px;margin-top:18px}
.modal-actions .btn{flex:1;justify-content:center}
/* Ligne prix unitaire + total */
.price-row{display:flex;gap:14px;align-items:flex-end}
.price-row>div:first-child{flex:1}
.price-input{width:100%;padding:11px 13px;border:1px solid var(--line);border-radius:10px;
  background:var(--paper);color:var(--ink);font:inherit;font-size:16px;font-weight:700;outline:none}
.price-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.price-total{background:var(--raise);border-radius:10px;padding:9px 14px;text-align:right;min-width:150px}
.price-total strong{display:block;font-size:19px;font-weight:800;letter-spacing:-.02em;margin-top:2px}

@media (max-width:640px){
  /* Carte commande / devis : le bloc de droite passe sous le titre.
     Grille 2 lignes : les pastilles occupent la 1re (sinon « Shopify : Non
     traitée » se comprimait sur 3 lignes), prix et date se partagent la 2e. */
  .head{grid-template-columns:auto 1fr;gap:12px}
  /* Flex + wrap plutôt qu'une grille : les cartes COMMANDE ont un conteneur
     .pills, les cartes DEVIS une pastille directe. Le flex gère les deux. */
  .head .right{
    grid-column:1/-1;width:100%;max-width:none;text-align:left;
    flex-direction:row;flex-wrap:wrap;align-items:center;
    justify-content:flex-start;gap:8px;
  }
  /* Les pastilles prennent toute la ligne, puis s'enroulent entre elles. */
  .head .right .pills{
    flex:1 0 100%;
    display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-start;
  }
  /* Chaque pastille garde sa largeur naturelle, sur une seule ligne de texte
     (« Shopify : Non traitée » se comprimait sur 3 lignes). */
  .head .right .pill{flex:none;white-space:nowrap}
  /* Devis : la pastille est un enfant DIRECT (pas de .pills). Elle ouvre la
     ligne, le prix la suit. */
  .head .right > .pill{align-self:flex-start}
  /* Prix, puis date poussée à droite. Le 2e .when (« Brouillon #… ») passe
     à la ligne suivante plutôt que d'être collé à la date. */
  .head .right .amount{white-space:nowrap}
  .head .right .when{white-space:nowrap}
  .head .right .amount ~ .when:first-of-type{margin-left:auto;text-align:right}
  /* En colonne étroite, les pastilles reprennent la 1re ligne : le DOM les
     place désormais APRÈS le montant (ordre de lecture du bureau), on
     rétablit ici la disposition mobile d'origine. */
  .head .right .pills{order:-1}
}

/* ══════════════════ MOBILE ══════════════════ */
@media (max-width:760px){
  /* Filet de sécurité : la page ne défile jamais horizontalement. */
  html,body{max-width:100%;overflow-x:hidden}

  /* — Barre du haut : hauteur libre, actions sur une 2e ligne défilante — */
  .topbar{
    height:auto;flex-wrap:wrap;gap:8px;padding:10px 14px;
    align-items:center;
  }
  .brand{flex:1;min-width:0}                 /* min-width:0 => l'ellipse marche */
  .brand-txt{min-width:0}
  .brand-txt b{
    font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  }
  /* Le sous-titre passait sur 3 lignes : on le masque, il n'apporte rien ici. */
  .brand-txt span{display:none}

  .topbar-actions{
    order:3;
    /* width:100% ne suffit pas : sans min-width:0 ni max-width, la ligne de
       boutons s'étire au-delà de l'écran et pousse toute la page en largeur. */
    width:100%;min-width:0;max-width:100%;
    gap:4px;
    overflow-x:auto;                          /* si trop de boutons : défilement */
    -webkit-overflow-scrolling:touch;
    scrollbar-width:none;
    padding-bottom:2px;
  }
  .topbar-actions::-webkit-scrollbar{display:none}
  .theme-btn,.logout{
    font-size:11.5px;padding:6px 8px;gap:4px;white-space:nowrap;flex:none;
  }
  /* La cloche reste en tête de ligne, toujours accessible. */
  .bell-wrap{order:-1}

  /* La barre défile horizontalement (overflow-x:auto) : un panneau en
     position:absolute y serait rogné. On le sort du flux de la barre et on
     l'ancre au bord droit de l'écran. La barre a ici une hauteur libre
     (deux lignes) : le décalage vertical est mesuré à l'ouverture et posé
     dans --cog-top plutôt que deviné. */
  .cog-menu{
    position:fixed;top:var(--cog-top,60px);right:12px;
    width:auto;min-width:242px;
  }
  .cog-menu::before{display:none}

  /* — Stats : 2 colonnes. Le chiffre est réduit et ne se coupe plus
       (« 4510,60 € » passait sur 2 lignes). — */
  .stats{grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}
  /* Le filet coloré occupe 3px à gauche : on décale le contenu d'autant. */
  .stat{padding:13px 13px 13px 15px;gap:8px}
  /* Cartes plus compactes ici : un écart intermédiaire, sinon elles s'étirent. */
  .stat-body{min-width:0;gap:7px}
  .stat .num{font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  /* Deux colonnes étroites ne peuvent pas tenir 25 caractères sur une ligne :
     l'ellipse du desktop couperait « estimé ». Ici on laisse le libellé se
     replier — mieux vaut deux lignes lisibles qu'un mot amputé. */
  .stat .cap{
    font-size:9.5px;letter-spacing:.02em;line-height:1.3;
    white-space:normal;overflow:visible;text-overflow:clip;
  }
  .stat-ico{width:34px;height:34px;flex:none}

  /* — Barre d'outils : recherche pleine largeur — */
  .toolbar{flex-direction:column;align-items:stretch;gap:8px}
  .toolbar .search{width:100%}
  .filters{width:100%}
  .filters .dd{flex:1;min-width:0;display:block}
  .export-wrap{width:100%}
  .export-wrap .btn{width:100%;justify-content:center}

  /* — Filtres de liste : un menu par ligne, pleine largeur.
       Côte à côte, « Tous les statuts (30) » était tronqué. — */
  .subfilters{gap:8px;flex-direction:column;align-items:stretch}
  .subfilters .dd{width:100%;min-width:0;display:block}

  /* — Modales : plein écran utile — */
  .modal{padding:12px}
  .modal-box{padding:18px;max-height:calc(100vh - 24px)}
  .modal-actions{flex-direction:column-reverse;gap:8px}
  .modal-actions .btn{width:100%}

  /* — Prix : label au-dessus du champ — */
  .price-line{flex-direction:column;align-items:stretch;gap:6px}
  .price-field{justify-content:space-between}
  .price-field .price-input{flex:1;width:auto}
}

/* Très petits écrans : une stat par ligne plutôt que des chiffres tronqués. */
@media (max-width:400px){
  .stats{grid-template-columns:1fr}
  .stat .num{font-size:22px}
}

/* ═══════════════════════════════════════════════════════════════
   PAGE DE CONNEXION
   Écran isolé (pas de nav, pas de contenu) : la carte porte seule
   la hiérarchie. Fond travaillé pour éviter l'aplat de gris.
   ═══════════════════════════════════════════════════════════════ */
.lg-wrap{
  min-height:100vh; display:flex; flex-direction:column;
  align-items:center; justify-content:center; gap:18px; padding:24px;
  position:relative;
  /* Deux halos très doux teintés de l'accent : donne de la profondeur
     sans image, et suit automatiquement le thème. */
  background:
    radial-gradient(60ch 40ch at 50% -10%, var(--accent-soft), transparent 70%),
    radial-gradient(50ch 34ch at 50% 110%, var(--raise), transparent 70%);
}
.lg-theme{
  position:absolute; top:20px; right:20px;
  width:38px; height:38px; display:grid; place-items:center;
  border:1px solid var(--line); border-radius:11px;
  background:var(--surface); color:var(--muted);
  cursor:pointer; transition:color .15s, border-color .15s, transform .15s;
}
.lg-theme:hover{color:var(--ink); border-color:var(--faint); transform:translateY(-1px)}
.lg-theme svg{width:17px;height:17px}

.lg-card{
  width:100%; max-width:400px;
  background:var(--surface); border:1px solid var(--line);
  border-radius:20px; padding:36px 32px 32px;
  /* Ombre en TROIS couches plutôt qu'une : un trait de lumière en haut, un
     contact rapproché, une portée large. C'est ce qui donne à la carte
     l'impression de reposer sur la page au lieu d'y être collée. */
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.7),
    0 1px 2px rgba(27,31,36,.05),
    0 12px 32px rgba(27,31,36,.07);
  /* Entrée discrète : la page de connexion est la première chose que voit
     l'équipe, un surgissement brut la rend abrupte. */
  animation:lg-in .32s cubic-bezier(.22,1,.36,1);
}
:root[data-theme="dark"] .lg-card{
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.04),
    0 1px 2px rgba(0,0,0,.3),
    0 12px 36px rgba(0,0,0,.35);
}
@keyframes lg-in{
  from{opacity:0; transform:translateY(8px) scale(.99)}
  to{opacity:1; transform:none}
}
/* Le mouvement est un confort : qui l'a désactivé au niveau du système ne
   doit pas le subir ici. */
@media (prefers-reduced-motion:reduce){
  .lg-card{animation:none}
}

/* Marque : le logo passe en pastille pleine — c'est le seul élément
   coloré avec le bouton, il ancre le regard en haut de carte.

   Séparée du titre par un filet : l'identité de l'outil et l'action demandée
   sont deux choses distinctes, et la carte gagne en structure. */
.lg-brand{
  display:flex; align-items:center; gap:12px;
  padding-bottom:22px; margin-bottom:24px;
  border-bottom:1px solid var(--line);
}
.lg-mark{
  width:42px; height:42px; flex:none; display:grid; place-items:center;
  border-radius:13px; background:var(--accent); color:#fff;
  /* Dégradé très léger : une pastille en aplat paraît plate à cette taille. */
  background-image:linear-gradient(160deg, rgba(255,255,255,.18), transparent 60%);
  box-shadow:0 4px 14px rgba(194,65,12,.3), inset 0 1px 0 rgba(255,255,255,.25);
}
.lg-mark svg{width:21px; height:21px; display:block}
:root[data-theme="dark"] .lg-mark{
  color:#05202b; box-shadow:0 4px 16px rgba(127,219,202,.24);
}
.lg-brand-txt{display:flex; flex-direction:column; gap:2px; min-width:0}
.lg-brand-txt b{font-size:15px; font-weight:800; letter-spacing:-.015em}
.lg-brand-txt span{font-size:11.5px; color:var(--muted); letter-spacing:.01em}

.lg-title{font-size:22px; font-weight:800; letter-spacing:-.028em; margin-bottom:6px}
.lg-sub{font-size:13px; color:var(--muted); margin-bottom:24px; line-height:1.5}

/* Messages d'erreur : barre latérale colorée plutôt qu'un aplat, plus
   lisible et moins agressif que le bloc plein d'origine. */
.lg-alert{
  display:flex; align-items:flex-start; gap:9px;
  padding:11px 13px; border-radius:10px; margin-bottom:18px;
  font-size:12.5px; line-height:1.45;
}
.lg-alert svg{width:16px; height:16px; flex:none; margin-top:1px}
.lg-alert.is-error{
  background:var(--accent-soft); color:var(--accent);
  border-left:3px solid var(--accent);
}
.lg-alert.is-blocked{
  background:var(--danger-soft); color:var(--danger);
  border-left:3px solid var(--danger);
}

.lg-form{display:flex; flex-direction:column; gap:15px}
.lg-field{display:flex; flex-direction:column; gap:8px}
.lg-lbl{
  font-size:10.5px; font-weight:700; letter-spacing:.07em;
  text-transform:uppercase; color:var(--muted);
  transition:color .15s;
}
/* L'étiquette s'allume avec son champ : le regard sait où il est, même sur
   un formulaire de deux lignes. */
.lg-field:focus-within .lg-lbl{color:var(--accent)}

/* Champ + icône : l'icône est posée DANS le champ, d'où le padding
   gauche de l'input et le positionnement absolu. */
.lg-input-wrap{position:relative; display:flex; align-items:center}
.lg-icon{
  position:absolute; left:13px; width:16px; height:16px;
  color:var(--faint); pointer-events:none; transition:color .15s;
}
.lg-input-wrap input{
  width:100%; padding:14px 14px 14px 42px;
  border:1px solid var(--line); border-radius:12px;
  background:var(--paper); color:var(--ink);
  font:inherit; font-size:14.5px; outline:none;
  transition:border-color .16s, box-shadow .16s, background .16s;
}
.lg-input-wrap input::placeholder{color:var(--faint)}
.lg-input-wrap input:hover{border-color:var(--faint)}
.lg-input-wrap input:focus{
  border-color:var(--accent); background:var(--surface);
  /* Anneau plus large qu'un simple trait : à 3 px il se confondait avec la
     bordure, à 4 il se lit franchement — y compris pour qui distingue mal
     les nuances de couleur. */
  box-shadow:0 0 0 4px var(--accent-soft);
}
.lg-input-wrap input:focus + .lg-icon,
.lg-input-wrap:focus-within .lg-icon{color:var(--accent)}

/* Le champ mot de passe réserve la place du bouton « œil ». */
#lg-pass{padding-right:44px}
.lg-eye{
  position:absolute; right:6px;
  width:32px; height:32px; display:grid; place-items:center;
  border:none; border-radius:8px; background:none;
  color:var(--faint); cursor:pointer; transition:color .15s, background .15s;
}
.lg-eye:hover{color:var(--ink); background:var(--raise)}
.lg-eye svg{width:16px; height:16px}
/* Mot de passe visible : l'œil est barré et prend la couleur d'accent. */
.lg-eye.is-on{color:var(--accent)}
.lg-eye.is-on::after{
  content:''; position:absolute; left:7px; right:7px; top:50%;
  height:1.6px; background:currentColor; border-radius:2px;
  transform:rotate(-45deg);
}

/* Autofill : Chrome impose son bleu et écrase le fond du champ. On le
   neutralise par une ombre interne de la taille du champ (seul moyen
   fiable), et on force la couleur du texte. */
.lg-input-wrap input:-webkit-autofill,
.lg-input-wrap input:-webkit-autofill:hover,
.lg-input-wrap input:-webkit-autofill:focus{
  -webkit-box-shadow:0 0 0 100px var(--paper) inset;
  box-shadow:0 0 0 100px var(--paper) inset;
  -webkit-text-fill-color:var(--ink);
  caret-color:var(--ink);
}

.lg-submit{
  margin-top:8px; width:100%; padding:14px;
  border:none; border-radius:12px;
  background:var(--accent); color:#fff;
  /* Même dégradé que la pastille de marque : les deux seuls éléments colorés
     de la page se répondent. */
  background-image:linear-gradient(180deg, rgba(255,255,255,.14), transparent 55%);
  font:inherit; font-size:14.5px; font-weight:700; letter-spacing:.01em;
  cursor:pointer; transition:filter .15s, transform .12s, box-shadow .15s;
  box-shadow:0 4px 14px rgba(194,65,12,.26), inset 0 1px 0 rgba(255,255,255,.2);
}
.lg-submit:hover{filter:brightness(1.06); transform:translateY(-1px);
  box-shadow:0 7px 20px rgba(194,65,12,.32), inset 0 1px 0 rgba(255,255,255,.2)}
.lg-submit:active{transform:translateY(0); filter:brightness(.98)}
/* Anneau de focus visible au clavier : le bouton est la seule action de la
   page, on ne doit jamais perdre sa trace en tabulant. */
.lg-submit:focus-visible{
  outline:none; box-shadow:0 0 0 4px var(--accent-soft), 0 4px 14px rgba(194,65,12,.26);
}
:root[data-theme="dark"] .lg-submit{
  color:#05202b; box-shadow:0 4px 14px rgba(127,219,202,.2);
}
:root[data-theme="dark"] .lg-submit:hover{box-shadow:0 6px 18px rgba(127,219,202,.26)}

.lg-foot{font-size:11px; color:var(--faint); text-align:center}

/* Écrans étroits : la carte occupe la largeur, sans marge inutile. */
@media (max-width:430px){
  .lg-wrap{padding:16px}
  .lg-card{padding:26px 20px 24px; border-radius:16px}
  .lg-theme{top:12px; right:12px}
}

/* ═══════════════════════════════════════════════════════════════
   BANDEAU « NOUVELLES DONNÉES »
   Remplace le rechargement automatique, qui coupait la lecture et la
   saisie. L'utilisateur actualise quand il le décide.
   ═══════════════════════════════════════════════════════════════ */
.refresh-bar{
  position:fixed;left:50%;bottom:22px;transform:translateX(-50%);
  z-index:4000;display:flex;align-items:center;gap:10px;
  padding:12px 14px 12px 16px;border-radius:999px;
  background:var(--ink);color:var(--paper);
  box-shadow:0 8px 28px rgba(0,0,0,.28);
  font-size:13px;font-weight:600;
  max-width:calc(100vw - 40px);
  min-width:320px;
  animation:refreshIn .22s ease;
}
@keyframes refreshIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}}
.refresh-bar>svg{width:16px;height:16px;flex:none;opacity:.8}
.refresh-bar>span{
  white-space:nowrap;
  overflow:visible;
  text-overflow:clip;
  flex:1;
  min-width:0;
}
.refresh-bar button{
  flex:none;border:none;border-radius:999px;cursor:pointer;
  font:inherit;font-size:12px;font-weight:700;
  padding:6px 13px;background:var(--accent);color:#fff;
  transition:filter .15s;
}
.refresh-bar button:hover{filter:brightness(1.08)}
:root[data-theme="dark"] .refresh-bar button{color:#05202b}
/* Croix « ignorer » : discrète, elle ne concurrence pas l'action principale. */
.refresh-bar .refresh-bar-x{
  background:none;color:var(--paper);opacity:.55;
  padding:0;width:24px;height:24px;display:grid;place-items:center;
}
.refresh-bar .refresh-bar-x:hover{opacity:1;filter:none}
.refresh-bar .refresh-bar-x svg{width:13px;height:13px}

/* Étroit : le bandeau occupe la largeur. Pas de redéfinition de refreshIn ici —
   une @keyframes dans un @media écrase la règle globale selon l'ordre de
   cascade, ce qui casserait l'animation sur grand écran. L'animation part
   simplement de l'état translaté du bandeau plein format. */
@media (max-width:520px){
  .refresh-bar{
    left:12px;right:12px;bottom:12px;border-radius:12px;
    transform:none;animation:none;
    min-width:auto;
    padding:12px 14px;
  }
  .refresh-bar>span{
    white-space:normal;
    line-height:1.3;
  }
}

@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function shell(body: string, nonce = ''): string {
  const n = nonce ? ` nonce="${nonce}"` : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Administration du configurateur — Massacre</title>
<style${n}>${STYLE}</style></head><body>${body}
<script${n}>
(function(){
  // Thème mémorisé
  var KEY='ct_admin_theme';
  try{var t=localStorage.getItem(KEY);if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}
  window.toggleTheme=function(){
    var cur=document.documentElement.getAttribute('data-theme');
    // Défaut = clair : un premier clic passe donc au sombre, quelle que
    // soit la préférence système.
    var next = (cur === 'dark') ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme',next);
    try{localStorage.setItem(KEY,next);}catch(e){}
  };
})();
</script></body></html>`;
}

/** Page de connexion. */
/**
 * Page de connexion.
 * @param error  identifiants refusés
 * @param reason 'blocked' : la session a été coupée (compte bloqué/supprimé),
 *               d'où un message dédié plutôt qu'un écran de login muet.
 */
export function loginPage(
  error?: boolean,
  reason?: 'blocked',
  nonce = '',
): string {
  const alert = error
    ? `<div class="lg-alert is-error" role="alert">
         <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
           <circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".9" fill="currentColor" stroke="none"/>
         </svg>
         <span>E-mail ou mot de passe incorrect, ou compte bloqué.</span>
       </div>`
    : reason === 'blocked'
      ? `<div class="lg-alert is-blocked" role="alert">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
             <rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
           </svg>
           <span>Votre session a pris fin : votre accès a été suspendu. Contactez l’administrateur principal.</span>
         </div>`
      : '';

  return shell(`
  <div class="lg-wrap">
    <!-- Bascule de thème : la page de connexion précède le dashboard, elle
         doit pouvoir passer en sombre sans s'authentifier d'abord. -->
    <button type="button" class="lg-theme" onclick="toggleTheme()" title="Changer de thème" aria-label="Changer de thème">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>
      </svg>
    </button>

    <main class="lg-card">
      <div class="lg-brand">
        <!-- UN VÊTEMENT, ET LE MÊME QUE DANS LE CONFIGURATEUR.

             Le tracé est repris tel quel des onglets de vue du configurateur
             (sections/configurateur.liquid) : les deux interfaces pilotent le
             même atelier, elles doivent parler le même langage visuel. Une
             étoile, puis des curseurs de réglage, ne disaient ni l'un ni
             l'autre ce que cet espace administre. -->
        <div class="lg-mark">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 3 4 5.5 5.5 10 7 9.5V21h10V9.5L18.5 10 20 5.5 15 3"/>
            <path d="M9 3a3 3 0 0 0 6 0"/>
          </svg>
        </div>
        <div class="lg-brand-txt">
          <b>Administration</b>
          <span>Configurateur Massacre</span>
        </div>
      </div>

      <h1 class="lg-title">Connexion</h1>
      <p class="lg-sub">Accès réservé à l'équipe.</p>

      ${alert}

      <form method="post" action="/api/admin/login" class="lg-form">
        <div class="lg-field">
          <label class="lg-lbl" for="lg-email">E-mail</label>
          <div class="lg-input-wrap">
            <svg class="lg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>
            </svg>
            <input id="lg-email" name="email" type="email" autocomplete="username"
                   placeholder="vous@exemple.com" required autofocus>
          </div>
        </div>

        <div class="lg-field">
          <label class="lg-lbl" for="lg-pass">Mot de passe</label>
          <div class="lg-input-wrap">
            <svg class="lg-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>
            </svg>
            <input id="lg-pass" name="password" type="password" autocomplete="current-password"
                   placeholder="••••••••" required>
            <!-- Révéler le mot de passe : une saisie masquée à l'aveugle est
                 la première cause d'échec de connexion. -->
            <button type="button" class="lg-eye" onclick="lgToggle(this)" aria-label="Afficher le mot de passe">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
          </div>
        </div>

        <button type="submit" class="lg-submit">Se connecter</button>
      </form>
    </main>

    <p class="lg-foot">Administration du configurateur · Massacre Officiel</p>
  </div>

  <script${nonce ? ` nonce="${nonce}"` : ''}>
    /* Bascule masqué/visible du mot de passe. L'icône passe en « œil barré »
       quand le texte est lisible, pour que l'état soit explicite. */
    function lgToggle(btn){
      var i = document.getElementById('lg-pass');
      if(!i) return;
      var show = i.type === 'password';
      i.type = show ? 'text' : 'password';
      btn.classList.toggle('is-on', show);
      btn.setAttribute('aria-label', show ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      i.focus();
    }
  </script>`, nonce);
}

/**
 * Pastille du statut Shopify, en français.
 * Déduite du suivi de production, qui est tenu aligné sur Shopify dans les
 * deux sens (voir shipping-status.ts). « Prête » n'existe pas chez Shopify :
 * la commande y est « en préparation ».
 */
function shipPill(o: Order): string {
  const prod = o.productionStatus || 'to_produce';
  const map: Record<string, [string, string]> = {
    to_produce: ['Non traitée', 'neutral'],
    producing: ['En préparation', 'warn'],
    ready: ['En préparation', 'warn'],
    shipped: ['Traitée', 'ok'],
  };
  let [label, cls] = map[prod] || map.to_produce;

  // Expédition partielle : Shopify a traité une partie des articles. Le suivi
  // de production ne sait pas l'exprimer (`fromShopify` laisse volontairement
  // l'atelier décider), donc sans ce cas la commande s'affichait « Non
  // traitée » alors qu'un colis est déjà parti.
  if (o.fulfillmentStatus === 'partial' && prod !== 'shipped') {
    label = 'Partiellement traitée';
    cls = 'warn';
  }

  const t = o.trackingNumber ? ` title="Suivi : ${esc(o.trackingNumber)}"` : '';
  return `<span class="pill ${cls}"${t}>Shopify : ${esc(label)}</span>`;
}

function statusPill(status: string | null): string {
  const s = (status || '').toLowerCase();
  if (s === 'paid') return `<span class="pill ok">Payé</span>`;
  if (s === 'pending' || s === 'authorized') return `<span class="pill warn">${esc(status)}</span>`;
  return `<span class="pill neutral">${esc(status || '—')}</span>`;
}

function itemRow(li: any): string {
  const props: Array<{ name: string; value: string }> = Array.isArray(li.properties) ? li.properties : [];
  const imgs = props.filter((p) => isImg(p.value));
  const links = props.filter((p) => !isImg(p.value) && isUrl(p.value));
  const texts = props.filter((p) => !isUrl(p.value));
  const thumbs = imgs.length
    ? `<div class="thumbs">${imgs.map((p) => `<img class="thumb js-zoom" src="${esc(p.value)}" title="${esc(p.name)}" data-zoom="${esc(p.value)}" alt="${esc(p.name)}">`).join('')}</div>`
    : `<div class="no-thumb">Sans aperçu</div>`;
  const specs = texts.length
    ? `<div class="specs">${texts.map((p) => `<span class="spec"><b>${esc(p.name)}</b> ${esc(p.value)}</span>`).join('')}</div>`
    : '';
  const dls = links.map((p) => `<a class="dl" href="${esc(p.value)}" target="_blank" rel="noopener">↓ ${esc(p.name.replace(/^_/, ''))}</a>`).join('');
  return `<div class="item">
    ${thumbs}
    <div class="item-body">
      <div class="title">${esc(li.title)}${li.variantTitle ? ` · ${esc(li.variantTitle)}` : ''} <span class="qty mono">× ${esc(li.quantity)}</span></div>
      ${specs}
      ${dls ? `<div>${dls}</div>` : ''}
    </div>
  </div>`;
}

function clientBlock(o: Order): string {
  const info: any = o.customerInfo || {};
  const s = info.shipping || info.billing || {};
  const addrParts = [s.address1, s.address2, [s.zip, s.city].filter(Boolean).join(' '), s.province, s.country].filter(Boolean);
  const addr = addrParts.map(esc).join(', ');
  const name = o.customerName || s.name || '';
  const email = o.customerEmail || info.email || '';
  const phone = o.customerPhone || info.phone || s.phone || '';
  const kv = (k: string, v: string) => `<div class="kv"><span class="k">${k}</span>${v || '<span class="empty">—</span>'}</div>`;
  const hasAny = name || email || phone || addr;
  if (!hasAny) {
    return `<div class="section-lbl lbl">Client & livraison</div>
      <div class="client"><div class="kv" style="grid-column:1/-1"><span class="empty">Coordonnées non communiquées pour cette commande.</span></div></div>`;
  }
  return `<div class="section-lbl lbl">Client & livraison</div>
    <div class="client">
      ${kv('Nom', esc(name))}
      ${kv('Email', email ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : '')}
      ${kv('Téléphone', phone ? `<a href="tel:${esc(phone)}">${esc(phone)}</a>` : '')}
      ${s.company ? kv('Société', esc(s.company)) : ''}
      ${addr ? `<div class="kv" style="grid-column:1/-1"><span class="k">Adresse de livraison</span>${addr}</div>` : ''}
      ${info.note ? `<div class="kv" style="grid-column:1/-1"><span class="k">Note du client</span>${esc(info.note)}</div>` : ''}
    </div>`;
}

/* Icônes des cartes de statistiques (contour, hérite de la couleur). */
const svg = (d: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
     stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

/* Ces icônes sont lues à 20 px. Une machine à coudre détaillée y devient une
   tache : chaque tracé ci-dessous reste lisible à cette taille. */

/** À fabriquer : le vêtement de l'atelier, celui de la marque. */
const ICO_MAKE = svg(
  '<path d="M9 3 4 5.5 5.5 10 7 9.5V21h10V9.5L18.5 10 20 5.5 15 3"/><path d="M9 3a3 3 0 0 0 6 0"/>',
);
/** Commandes reçues : carton d'expédition. */
const ICO_BOX = svg(
  '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
);
/** Chiffre d'affaires : courbe ascendante — la progression, pas l'unité,
    déjà portée par le « € » du chiffre lui-même. */
const ICO_EURO = svg(
  '<path d="M3 17l5.5-5.5 3.5 3.5L21 6"/><path d="M15 6h6v6"/>',
);
/** Devis à traiter : document chiffré. L'enveloppe d'avant disait « e-mail ». */
const ICO_QUOTE = svg(
  '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>',
);

/** Carte du bandeau de statistiques : valeur, libellé et icône. */
function statCard(
  value: string | number,
  caption: string,
  icon: string,
  cls = '',
  titre = '',
): string {
  /* Le libellé passe AVANT le chiffre : on lit d'abord ce qu'on mesure, puis
     la valeur. L'ordre visuel est rétabli en CSS (flex-direction:column-reverse),
     pour que l'ordre du DOM — celui qu'entend un lecteur d'écran — reste juste. */

  /* `titre` porte la valeur exacte quand l'affichage est abrégé : le montant
     complet reste accessible au survol, sans élargir la carte. */
  const infobulle = titre ? ` title="${esc(titre)}"` : '';
  return `<div class="stat ${cls}">
    <div class="stat-body">
      <div class="cap">${caption}</div>
      <div class="num mono"${infobulle}>${value}</div>
    </div>
    <div class="stat-ico" aria-hidden="true">${icon}</div>
  </div>`;
}

/** Étapes du suivi de production (interne à l'atelier). */
const PROD_STEPS: Array<{ key: string; label: string; cls: string }> = [
  { key: 'to_produce', label: 'À produire',    cls: 'todo' },
  { key: 'producing',  label: 'En production', cls: 'doing' },
  { key: 'ready',      label: 'Prête',         cls: 'ready' },
  { key: 'shipped',    label: 'Expédiée',      cls: 'done' },
];

function prodPill(status: string): string {
  const st = PROD_STEPS.find((s) => s.key === status) || PROD_STEPS[0];
  return `<span class="pill prod ${st.cls}">${st.label}</span>`;
}

/* Bloc « liste des personnes » sur une carte COMMANDE.
   Une commande de groupe naît d'un devis : la liste (tailles, couleurs, noms
   floqués) vit dans quoteData.group, pas dans la commande Shopify. Sans ce
   rappel, l'atelier devrait rouvrir le devis d'origine pour produire.
   Rendu identique à la carte devis — mêmes helpers, pas de duplication. */
/** Lit une propriété de line item par nom (insensible à la casse). */
function propVal(li: any, name: string): string {
  const props: Array<{ name: string; value: string }> = Array.isArray(li?.properties) ? li.properties : [];
  const p = props.find((x) => String(x.name).toLowerCase() === name.toLowerCase());
  return p ? String(p.value) : '';
}

/**
 * Reconstruit les lignes d'une commande de groupe à partir des line items.
 * Les groupes passent désormais par le PANIER (plus par un devis) : chaque
 * ligne porte les propriétés Personne / Liste / Ligne posées au checkout.
 * On détecte un groupe dès qu'au moins un item porte la propriété « Liste ».
 */
function groupRowsFromItems(items: any[]): { rows: any[]; label: string } | null {
  const rows: any[] = [];
  let label = '';
  for (const li of items) {
    const liste = propVal(li, 'Liste');
    if (!liste) continue; // item hors groupe (ex. add-on manche)
    if (!label) label = liste;
    
    // 🆕 RECONSTRUCTION DES PROPRIÉTÉS TYPOGRAPHIQUES COMPLÈTES
    const textProperties: any = {};
    
    // Récupérer toutes les propriétés de texte personnalisé
    const textProps = [
      'TexteFontFamily', 'TexteFontSize', 'TexteFontWeight', 'TexteFontStyle',
      'TexteColor', 'TexteDecoration', 'TexteAlign', 'TexteLineHeight',
      'TexteLetterSpacing', 'TexteTransform', 'TexteLeft', 'TexteTop',
      'TexteWidth', 'TexteHeight', 'TexteMaxWidth', 'TexteDataW',
      'TexteDataWantedSize', 'TexteDataMaxFit', 'TexteZone', 'TexteCurved'
    ];
    
    let hasTextProps = false;
    textProps.forEach(prop => {
      const value = propVal(li, '_' + prop); // Propriétés préfixées par "_"
      if (value) {
        hasTextProps = true;
        /* Convertir les noms de propriétés en camelCase.

           L'ordre comptait : `charAt(0).toLowerCase()` consommait déjà le T,
           si bien que `.replace('Texte','')` ne trouvait plus rien dans
           « exteFontFamily ». Les 20 clés sortaient en « texteFontFamily », et
           le test sur `.curved` juste en dessous ne se déclenchait jamais.
           On retire donc le préfixe AVANT de passer en minuscule. */
        const sansPrefixe = prop.replace(/^Texte/, '');
        const key = sansPrefixe.charAt(0).toLowerCase() + sansPrefixe.slice(1);
        textProperties[key] = value;
      }
    });
    
    // Convertir 'curved' en booléen
    if (textProperties.curved) {
      textProperties.curved = textProperties.curved === 'true';
    }

    rows.push({
      name: propVal(li, 'Personne') || '—',
      size: propVal(li, 'Taille'),
      // Détails = « Couleur : X » côté panier ; on isole le nom lisible.
      color: (propVal(li, 'Détails') || '').replace(/^\s*couleur\s*:\s*/i, ''),
      flock: propVal(li, 'Personne'), // nom floqué = identifiant de la ligne
      // 🆕 PROPRIÉTÉS TYPOGRAPHIQUES COMPLÈTES
      textProperties: hasTextProps ? textProperties : null,
      qty: Number(li.quantity) || 1,
    });
  }
  return rows.length ? { rows, label } : null;
}

function groupBlockForOrder(q?: Quote, items?: any[]): string {
  // 1) Source privilégiée : les line items de la commande (flux panier actuel).
  let rows: any[] = [];
  let productLabel = 'Textile';
  let quoteLink = '';

  const fromItems = Array.isArray(items) ? groupRowsFromItems(items) : null;
  if (fromItems) {
    rows = fromItems.rows;
    productLabel = fromItems.label || 'Groupe';
  } else if (q) {
    // 2) Repli : ancien flux devis (commandes de groupe historiques).
    const d: any = q.quoteData || {};
    const group: any = d.group || null;
    rows = group && Array.isArray(group.rows) ? group.rows : [];
    if (rows.length) {
      productLabel = group.productLabel || 'Textile';
      quoteLink = `<a class="mono" style="float:right;font-size:10px;cursor:pointer"
         onclick="gotoCard('quotes','quote-${esc(q.id)}')">Devis d'origine ›</a>`;
    }
  }
  if (!rows.length) return '';

  const total = rows.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0);

  /* La colonne typographie n'apparaît que si au moins une ligne la porte :
     une commande sans texte floqué n'a pas à traîner une colonne vide. */
  const avecTypo = rows.some((r: any) => r.textProperties);

  return `<div class="section-lbl lbl">
      Commande de groupe · ${esc(productLabel)}
      <span class="badge-group">Groupe</span>
      ${quoteLink}
    </div>
    <div class="grp-list-wrap">
      <table class="grp-list">
        <thead><tr><th>Nom floqué</th><th>Taille</th><th>Couleur</th>${
          avecTypo ? '<th>Typo</th>' : ''
        }<th class="num">Qté</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r) => `<tr>
                <td>${r.name ? esc(r.name) : '<span class="empty">—</span>'}</td>
                <td>${esc(r.size || '')}</td>
                <td>${colorCell(r.color || '')}</td>
                ${avecTypo ? `<td>${typoCell(r.textProperties)}</td>` : ''}
                <td class="num">${esc(r.qty || 1)}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
        <tfoot><tr><td colspan="${avecTypo ? 4 : 3}">Total</td><td class="num">${total}</td></tr></tfoot>
      </table>
    </div>`;
}

/**
 * Résumé typographique d'une ligne : police, corps et pastille de couleur.
 *
 * Ces données étaient collectées puis abandonnées — `textProperties` n'était lu
 * nulle part dans le rendu. L'atelier ne savait donc pas en quelle police
 * flocker, alors que l'information voyageait jusqu'ici.
 *
 * Volontairement court : le détail complet (position, dimensions) est sur la
 * fiche de production, c'est là qu'on en a besoin.
 */
/**
 * Bloc typographique de la fiche de production.
 *
 * L'atelier a la fiche sous les yeux en produisant : il lui faut la police
 * exacte, son corps, sa couleur et sa position. Ces propriétés étaient rendues
 * en vrac parmi les spécifications, avec leur nom technique brut
 * (« _TexteFontFamily ») et leur préfixe « _ ».
 *
 * @param props les propriétés `_TexteXxx` de la ligne
 */
function blocTypoFiche(props: Array<{ name: string; value: string }>): string {
  /* Nom technique -> libellé d'atelier. Les propriétés absentes de cette table
     (données de repositionnement, sans usage en production) sont écartées :
     une fiche imprimée doit tenir sur une page. */
  const LIBELLES: Record<string, string> = {
    _TexteFontFamily: 'Police',
    _TexteFontSize: 'Corps',
    _TexteFontWeight: 'Graisse',
    _TexteFontStyle: 'Style',
    _TexteColor: 'Couleur',
    _TexteDecoration: 'Décoration',
    _TexteAlign: 'Alignement',
    _TexteTransform: 'Casse',
    _TexteLetterSpacing: 'Interlettrage',
    _TexteLeft: 'Position X',
    _TexteTop: 'Position Y',
    _TexteWidth: 'Largeur',
    _TexteZone: 'Zone',
    _TexteCurved: 'Courbé',
  };

  const lignes = props
    .filter((p) => LIBELLES[p.name] && String(p.value || '').trim())
    .map((p) => {
      let valeur = String(p.value).trim();

      // La police arrive en pile CSS : seule la première s'applique.
      if (p.name === '_TexteFontFamily') {
        valeur = valeur.split(',')[0].replace(/['"]/g, '').trim();
      }
      if (p.name === '_TexteCurved') {
        valeur = valeur === 'true' ? 'oui' : 'non';
      }

      const pastille =
        p.name === '_TexteColor'
          ? `<span class="ps-typo-dot" style="background:${esc(valeur)}"></span>`
          : '';

      return `<div><b>${esc(LIBELLES[p.name])}</b><span>${pastille}${esc(valeur)}</span></div>`;
    });

  if (!lignes.length) return '';

  return `<div class="ps-typo">
    <div class="ps-typo-lbl">Texte à flocker</div>
    <div class="ps-typo-grid">${lignes.join('')}</div>
  </div>`;
}

function typoCell(tp: any): string {
  if (!tp) return '<span class="empty">—</span>';

  /* La police arrive sous forme de pile CSS (« 'Anton', Impact, sans-serif ») :
     on ne garde que la première, la seule réellement appliquée. */
  const police = String(tp.fontFamily || '')
    .split(',')[0]
    .replace(/['"]/g, '')
    .trim();

  const corps = String(tp.fontSize || '').trim();
  const couleur = String(tp.color || '').trim();

  const bouts: string[] = [];
  if (police) bouts.push(esc(police));
  if (corps) bouts.push(esc(corps));

  const pastille = couleur
    ? `<span class="typo-dot" style="background:${esc(couleur)}" title="${esc(couleur)}"></span>`
    : '';

  if (!bouts.length && !pastille) return '<span class="empty">—</span>';
  return `<span class="typo-cell">${pastille}${bouts.join(' · ')}</span>`;
}

/* @param srcQuote  Devis à l'origine de la commande, s'il y en a un
     (rapproché via Quote.paidOrderId). Sert à afficher la liste des personnes
     d'une commande de groupe : sans ce lien, l'atelier devrait retrouver le
     devis à la main pour connaître les tailles et les noms floqués. */
function orderCard(o: Order, srcQuote?: Quote): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const nbItems = items.reduce((s: number, li: any) => s + (li.quantity || 0), 0);
  const productNames = items.map((li: any) => li.title).filter(Boolean);
  const summary = productNames.length
    ? productNames.slice(0, 2).join(', ') + (productNames.length > 2 ? `…` : '')
    : `${nbItems} article(s)`;
  const search = esc([o.orderNumber, o.customerName, o.customerEmail, ...productNames].join(' ').toLowerCase());
  const prod = o.productionStatus || 'to_produce';
  const id = esc(o.shopifyOrderId);

  // Un groupe est détecté si une ligne porte la propriété « Liste » (flux
  // panier), ou via l'ancien devis source. Sert au filtre + badge.
  const groupBlock = groupBlockForOrder(srcQuote, items);
  const isGroup = !!groupBlock;

  return `<div class="card" data-search="${search}" data-prod="${esc(prod)}" data-group="${isGroup}" id="card-${id}">
    <div class="head" onclick="toggleCard(this)">
      <div class="avatar">${esc(initials(o.customerName))}</div>
      <div>
        <div class="id mono">${esc(o.orderNumber || '#' + o.shopifyOrderId)}
          ${o.seen ? '' : '<span class="badge-new">nouveau</span>'}
          ${isGroup ? '<span class="badge-group">Groupe</span>' : ''}
          <svg class="caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>
        <div class="sub">${esc(o.customerName || 'Client')} · ${esc(summary)} · ${nbItems} art.</div>
      </div>
      <div class="right">
        <!-- Montant en tête : c'est l'information qu'on scanne en premier
             dans une liste de commandes. Les statuts viennent ensuite, la
             date en dernier. -->
        <div class="amount mono">${money(o.totalPrice)}</div>
        <div class="pills">${prodPill(prod)}${shipPill(o)}${statusPill(o.financialStatus)}</div>
        <div class="when mono">${fdate(o.shopifyCreatedAt)} · ${ftime(o.shopifyCreatedAt)}</div>
      </div>
    </div>

    <div class="body">
      ${groupBlock}
      <!-- Suivi de production -->
      <div class="section-lbl lbl">Suivi de production</div>
      <div class="steps" id="steps-${id}">
        ${PROD_STEPS.map(
          (s) => `<button class="step ${s.cls}${s.key === prod ? ' active' : ''}"
                    data-step="${s.key}"
                    onclick="setProdStatus('${id}','${s.key}',this)">${s.label}</button>`,
        ).join('')}
      </div>

      ${clientBlock(o)}

      ${(() => {
        const sizeGroupSummary = getSizeGroupSummary(items);
        return sizeGroupSummary ? renderSizeGroupTable(items, sizeGroupSummary) : '';
      })()}

      <div class="section-lbl lbl">Articles à produire</div>
      ${(() => {
        /* Commande groupée par tailles : Shopify crée une ligne par taille,
           toutes portant le MÊME design. Les afficher toutes répétait quatre
           fois le même article — le détail des tailles est déjà donné par le
           tableau récapitulatif juste au-dessus. On n'en montre donc qu'une,
           avec la quantité totale. */
        const rows = collapseSizeGroup(items);
        return (
          rows.map(itemRow).join('') ||
          '<div class="kv"><span class="empty">Aucun article.</span></div>'
        );
      })()}

      <!-- Note interne -->
      <div class="section-lbl lbl">Note interne</div>
      <textarea class="note-input" id="note-${id}" rows="2"
        placeholder="Visible uniquement par votre équipe…"
        onblur="saveNote('${id}')">${esc(o.internalNote || '')}</textarea>
      <span class="hint" id="note-status-${id}"></span>

      <!-- Actions -->
      <div class="order-actions">
        <a class="btn primary" href="/api/admin/orders/${id}/sheet" target="_blank" rel="noopener">
          🖨 Fiche de production
        </a>
        <a class="btn" href="/api/admin/orders/${id}/assets.zip">
          ↓ Tous les fichiers (ZIP)
        </a>
      </div>
    </div>
  </div>`;
}

/**
 * Statut lisible d'un devis + pastille.
 *
 * `failed` — la création du brouillon Shopify a échoué — tombait jusqu'ici dans
 * le cas par défaut et s'affichait « À chiffrer », strictement comme un devis
 * sain. L'équipe cliquait « Envoyer la facture » pour découvrir seulement là
 * qu'aucun brouillon n'existe, sans savoir qu'un rattrapage automatique est en
 * cours.
 */
function quoteStatus(q: Quote): { key: string; pill: string } {
  const s = q.draftStatus || 'open';
  if (s === 'completed') {
    return { key: 'paid', pill: `<span class="pill ok">Payé</span>` };
  }
  if (s === 'invoice_sent') {
    return { key: 'sent', pill: `<span class="pill warn">Facture envoyée</span>` };
  }
  if (s === 'failed') {
    return {
      key: 'failed',
      pill: `<span class="pill danger" title="La création du brouillon Shopify a échoué. Une nouvelle tentative a lieu automatiquement toutes les 10 minutes.">Brouillon en échec</span>`,
    };
  }
  return { key: 'open', pill: `<span class="pill neutral">À chiffrer</span>` };
}

/**
 * Couleurs textiles : nom affiché -> code hex, pour la pastille de couleur.
 * Les lignes d'une commande de groupe ne stockent que le NOM de la couleur
 * (ex. « Royal Blue ») ; la source de vérité des codes est le configurateur
 * (sections/configurateur.liquid, appels selColor). Toute couleur ajoutée
 * là-bas doit l'être ici, sinon la pastille retombe sur un gris neutre.
 */
const COLOR_HEX: Record<string, string> = {
  Ash: '#eff1f0',
  Apricot: '#f5a623',
  Atoll: '#3bb9e0',
  Black: '#0a0a0a',
  'Bottle Green': '#143f2e',
  Brown: '#3a3130',
  Burgundy: '#3d1f35',
  Chocolate: '#4a3830',
  'Cobalt Blue': '#1e32e6',
  'Dark Grey': '#2e3944',
  'Diva Blue': '#1e6b78',
  'Fire Red': '#e01e1e',
  Gold: '#f5c518',
  'Kelly Green': '#2fa84f',
  'Millennial Lilac': '#6e7bd8',
  'Millennial Mint': '#9ee5c4',
  Natural: '#e8e2d0',
  Navy: '#1a2438',
  'Navy Blue': '#1b2a5b',
  Orange: '#f0500a',
  'Orchid Green': '#7de01e',
  'Orchid Pink': '#f5c8dc',
  'Pacific Grey': '#8a8d91',
  'Pixel Lime': '#a8e020',
  'Radiant Purple': '#3a1e9e',
  Red: '#a81e32',
  'Royal Blue': '#1e4be0',
  Sand: '#c4b49a',
  Sky: '#9ed8f0',
  'Solar Yellow': '#f5e518',
  Sorbet: '#b01e78',
  'Sport Grey': '#8a9499',
  'Stone Blue': '#3e6b85',
  'Sunset Orange': '#f5455e',
  'Swimming Pool': '#5ed0c4',
  'Urban Khaki': '#3a4130',
  'Urban Orange': '#c43418',
  'Urban Purple': '#1e1e6e',
  'Used Black': '#2e3438',
  White: '#ffffff',
};

/**
 * Nom de couleur précédé de sa pastille.
 * Couleur inconnue -> pastille grise + le nom reste lisible (pas de perte
 * d'information si le configurateur ajoute une teinte non répertoriée ici).
 */
function colorCell(name: string): string {
  if (!name) return '<span class="empty">—</span>';
  const hex = COLOR_HEX[name] || '#d4d4d4';
  return `<span class="color-cell"><span class="color-dot" style="background:${esc(
    hex,
  )}"></span>${esc(name)}</span>`;
}

/**
 * Agrège les lignes d'une commande de groupe en un tableau croisé
 * COULEUR × TAILLE (avec totaux) + la liste des flocages.
 * Sert au récap dans la carte devis ET à la fiche de production.
 */
function groupAggregate(rows: any[]): {
  sizes: string[];
  matrix: Array<{ color: string; counts: Record<string, number>; total: number }>;
  colTotals: Record<string, number>;
  grandTotal: number;
  flocks: Array<{ name: string; size: string; color: string; text: string }>;
} {
  // Ordre de tailles usuel ; les tailles inconnues sont ajoutées à la fin.
  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];
  const sizeSet = new Set<string>();
  const byColor = new Map<string, Record<string, number>>();

  rows.forEach((r) => {
    const size = String(r.size || '?').trim();
    const color = String(r.color || '?').trim();
    const qty = Number(r.qty) || 0;
    if (qty < 1) return;
    sizeSet.add(size);
    if (!byColor.has(color)) byColor.set(color, {});
    const row = byColor.get(color)!;
    row[size] = (row[size] || 0) + qty;
  });

  const sizes = [...sizeSet].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a);
    const ib = SIZE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const colTotals: Record<string, number> = {};
  let grandTotal = 0;
  const matrix = [...byColor.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([color, counts]) => {
      let total = 0;
      sizes.forEach((s) => {
        const n = counts[s] || 0;
        total += n;
        colTotals[s] = (colTotals[s] || 0) + n;
      });
      grandTotal += total;
      return { color, counts, total };
    });

  const flocks = rows
    .filter((r) => r.flock && String(r.flock).trim())
    .map((r) => ({
      name: String(r.name || '').trim(),
      size: String(r.size || '').trim(),
      color: String(r.color || '').trim(),
      text: String(r.flock).trim(),
    }));

  return { sizes, matrix, colTotals, grandTotal, flocks };
}


function quoteCard(q: Quote, shopDomain: string): string {
  const d: any = q.quoteData || {};
  const c = d.customer || {};
  const coin = d.coin || {};
  const group: any = d.group || null;
  const groupRows: any[] = group && Array.isArray(group.rows) ? group.rows : [];
  const previews: any[] = Array.isArray(coin.previews) ? coin.previews : [];
  const imgs = previews.flatMap((p) => [p.logo, p.base].filter(isImg));
  const thumbs = imgs.length
    ? `<div class="thumbs">${imgs.map((u) => `<img class="thumb js-zoom" src="${esc(u)}" data-zoom="${esc(u)}" alt="aperçu">`).join('')}</div>`
    : `<div class="no-thumb">Sans aperçu</div>`;
  const details: string[] = Array.isArray(coin.details) ? coin.details : [];
  const search = esc([c.nom, c.email, coin.name].join(' ').toLowerCase());
  const st = quoteStatus(q);
  const isPaid = st.key === 'paid';
  const isGroup = !!group;
  return `<div class="card" data-search="${search}" data-qstatus="${st.key}" data-group="${isGroup}" id="quote-${esc(q.id)}">
    <div class="head" onclick="toggleCard(this)">
      <div class="avatar">${esc(initials(c.nom))}</div>
      <div>
        <div class="id">${esc(group ? group.productLabel || 'Commande de groupe' : coin.name || 'Devis')}
          ${group ? '<span class="badge-group">Groupe</span>' : ''}
          ${q.seen ? '' : '<span class="badge-new">nouveau</span>'}
          <svg class="caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>
        <div class="sub">${esc(c.nom || 'Client')}${c.email ? ' · ' + esc(c.email) : ''} · ${
          group
            ? `${group.pieces || 0} pièce(s) · ${groupRows.length} ligne(s)`
            : 'Qté ' + esc(coin.qty || '')
        }</div>
      </div>
      <div class="right">
        ${st.pill}
        ${q.totalPrice ? `<div class="amount mono">${money(q.totalPrice)}</div>` : ''}
        <div class="when mono">${fdate(q.createdAt)} · ${ftime(q.createdAt)}</div>
        ${
          isPaid && q.paidOrderId
            ? `<div class="when mono">Commande #${esc(q.paidOrderId)}</div>`
            : q.draftOrderId
              ? `<div class="when mono">Brouillon #${esc(q.draftOrderId)}</div>`
              : ''
        }
      </div>
    </div>
    <div class="body">
      ${(c.telephone || c.entreprise || c.message) ? `<div class="section-lbl lbl">Contact</div>
      <div class="client">
        ${c.telephone ? `<div class="kv"><span class="k">Téléphone</span><a href="tel:${esc(c.telephone)}">${esc(c.telephone)}</a></div>` : ''}
        ${c.entreprise ? `<div class="kv"><span class="k">Société</span>${esc(c.entreprise)}</div>` : ''}
        ${c.message ? `<div class="kv" style="grid-column:1/-1"><span class="k">Message</span>${esc(c.message)}</div>` : ''}
          ${
            /* Fichier joint par le client (logo, visuel de reference).
               Deux rendus selon le type, car cette route accepte aussi le PDF :
                 - image        -> vignette cliquable, avec le zoom deja en place
                                   (classe js-zoom + data-zoom, comme `thumbs`)
                 - PDF ou autre -> lien d ouverture, une vignette serait vide.
               isImg() filtre l URL, esc() echappe : memes garde-fous que
               partout ailleurs dans cette vue. */
            c.fichierUrl
              ? (isImg(c.fichierUrl)
                  ? `<div class="kv" style="grid-column:1/-1"><span class="k">Fichier joint</span><img class="thumb js-zoom" src="${esc(c.fichierUrl)}" data-zoom="${esc(c.fichierUrl)}" alt="fichier joint" style="max-width:120px;max-height:120px;cursor:zoom-in;vertical-align:middle"><a href="${esc(c.fichierUrl)}" target="_blank" rel="noopener" style="margin-left:10px">${esc(c.fichierNom || 'Telecharger')}</a></div>`
                  : `<div class="kv" style="grid-column:1/-1"><span class="k">Fichier joint</span><a href="${esc(c.fichierUrl)}" target="_blank" rel="noopener">📎 ${esc(c.fichierNom || 'Ouvrir le fichier')}</a></div>`)
              : ''
          }
      </div>` : ''}
      <div class="section-lbl lbl">${group ? 'Design commun' : 'Détail du produit'}</div>
      <div class="item">
        ${thumbs}
        <div class="item-body">
          <div class="specs">${details.map((x) => `<span class="spec">${esc(x)}</span>`).join('') || '<span class="empty">—</span>'}</div>
        </div>
      </div>
      ${
        group && groupRows.length
          ? `<div class="section-lbl lbl">Liste détaillée (${group.hasFlock ? 'flocage à chiffrer' : 'sans flocage'})</div>
      <div class="grp-list-wrap">
        <table class="grp-list">
          <thead><tr><th>Nom / réf.</th><th>Taille</th><th>Couleur</th><th>Floquage</th><th class="num">Qté</th></tr></thead>
          <tbody>
            ${groupRows
              .map(
                (r) => `<tr>
                  <td>${esc(r.name || '—')}</td>
                  <td>${esc(r.size || '')}</td>
                  <td>${colorCell(r.color || '')}</td>
                  <td>${r.flock ? esc(r.flock) : '<span class="empty">—</span>'}</td>
                  <td class="num">${esc(r.qty || 1)}</td>
                </tr>`,
              )
              .join('')}
          </tbody>
          <tfoot><tr><td colspan="4">Total</td><td class="num">${group.pieces || 0}</td></tr></tfoot>
        </table>
      </div>`
          : ''
      }
      <div class="quote-actions">
        ${
          group
            ? `<a class="btn" href="/api/admin/quotes/${esc(q.id)}/sheet" target="_blank" rel="noopener">🖨 Fiche production</a>`
            : ''
        }
        ${
          !q.draftOrderId
            ? `<span class="hint">Aucun brouillon Shopify associé : facture indisponible.</span>`
            : isPaid
              ? `<span class="hint ok">✓ Devis réglé par le client${q.totalPrice ? ` — ${money(q.totalPrice)}` : ''}.</span>`
              : `<button class="btn primary js-invoice"
                     data-qid="${esc(q.id)}"
                     data-email="${esc(c.email || '')}"
                     data-nom="${esc(c.nom || '')}"
                     data-produit="${esc(group ? group.productLabel || 'Commande de groupe' : coin.name || '')}"
                     data-qty="${group ? Number(group.pieces) || groupRows.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0) : Number(coin.qty) || 1}"
                     data-flock="${group ? groupRows.filter((r: any) => r.flock).reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0) : 0}">
                   ✉ ${st.key === 'sent' ? 'Corriger le prix et renvoyer' : 'Chiffrer et envoyer la facture'}
                 </button>
                 ${
                   st.key === 'sent'
                     ? `<button class="btn" onclick="remindQuote('${esc(q.id)}',this)">🔔 Relancer le client</button>`
                     : ''
                 }
                 <span class="hint">${
                   st.key === 'sent'
                     ? `Facture envoyée${daysSince(q.invoiceSentAt || q.createdAt) ? ` il y a ${daysSince(q.invoiceSentAt || q.createdAt)} j` : ''} — en attente de paiement.` +
                       (q.remindersSent
                         ? ` ${q.remindersSent} relance(s) automatique(s) envoyée(s).`
                         : '')
                     : 'Vous fixez le prix et envoyez la facture au client, sans quitter cette page.'
                 }</span>`
        }
      </div>
    </div>
  </div>`;
}

function designCard(d: Design, frontendUrl: string): string {
  const url = `${frontendUrl}/pages/configurateur?design=${d.id}`;
  const search = esc([d.productType, d.id].join(' ').toLowerCase());
  return `<div class="card" data-search="${search}">
    <div class="head" style="cursor:default">
      <div class="avatar">✎</div>
      <div>
        <div class="id">${esc(d.productType || 'Design')}</div>
        <div class="sub mono">${esc(d.id)}</div>
      </div>
      <div class="right">
        <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir ↗</a>
        <div class="when mono">${fdate(d.createdAt)} · ${ftime(d.createdAt)}</div>
      </div>
    </div>
  </div>`;
}

/* ════════════ FICHE DE PRODUCTION (imprimable A4) ════════════ */
export function productionSheetPage(o: Order, nonce = ''): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const info: any = o.customerInfo || {};
  const s = info.shipping || info.billing || {};
  const addr = [s.address1, s.address2, [s.zip, s.city].filter(Boolean).join(' '), s.country]
    .filter(Boolean)
    .map(esc)
    .join(', ');

  /* Commande groupée : une seule ligne par design, comme dans le dashboard.
     Le détail par taille est donné par le tableau ci-dessous — répéter le même
     sweatshirt une fois par taille allongeait la fiche sans rien apporter à
     l'atelier. */
  const sheetItems = collapseSizeGroup(items);

  const itemsHtml = sheetItems
    .map((li: any, idx: number) => {
      const props: Array<{ name: string; value: string }> = Array.isArray(li.properties) ? li.properties : [];
      const imgs = props.filter((p) => isImg(p.value));
      /* Les _Texte* sont sorties du lot : mêlées aux spécifications, elles
         noyaient couleur et taille sous vingt lignes techniques, préfixe « _ »
         apparent. Elles ont leur bloc, juste en dessous. */
      const estTypo = (p: { name: string }) =>
        /^_Texte[A-Z]/.test(String(p.name || ''));
      const texts = props.filter((p) => !isUrl(p.value) && !estTypo(p));
      const typo = props.filter((p) => !isUrl(p.value) && estTypo(p));

      return `<section class="ps-item">
        <div class="ps-item-head">
          <span class="ps-num">${idx + 1}</span>
          <h2>${esc(li.title)}${li.variantTitle ? ` · ${esc(li.variantTitle)}` : ''}</h2>
          <span class="ps-qty">× ${esc(li.quantity)}</span>
        </div>
        <div class="ps-specs">
          ${texts.map((p) => `<div><b>${esc(p.name)}</b><span>${esc(p.value)}</span></div>`).join('') || '<div><span>Aucune spécification.</span></div>'}
        </div>
        ${typo.length ? blocTypoFiche(typo) : ''}
        <div class="ps-visuals">
          ${
            imgs.length
              ? imgs
                  .map(
                    (p) => `<figure><img src="${esc(p.value)}" alt="${esc(p.name)}"><figcaption>${esc(p.name.replace(/^_/, ''))}</figcaption></figure>`,
                  )
                  .join('')
              : '<p class="ps-none">Aucun visuel fourni.</p>'
          }
        </div>
      </section>`;
    })
    .join('');

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiche de production ${esc(o.orderNumber || o.shopifyOrderId)}</title>
<style${nonce ? ` nonce="${nonce}"` : ''}>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;color:#1b1f24;background:#eceae6;padding:24px}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
  .sheet{max-width:820px;margin:0 auto;background:#fff;padding:34px 38px;box-shadow:0 8px 30px rgba(0,0,0,.1)}
  .toolbar{max-width:820px;margin:0 auto 14px;display:flex;gap:10px;justify-content:flex-end}
  .toolbar button,.toolbar a{padding:9px 16px;border:1px solid #d6d2cb;background:#fff;color:#1b1f24;
    border-radius:9px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
  .toolbar button{background:#c2410c;border-color:#c2410c;color:#fff}
  header.ps-head{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid #1b1f24;padding-bottom:14px;margin-bottom:20px}
  .ps-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8b8478}
  .ps-order{font-size:26px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
  .ps-meta{text-align:right;font-size:12px;color:#6b665e;line-height:1.7}
  .ps-block{margin-bottom:20px}
  .ps-lbl{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#8b8478;margin-bottom:7px}
  .ps-client{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;font-size:13px;
    background:#f6f4f0;border-radius:9px;padding:13px 16px}
  .ps-client b{display:block;font-size:9.5px;font-weight:800;letter-spacing:.07em;
    text-transform:uppercase;color:#a29a8e;margin-bottom:1px}
  .ps-client .wide{grid-column:1/-1}
  .ps-note{background:#fdf6ec;border-left:3px solid #c2410c;padding:11px 14px;font-size:13px;border-radius:0 8px 8px 0}
  .ps-item{border:1px solid #e4e0d9;border-radius:11px;padding:16px 18px;margin-bottom:14px;page-break-inside:avoid}
  .ps-item-head{display:flex;align-items:center;gap:10px;margin-bottom:12px}
  .ps-num{width:24px;height:24px;border-radius:6px;background:#1b1f24;color:#fff;
    display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;flex-shrink:0}
  .ps-item-head h2{font-size:16px;font-weight:800;flex:1}
  .ps-qty{font-size:15px;font-weight:800;font-family:ui-monospace,monospace}
  .ps-specs{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:14px}
  .ps-specs>div{background:#f6f4f0;border-radius:7px;padding:5px 11px;font-size:12.5px}
  .ps-specs b{color:#8b8478;font-weight:700;margin-right:5px}
  /* Texte à flocker : encadré pour se distinguer des spécifications, avec un
     filet à gauche. À l'impression, l'atelier doit le repérer d'un coup d'oeil. */
  .ps-typo{border-left:3px solid #c2410c;background:#fdf8f5;border-radius:0 8px 8px 0;
    padding:10px 13px;margin-bottom:14px}
  .ps-typo-lbl{font-size:10px;font-weight:700;text-transform:uppercase;
    letter-spacing:.5px;color:#c2410c;margin-bottom:7px}
  .ps-typo-grid{display:flex;flex-wrap:wrap;gap:6px 14px}
  .ps-typo-grid>div{font-size:12.5px}
  .ps-typo-grid b{color:#8b8478;font-weight:700;margin-right:5px}
  .ps-typo-grid span{display:inline-flex;align-items:center;gap:5px}
  .ps-typo-dot{width:11px;height:11px;border-radius:50%;border:1px solid rgba(0,0,0,.2)}
  .ps-visuals{display:flex;gap:14px;flex-wrap:wrap}
  .ps-visuals figure{width:190px}
  .ps-visuals img{width:100%;height:190px;object-fit:contain;border:1px solid #e4e0d9;
    border-radius:8px;background:#faf9f7}
  .ps-visuals figcaption{font-size:10.5px;color:#8b8478;text-align:center;margin-top:5px;font-weight:600}
  .ps-none{font-size:12.5px;color:#a29a8e}
  /* Tableau couleur × taille. Bordures franches : la fiche est imprimée, un
     simple fond gris ne ressort pas toujours au noir et blanc. */
  .ps-grid{width:100%;border-collapse:collapse;font-size:12.5px}
  .ps-grid th,.ps-grid td{border:1px solid #ddd8d0;padding:7px 9px;text-align:left}
  .ps-grid thead th{background:#f6f4f0;font-size:10.5px;font-weight:800;
    letter-spacing:.05em;text-transform:uppercase;color:#6b665e}
  .ps-grid tbody th{font-weight:700}
  .ps-grid .num{text-align:center;font-family:ui-monospace,Menlo,Consolas,monospace;
    font-variant-numeric:tabular-nums}
  .ps-grid .zero{color:#c8c2b8}
  .ps-grid .tot{font-weight:800;background:#faf9f7}
  .ps-grid tfoot th,.ps-grid tfoot td{background:#f6f4f0;font-weight:800}
  footer.ps-foot{margin-top:22px;padding-top:12px;border-top:1px solid #e4e0d9;
    font-size:11px;color:#a29a8e;display:flex;justify-content:space-between}
  @media print{
    body{background:#fff;padding:0}
    .toolbar{display:none}
    /* Le tableau ne doit pas se couper entre deux pages. */
    .ps-grid{page-break-inside:avoid}
    .sheet{box-shadow:none;max-width:none;padding:0}
    .ps-visuals img{height:150px}
  }
</style></head><body>
  <div class="toolbar">
    <a href="/api/admin">← Retour</a>
    <a href="/api/admin/orders/${esc(o.shopifyOrderId)}/assets.zip">↓ Fichiers (ZIP)</a>
    <button onclick="window.print()">Imprimer</button>
  </div>

  <div class="sheet">
    <header class="ps-head">
      <div>
        <div class="ps-title">Fiche de production</div>
        <div class="ps-order mono">${esc(o.orderNumber || '#' + o.shopifyOrderId)}</div>
      </div>
      <div class="ps-meta">
        <div>Commandé le ${fdate(o.shopifyCreatedAt)}</div>
        <div class="mono">${money(o.totalPrice)}</div>
        <div>${items.reduce((n: number, li: any) => n + (li.quantity || 0), 0)} article(s)</div>
      </div>
    </header>

    <div class="ps-block">
      <div class="ps-lbl">Client &amp; livraison</div>
      <div class="ps-client">
        <div><b>Nom</b>${esc(o.customerName || '—')}</div>
        <div><b>Email</b>${esc(o.customerEmail || '—')}</div>
        <div><b>Téléphone</b>${esc(o.customerPhone || info.phone || '—')}</div>
        ${addr ? `<div class="wide"><b>Adresse</b>${addr}</div>` : ''}
      </div>
    </div>

    ${
      o.internalNote
        ? `<div class="ps-block"><div class="ps-lbl">Note interne</div>
           <div class="ps-note">${esc(o.internalNote)}</div></div>`
        : ''
    }

    <!-- Répartition par taille : placée AVANT les articles, c'est ce que
         l'atelier lit en premier pour préparer les pièces. -->
    ${sheetSizeTable(items)}

    <div class="ps-block">
      <div class="ps-lbl">À produire</div>
      ${itemsHtml || '<p class="ps-none">Aucun article.</p>'}
    </div>

    <footer class="ps-foot">
      <span>Custom Textile — fiche de production</span>
      <span class="mono">${esc(o.orderNumber || o.shopifyOrderId)}</span>
    </footer>
  </div>
</body></html>`;
}

/**
 * Fiche de production d'une COMMANDE DE GROUPE (devis textile).
 * Design commun en grand + récap taille/couleur + liste des flocages + liste
 * détaillée. Même charte que la fiche commande, imprimable A4.
 */
export function groupSheetPage(q: Quote, nonce = ''): string {
  const d: any = q.quoteData || {};
  const c = d.customer || {};
  const group: any = d.group || {};
  const rows: any[] = Array.isArray(group.rows) ? group.rows : [];
  const coin: any = d.coin || {};
  const previews: any[] = Array.isArray(coin.previews) ? coin.previews : [];
  const designImgs = previews.flatMap((p) => [p.base, p.logo].filter(isImg));

  const ref = String(q.id).slice(0, 8).toUpperCase();
  const created = fdate(q.createdAt) + ' · ' + ftime(q.createdAt);

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fiche groupe ${esc(ref)}</title>
<style${nonce ? ` nonce="${nonce}"` : ''}>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:ui-sans-serif,system-ui,'Segoe UI',Roboto,sans-serif;color:#1b1f24;background:#eceae6;padding:24px}
  .mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
  .sheet{max-width:820px;margin:0 auto;background:#fff;padding:34px 38px;box-shadow:0 8px 30px rgba(0,0,0,.1)}
  .toolbar{max-width:820px;margin:0 auto 14px;display:flex;gap:10px;justify-content:flex-end}
  .toolbar button,.toolbar a{padding:9px 16px;border:1px solid #d6d2cb;background:#fff;color:#1b1f24;
    border-radius:9px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none}
  .toolbar button{background:#c2410c;border-color:#c2410c;color:#fff}
  header.ps-head{display:flex;justify-content:space-between;align-items:flex-start;
    border-bottom:2px solid #1b1f24;padding-bottom:14px;margin-bottom:20px}
  .ps-title{font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#8b8478}
  .ps-order{font-size:24px;font-weight:800;letter-spacing:-.02em;margin-top:2px}
  .ps-badge{display:inline-block;margin-left:8px;background:#e7f0e9;color:#3f7d4e;
    border-radius:20px;padding:2px 10px;font-size:11px;font-weight:800;vertical-align:middle}
  .ps-meta{text-align:right;font-size:12px;color:#6b665e;line-height:1.7}
  .ps-block{margin-bottom:20px}
  .ps-lbl{font-size:10px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:#8b8478;margin-bottom:7px}
  .ps-client{display:grid;grid-template-columns:repeat(3,1fr);gap:6px 18px;font-size:13px;
    background:#f6f4f0;border-radius:9px;padding:13px 16px}
  .ps-client b{display:block;font-size:9.5px;font-weight:800;letter-spacing:.07em;
    text-transform:uppercase;color:#a29a8e;margin-bottom:1px}
  .ps-visuals{display:flex;gap:14px;flex-wrap:wrap}
  .ps-visuals figure{width:200px}
  .ps-visuals img{width:100%;height:200px;object-fit:contain;border:1px solid #e4e0d9;border-radius:8px;background:#faf9f7}
  .ps-visuals figcaption{font-size:10.5px;color:#8b8478;text-align:center;margin-top:5px;font-weight:600}
  .ps-none{font-size:12.5px;color:#a29a8e}
  /* Tableaux */
  table{width:100%;border-collapse:collapse;font-size:13px}
  .agg th,.agg td{border:1px solid #e4e0d9;padding:8px 10px;text-align:center}
  .agg th{background:#f6f4f0;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#8b8478}
  .agg td:first-child,.agg th:first-child{text-align:left;font-weight:700}
  .agg tfoot td{background:#f6f4f0;font-weight:800}
  .agg .tot{font-weight:800}
  .lst th,.lst td{border-bottom:1px solid #eee;padding:7px 10px;text-align:left;font-size:12.5px}
  .lst th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#8b8478;border-bottom:1px solid #e4e0d9}
  .lst .num{text-align:right}
  .flk{display:flex;flex-wrap:wrap;gap:7px}
  .flk span{background:#f6f4f0;border:1px solid #e4e0d9;border-radius:7px;padding:5px 10px;font-size:12.5px}
  .flk em{color:#a29a8e;font-style:normal;font-size:11px}
  /* Pastille de couleur. Le récap croisé centre ses cellules : la pastille
     s'aligne à gauche avec le nom, comme dans la liste détaillée. */
  .color-cell{display:inline-flex;align-items:center;gap:7px;white-space:nowrap}
  .color-dot{
    width:12px;height:12px;border-radius:50%;flex:0 0 12px;
    border:1px solid rgba(0,0,0,.25);
    /* print-color-adjust : sans cela le navigateur retire les aplats à
       l'impression et l'atelier reçoit des pastilles blanches. */
    -webkit-print-color-adjust:exact;print-color-adjust:exact
  }
  footer.ps-foot{margin-top:22px;padding-top:12px;border-top:1px solid #e4e0d9;
    font-size:11px;color:#a29a8e;display:flex;justify-content:space-between}
  @media print{ body{background:#fff;padding:0} .toolbar{display:none}
    .sheet{box-shadow:none;max-width:none;padding:0} .ps-visuals img{height:160px} }
</style></head><body>
  <div class="toolbar">
    <a href="/api/admin">← Retour</a>
    <button onclick="window.print()">Imprimer</button>
  </div>

  <div class="sheet">
    <header class="ps-head">
      <div>
        <div class="ps-title">Fiche de production — groupe</div>
        <div class="ps-order mono">${esc(group.productLabel || 'Textile')}<span class="ps-badge">${group.pieces || rows.reduce((s, r) => s + (Number(r.qty) || 0), 0)} pièces</span></div>
      </div>
      <div class="ps-meta">
        Réf. ${esc(ref)}<br>${esc(created)}
      </div>
    </header>

    <div class="ps-block">
      <div class="ps-lbl">Client</div>
      <div class="ps-client">
        <div><b>Nom</b>${esc(c.nom || '—')}</div>
        <div><b>E-mail</b>${esc(c.email || '—')}</div>
        <div><b>Téléphone</b>${esc(c.telephone || '—')}</div>
        ${c.entreprise ? `<div><b>Société</b>${esc(c.entreprise)}</div>` : ''}
        ${c.message ? `<div class="wide" style="grid-column:1/-1"><b>Message</b>${esc(c.message)}</div>` : ''}
      </div>
    </div>

    <div class="ps-block">
      <div class="ps-lbl">Design commun</div>
      <div class="ps-visuals">
        ${
          designImgs.length
            ? designImgs
                .map((u) => `<figure><img src="${esc(u)}" alt="design"><figcaption>Design</figcaption></figure>`)
                .join('')
            : '<p class="ps-none">Aucun visuel fourni.</p>'
        }
      </div>
    </div>

    <div class="ps-block">
      <div class="ps-lbl">Récap production — quantités par taille / couleur</div>
      ${groupSheetAggHtml(rows)}
    </div>

    ${
      rows.some((r) => r.flock)
        ? `<div class="ps-block">
             <div class="ps-lbl">Flocages à réaliser</div>
             <div class="flk">
               ${rows
                 .filter((r) => r.flock)
                 .map(
                   (r) =>
                     `<span>${r.name ? esc(r.name) + ' → ' : ''}<strong>${esc(r.flock)}</strong> <em>${esc(r.size)}/${esc(r.color)}</em></span>`,
                 )
                 .join('')}
             </div>
           </div>`
        : ''
    }

    <div class="ps-block">
      <div class="ps-lbl">Liste détaillée</div>
      <table class="lst">
        <thead><tr><th>#</th><th>Nom / réf.</th><th>Taille</th><th>Couleur</th><th>Floquage</th><th class="num">Qté</th></tr></thead>
        <tbody>
          ${rows
            .map(
              (r, i) =>
                `<tr><td>${i + 1}</td><td>${esc(r.name || '—')}</td><td>${esc(r.size || '')}</td><td>${colorCell(r.color || '')}</td><td>${r.flock ? esc(r.flock) : '—'}</td><td class="num">${esc(r.qty || 1)}</td></tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>

    <footer class="ps-foot">
      <span>Custom Textile — commande de groupe</span>
      <span class="mono">Réf. ${esc(ref)}</span>
    </footer>
  </div>
</body></html>`;
}

/** Tableau croisé couleur × taille pour la fiche (classe .agg). */
function groupSheetAggHtml(rows: any[]): string {
  const agg = groupAggregate(rows);
  if (!agg.matrix.length) return '<p class="ps-none">Aucune ligne.</p>';
  const head =
    `<tr><th>Couleur</th>${agg.sizes.map((s) => `<th>${esc(s)}</th>`).join('')}<th>Total</th></tr>`;
  const body = agg.matrix
    .map(
      (m) =>
        `<tr><td>${colorCell(m.color)}</td>${agg.sizes
          .map((s) => `<td>${m.counts[s] || '·'}</td>`)
          .join('')}<td class="tot">${m.total}</td></tr>`,
    )
    .join('');
  const foot =
    `<tr><td>Total</td>${agg.sizes.map((s) => `<td class="tot">${agg.colTotals[s] || 0}</td>`).join('')}<td class="tot">${agg.grandTotal}</td></tr>`;
  return `<table class="agg"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table>`;
}

/** Filtres actifs, tels que reçus en query string. */
export interface DashboardFilters {
  period: string;
  payment: string;
  production: string;
  sort: string;
}

/** Périodes proposées dans la barre de filtres. */
const PERIODS: Array<[string, string]> = [
  ['all', 'Toute la période'],
  ['7d', '7 derniers jours'],
  ['30d', '30 derniers jours'],
  ['month', 'Ce mois-ci'],
  ['quarter', 'Ce trimestre'],
  ['year', 'Cette année'],
];
const SORTS: Array<[string, string]> = [
  ['date_desc', 'Plus récentes'],
  ['date_asc', 'Plus anciennes'],
  ['amount_desc', 'Montant décroissant'],
  ['amount_asc', 'Montant croissant'],
];

/** <select> d'une barre de filtres. */
/**
 * Menu déroulant PERSONNALISÉ (div), pas un <select> natif.
 *
 * Le menu natif est dessiné par le système par-dessus la page : sa largeur et
 * son placement échappent totalement au CSS, et il débordait de l'écran sur
 * mobile. Ici tout est rendu dans la page, donc maîtrisé.
 *
 * @param name    clé de filtre (period, sort…) ; '' = filtre client (pas d'URL)
 * @param options [valeur, libellé]
 * @param current valeur sélectionnée
 * @param opts    onPick : fonction JS appelée à la sélection (filtres client)
 */
function selectFilter(
  name: string,
  options: Array<[string, string]>,
  current: string,
  opts: { id?: string; onPick?: string; label?: string } = {},
): string {
  const sel = options.find(([v]) => v === current) || options[0];
  const id = opts.id ? ` id="${opts.id}"` : '';
  const onPick = opts.onPick || 'applyFilters';
  const aria = opts.label ? ` aria-label="${esc(opts.label)}"` : '';

  const items = options
    .map(
      ([v, l]) =>
        `<button type="button" class="dd-item${v === current ? ' on' : ''}"
           role="option" aria-selected="${v === current}"
           data-value="${esc(v)}" onclick="ddPick(this)">${esc(l)}</button>`,
    )
    .join('');

  return `<div class="dd"${id} data-name="${esc(name)}" data-value="${esc(sel[0])}" data-onpick="${esc(onPick)}"${aria}>
    <button type="button" class="dd-btn" onclick="ddToggle(this)" aria-haspopup="listbox" aria-expanded="false">
      <span class="dd-txt">${esc(sel[1])}</span>
      <svg class="dd-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
    </button>
    <div class="dd-menu" role="listbox">${items}</div>
  </div>`;
}

export function dashboardPage(
  orders: Order[],
  quotes: Quote[],
  designs: Design[],
  frontendUrl: string,
  shopDomain = '',
  extra: {
    filters?: DashboardFilters;
    /** Admin connecté : seul l'owner voit la gestion des comptes. */
    me?: { id: string; email: string; role: 'owner' | 'admin' };
    /** TOUS les devis, payés compris.  n'en contient que les non-payés
        (ils deviennent des commandes) : il faut cette liste complète pour
        rattacher une commande à son devis d'origine. */
    allQuotes?: Quote[];
    /** Nonce CSP de la requête : autorise les blocs inline de CETTE réponse. */
    nonce?: string;
    /** Plafonds appliqués aux listes : sert à signaler une troncature. */
    limits?: { orders: number; quotes: number };
  } = {},
): string {
  const nonce = extra.nonce || '';
  const me = extra.me;
  const isOwner = me?.role === 'owner';

  /* Liste servie « pleine à ras bord » = très probablement tronquée. Le CSV
     avertissait déjà de ce plafond, mais le dashboard, lui, se taisait : au-delà
     de 300 commandes, les suivantes n'existaient tout simplement plus pour
     l'opérateur, et le pagineur affichait un total rassurant mais faux. */
  const truncated: string[] = [];
  if (extra.limits) {
    if (orders.length >= extra.limits.orders) {
      truncated.push(`les ${extra.limits.orders} commandes les plus récentes`);
    }
    if (quotes.length >= extra.limits.quotes) {
      truncated.push(`les ${extra.limits.quotes} devis les plus récents`);
    }
  }
  const f: DashboardFilters = extra.filters || {
    period: 'all',
    payment: 'all',
    production: 'all',
    sort: 'date_desc',
  };
  const filtered =
    f.period !== 'all' || f.payment !== 'all' || f.production !== 'all';

  // Notifications : éléments jamais ouverts par l'équipe.
  const newOrders = orders.filter((o) => !o.seen);
  const newQuotes = quotes.filter((q) => !q.seen);
  const nbNew = newOrders.length + newQuotes.length;
  const seenPayload = JSON.stringify({
    orders: newOrders.map((o) => String(o.shopifyOrderId)),
    quotes: newQuotes.map((q) => q.id),
  });

  // Contenu du panneau de notifications : les plus récentes d'abord.
  type Notif = { at: Date | null; html: string };
  const notifs: Notif[] = [
    ...newOrders.map((o) => ({
      at: o.shopifyCreatedAt,
      html: `<a class="notif" onclick="gotoCard('orders','card-${esc(o.shopifyOrderId)}')">
        <span class="notif-ico order">📦</span>
        <span class="notif-txt">
          <b>Nouvelle commande ${esc(o.orderNumber || '#' + o.shopifyOrderId)}</b>
          <small>${esc(o.customerName || 'Client')} · ${money(o.totalPrice)}</small>
        </span>
        <span class="notif-when mono">${fdate(o.shopifyCreatedAt)}</span>
      </a>`,
    })),
    ...newQuotes.map((q) => {
      const d: any = q.quoteData || {};
      const c = d.customer || {};
      const coin = d.coin || {};
      return {
        at: q.createdAt,
        html: `<a class="notif" onclick="gotoCard('quotes','quote-${esc(q.id)}')">
          <span class="notif-ico quote">✉️</span>
          <span class="notif-txt">
            <b>Nouvelle demande de devis</b>
            <small>${esc(c.nom || 'Client')} · ${esc(coin.name || 'Devis')}${coin.qty ? ` · Qté ${esc(coin.qty)}` : ''}</small>
          </span>
          <span class="notif-when mono">${fdate(q.createdAt)}</span>
        </a>`,
      };
    }),
  ].sort((a, b) => new Date(b.at || 0).getTime() - new Date(a.at || 0).getTime());

  const notifList = notifs.length
    ? notifs.map((n) => n.html).join('')
    : `<div class="notif-empty">
         <div class="ico">✓</div>
         <p>Rien de nouveau.</p>
         <small>Les commandes et devis arrivés depuis votre dernière visite s'afficheront ici.</small>
       </div>`;

  /* Index devis payé -> commande. La liste des personnes d'une commande de
     groupe vit dans le devis (quoteData.group) : cet index permet de l'afficher
     directement sur la carte commande, sans requête ni recherche à la main.
     NB : les devis payés sont exclus de la liste servie au dashboard
     (getQuotes includePaid=false), on interroge donc allQuotes. */
  const quoteByPaidOrder = new Map<string, Quote>();
  (extra.allQuotes || quotes).forEach((q) => {
    if (q.paidOrderId) quoteByPaidOrder.set(String(q.paidOrderId), q);
  });

  const revenue = orders.reduce((s, o) => s + (parseFloat(String(o.totalPrice || '')) || 0), 0);
  const isGroupQuote = (q: Quote): boolean => {
    const d: any = q.quoteData || {};
    return d.group !== null && d.group !== undefined;
  };
  // Les devis payés sont exclus en amont (AdminService.getQuotes, includePaid
  // = false) : devenus des commandes, ils vivent désormais dans l'onglet
  // Commandes. Tout ce qui arrive ici est donc « à traiter ».
  const nbOpen = quotes.length;
  // Commandes de groupe : comptage séparé pour affichage distinct.
  const nbGroup = quotes.filter(isGroupQuote).length;
  // Commandes : comptage par étape de production (pour les filtres).
  const prodCounts: Record<string, number> = {};
  orders.forEach((o) => {
    const k = o.productionStatus || 'to_produce';
    prodCounts[k] = (prodCounts[k] || 0) + 1;
  });
  // Commandes de groupe (flux panier) : au moins une ligne porte « Liste ».
  const orderIsGroup = (o: Order): boolean => {
    const items = Array.isArray(o.lineItems) ? o.lineItems : [];
    return items.some((li: any) => {
      const props = Array.isArray(li?.properties) ? li.properties : [];
      return props.some((p: any) => String(p.name).toLowerCase() === 'liste' && p.value);
    });
  };
  const nbOrderGroup = orders.filter(orderIsGroup).length;
  // Commandes encore à fabriquer (indicateur du bandeau de stats).
  const nbToMake = orders.filter(
    (o) => (o.productionStatus || 'to_produce') !== 'shipped',
  ).length;
  const emptyOrders = `<div class="empty-state"><div class="ico">📦</div><p>Aucune commande pour l'instant.</p><small>Les commandes payées s'afficheront ici automatiquement.</small></div>`;
  const emptyQuotes = `<div class="empty-state"><div class="ico">✉️</div><p>Aucune demande de devis.</p></div>`;
  const emptyDesigns = `<div class="empty-state"><div class="ico">🎨</div><p>Aucun design sauvegardé.</p></div>`;

  return shell(`
  <div class="topbar">
    <div class="brand">
      <!-- Même vêtement que sur l'écran de connexion et dans le configurateur :
           une seule marque pour tout l'atelier. -->
      <div class="brand-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3 4 5.5 5.5 10 7 9.5V21h10V9.5L18.5 10 20 5.5 15 3"/>
          <path d="M9 3a3 3 0 0 0 6 0"/>
        </svg>
      </div>
      <div class="brand-txt"><b>Administration</b><span>Configurateur Massacre</span></div>
    </div>
    <div class="topbar-actions">
      <div class="bell-wrap">
        <button class="theme-btn" id="bell-btn" onclick="toggleNotifs(event)" title="Nouveautés depuis votre dernière visite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
          <span class="bell-dot" id="bell-dot"${nbNew ? '' : ' style="display:none"'}>${nbNew || ''}</span>
        </button>
        <div class="notif-pop" id="notif-pop">
          <div class="notif-head">
            <b>Notifications</b>
            ${nbNew ? `<button class="notif-clear" onclick="markSeen()">Tout marquer comme lu</button>` : ''}
          </div>
          <div class="notif-list" id="notif-list">${notifList}</div>
        </div>
      </div>
      <!-- Réglages regroupés : Prix, Paramètres, Admins, Mon compte et Thème
           vivaient côte à côte dans la barre. Cinq boutons pour des actions
           occasionnelles, quand seules la cloche et la sortie servent au
           quotidien. Ils passent sous un seul déclencheur. -->
      <div class="menu-wrap">
        <button class="theme-btn" id="cog-btn" onclick="toggleCog(event)"
                aria-haspopup="true" aria-expanded="false" aria-controls="cog-menu"
                title="Prix, réglages, compte et thème">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
          Paramètres
          <svg class="menu-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="cog-menu" id="cog-menu" role="menu" aria-labelledby="cog-btn">
          <button class="cog-item" role="menuitem" onclick="fromCog(openPricing)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 7a6 6 0 1 0 0 10"/><path d="M6 10h8"/><path d="M6 14h8"/>
            </svg>
            <span><b>Prix</b><small>Tarifs du configurateur</small></span>
          </button>
          <button class="cog-item" role="menuitem" onclick="fromCog(openSettings)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <span><b>Réglages de l'atelier</b><small>Délais, maintenance, options</small></span>
          </button>
          <button class="cog-item" role="menuitem" onclick="fromCog(openMessages)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span><b>Messages</b><small>Personnaliser les e-mails de facturation</small></span>
          </button>
          ${
            isOwner
              ? `<button class="cog-item" role="menuitem" onclick="fromCog(openAdmins)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
            <span><b>Admins</b><small>Gérer les accès</small></span>
          </button>`
              : ''
          }
          <div class="cog-sep"></div>
          <button class="cog-item" role="menuitem" onclick="fromCog(openAccount)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            <span><b>Mon compte</b><small>${esc(me?.email || 'Changer mon mot de passe')}</small></span>
          </button>
          <button class="cog-item" role="menuitem" onclick="fromCog(toggleTheme)">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
            <span><b>Thème</b><small>Basculer clair / sombre</small></span>
          </button>
        </div>
      </div>
      <a class="logout" href="/api/admin/logout" title="Se déconnecter">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        Déconnexion
      </a>
    </div>
  </div>

  <div class="wrap">
    <div class="stats">
      ${statCard(nbToMake, 'À fabriquer', ICO_MAKE, 'accent')}
      ${statCard(orders.length, 'Commandes reçues', ICO_BOX, 't-blue')}
      ${(() => {
        /* Abrégé pour tenir dans la carte, exact au survol. */
        const ca = moneyCompact(revenue);
        const bulle = ca.texte === ca.exact ? '' : ca.exact;
        return statCard(ca.texte, "Chiffre d'affaires estimé", ICO_EURO, 't-green', bulle);
      })()}
      ${statCard(nbOpen, 'Devis à traiter', ICO_QUOTE, 't-violet')}
    </div>

    ${
      truncated.length
        ? `<p class="trunc-note">Cette page affiche ${truncated.join(' et ')}.
           Utilisez les filtres de période, ou l'export CSV, pour atteindre les plus anciens.</p>`
        : ''
    }

    <div class="tabs">
      <!-- Les icônes reprennent celles des cartes de statistiques : le carton
           pour les commandes, le document chiffré pour les devis. Même objet,
           même signe, d'un bout à l'autre du dashboard. -->
      <button class="tab active" data-tab="orders">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>
        </svg>
        Commandes <span class="count mono${orders.length ? ' has-items' : ''}">${orders.length}</span>
      </button>
      <button class="tab" data-tab="quotes">
        <svg class="tab-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6"/><path d="M9 17h4"/>
        </svg>
        Devis <span class="count mono${quotes.length ? ' has-items' : ''}">${quotes.length}</span>
      </button>
      <!-- Onglet « Designs » masqué à la demande. Le panneau #p-designs et tout
           son code restent en place : seul le bouton d'accès est retiré, donc
           il suffit de rétablir cette ligne pour le faire revenir. -->
    </div>

    <div class="toolbar">
      <!-- Ce <form> ne sert qu a ISOLER le champ. Sans lui, le navigateur
           rattache tout champ libre au document entier : voyant les champs mot
           de passe de la modale « Mon compte », il classait la page en ecran de
           connexion et posait l identifiant memorise ici, premier champ texte
           du document.

           Les deux formulaires se referment l un sur l autre : celui de la
           modale retient l autocompletion, celui-ci la refuse.

           onsubmit="return false" : sans lui, Entree rechargerait la page. -->
      <form class="search" autocomplete="off" onsubmit="return false" role="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <!-- data-lpignore / data-1p-ignore visent LastPass et 1Password, qui
             ont leur propre heuristique et ignorent autocomplete. -->
        <input id="search" type="search" name="q"
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-form-type="other" data-lpignore="true" data-1p-ignore="true"
               aria-label="Rechercher une commande, un client, un produit"
               placeholder="Rechercher une commande, un client, un produit…" oninput="filterCards(true)">
      </form>

      <div class="filters" id="filters">
        ${selectFilter('sort', SORTS, f.sort)}
        ${filtered ? `<a class="chip-clear" href="/api/admin">✕ Réinitialiser</a>` : ''}
      </div>

      <div class="export-wrap">
        <button class="btn" onclick="toggleExport()">↓ Exporter</button>
        <div class="export-menu" id="export-menu">
          <a href="#" onclick="return exportCsv('orders')">Commandes (détaillé)</a>
          <a href="#" onclick="return exportCsv('quotes')">Devis</a>
          <a href="#" onclick="return exportCsv('accounting')">Comptabilité (payées)</a>
          <small>Respecte les filtres ci-contre.</small>
        </div>
      </div>
    </div>

    ${
      filtered
        ? `<div class="filter-note">
             Vue filtrée : <strong>${orders.length}</strong> commande(s) et
             <strong>${quotes.length}</strong> devis correspondent.
           </div>`
        : ''
    }

    <div class="panel active" id="p-orders">
      ${
        orders.length
          ? `<div class="subfilters" id="order-filters">
               <!-- Statut de production : filtre CLIENT (pas de rechargement),
                    d'où onPick=filterOrders au lieu du applyFilters par défaut. -->
               ${selectFilter(
                 '',
                 [
                   ['all', `Tous les statuts (${orders.length})`],
                   ...PROD_STEPS.map(
                     (s) =>
                       [s.key, `${s.label} (${prodCounts[s.key] || 0})`] as [
                         string,
                         string,
                       ],
                   ),
                   ['group', `🎯 Commandes de groupe (${nbOrderGroup})`] as [string, string],
                 ],
                 'all',
                 {
                   id: 'order-status',
                   onPick: 'filterOrders',
                   label: 'Filtrer par statut de production',
                 },
               )}
               <!-- Période : filtre serveur, aligné avec le statut. -->
               ${selectFilter('period', PERIODS, f.period, {
                 label: 'Filtrer par période',
               })}
             </div>
             ${orders.map((o) => orderCard(o, quoteByPaidOrder.get(String(o.shopifyOrderId)))).join('')}
             <div class="empty-state" id="orders-none" style="display:none">
               <div class="ico">✓</div><p>Aucune commande dans cette catégorie.</p>
             </div>`
          : emptyOrders
      }
    </div>
    <div class="panel" id="p-quotes">
      ${
        quotes.length
          ? `<div class="subfilters" id="quote-filters">
               <button class="chip-filter active" data-qf="open" onclick="filterQuotes(this)">
                 À traiter <span class="count mono">${nbOpen}</span>
               </button>
               <button class="chip-filter" data-qf="group" onclick="filterQuotes(this)">
                 🎯 Commandes de groupe <span class="count mono">${nbGroup}</span>
               </button>
               <button class="chip-filter" data-qf="all" onclick="filterQuotes(this)">
                 Tous <span class="count mono">${quotes.length}</span>
               </button>
             </div>
             ${quotes.map((q) => quoteCard(q, shopDomain)).join('')}
             <div class="empty-state" id="quotes-none" style="display:none">
               <div class="ico">✓</div><p>Aucun devis dans cette catégorie.</p>
             </div>`
          : emptyQuotes
      }
    </div>
    <div class="panel" id="p-designs">${designs.length ? designs.map((d) => designCard(d, frontendUrl)).join('') : emptyDesigns}</div>
  </div>

  <div class="lightbox" id="lb" onclick="this.classList.remove('open')"><img id="lb-img" src="" alt="Aperçu agrandi"></div>

  <!-- Modale : chiffrer le devis et envoyer la facture -->
  <div class="modal" id="inv-modal" onclick="if(event.target===this)closeInvoice()">
    <div class="modal-box">
      <h3>Chiffrer et envoyer la facture</h3>
      <p class="sub" id="inv-sub"></p>

      <div class="price-row">
        <div>
          <label class="lbl">Prix unitaire (€)</label>
          <input type="number" id="inv-price" min="0.01" step="0.01" placeholder="0,00"
                 oninput="updateInvoiceTotal()" class="price-input mono">
        </div>
        <div class="price-total">
          <span class="lbl">Total (<span id="inv-qty" class="mono">1</span> unités)</span>
          <strong id="inv-total" class="mono">—</strong>
        </div>
      </div>

      <!-- Chiffrage assisté pour les commandes de groupe avec flocage. -->
      <div id="inv-flock-block" style="display:none;margin-top:12px;background:var(--raise);border-radius:10px;padding:12px 14px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <div style="flex:1;min-width:150px">
            <label class="lbl">Prix par flocage (€)</label>
            <input type="number" id="inv-flock-price" min="0" step="0.01" placeholder="0,00"
                   oninput="updateInvoiceTotal()" class="price-input mono">
          </div>
          <div class="hint" id="inv-flock-info" style="align-self:flex-end;padding-bottom:10px"></div>
        </div>
        <p class="hint" id="inv-breakdown" style="margin-top:8px"></p>
        <p class="hint" style="margin-top:4px">
          ⚠️ Shopify facture un <strong>prix unitaire × quantité</strong>. Le total ci-dessus
          (base + flocages) est réparti en un prix unitaire moyen — vous pouvez l'ajuster.
        </p>
      </div>

      <label class="lbl" style="margin-top:16px">Message au client</label>
      <textarea id="inv-msg"></textarea>

      <!-- Section pièces jointes -->
      <div class="attach-section" style="margin-top:16px">
        <label class="lbl">Pièces jointes <span style="color:var(--muted);font-weight:400">(optionnel, max 5 fichiers)</span></label>
        
        <!-- Zone de drop pour upload -->
        <div id="inv-drop-zone" class="drop-zone" onclick="document.getElementById('inv-file-input').click()"
             ondrop="handleFileDrop(event)" ondragover="handleDragOver(event)" ondragleave="handleDragLeave(event)">
          <div class="drop-content">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" style="color:var(--muted);margin-bottom:8px">
              <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"/>
            </svg>
            <p style="margin:0 0 4px;font-size:13px;font-weight:600">Glisser-déposer ou cliquer</p>
            <p style="margin:0;font-size:11px;color:var(--muted)">PDF, DOC, XLS, images (max 10 MB par fichier)</p>
          </div>
          <input type="file" id="inv-file-input" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.jpg,.jpeg,.png,.webp,.gif" 
                 style="display:none" onchange="handleFileSelect(event)">
        </div>

        <!-- Liste des fichiers sélectionnés -->
        <div id="inv-files-list" class="files-list" style="display:none"></div>
        
        <!-- Status upload -->
        <p id="inv-upload-status" class="hint" style="margin-top:8px;display:none"></p>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeInvoice()">Annuler</button>
        <button class="btn primary" id="inv-send" onclick="sendInvoice()">Envoyer la facture</button>
      </div>
      <p class="hint" id="inv-status" style="margin-top:12px"></p>
    </div>
  </div>

  <!-- Modale de confirmation (succès / erreur), réutilisable -->
  <div class="alert-modal" id="alert-modal" onclick="if(event.target===this)closeAlert()">
    <div class="alert-box">
      <div class="alert-ico" id="alert-ico"></div>
      <h4 id="alert-title">Enregistré</h4>
      <!-- pre-line : le texte est pose via textContent (jamais innerHTML, pour
           ne pas exposer une injection depuis un message serveur), or un saut
           de ligne y serait sinon replie. Le compte a rebours de deconnexion
           apres changement de mot de passe occupe ainsi sa propre ligne. -->
      <p id="alert-text" style="white-space:pre-line"></p>
      <button class="btn primary" onclick="closeAlert()">OK</button>
    </div>
  </div>

  <!-- Modale : mon compte (changement de mot de passe) -->
  <div class="modal" id="acc-modal" onclick="if(event.target===this)closeAccount()">
    <div class="modal-box" style="max-width:420px">
      <h3>Mon compte</h3>
      <p class="sub">${esc(me?.email || '')}</p>

      <!-- Ce <form> ne soumet rien : les boutons appellent saveOwnPassword() en
           JS. Il delimite le CONTEXTE pour le navigateur.

           Sans lui, Chrome voyait un champ current-password hors formulaire,
           en deduisait un ecran de connexion, et cherchait dans TOUT le
           document ou poser l identifiant memorise. Il tombait sur le champ de
           recherche du tableau de bord, seul champ texte avant celui-ci.

           onsubmit="return false" est indispensable : sans lui, Entree dans un
           champ rechargerait la page. -->
      <form class="set-block" autocomplete="off" onsubmit="return false">
        <!-- Champ d identifiant, cache mais PRESENT. Contre-intuitif et
             pourtant necessaire : prive de cible, Chrome en invente une ;
             pourvu d une, il s y tient. C est la methode recommandee pour un
             formulaire de changement de mot de passe. -->
        <input type="text" name="username" autocomplete="username"
               value="${esc(me?.email || '')}" readonly tabindex="-1"
               aria-hidden="true" style="display:none">

        <label class="lbl" for="acc-cur">Mot de passe actuel</label>
        <input type="password" id="acc-cur" name="current-password" class="price-input"
               autocomplete="current-password" style="width:100%;text-align:left">

        <!-- minlength double le controle JS de saveOwnPassword() : le
             navigateur signale la saisie trop courte des la frappe, sans
             attendre le clic. Les deux restent necessaires : la soumission
             etant neutralisee, cet attribut ne bloque rien, et le JS seul ne
             previent qu apres coup. Le serveur revalide de toute facon
             (admin-auth.service.ts:475). -->
        <label class="lbl" style="margin-top:12px" for="acc-new">Nouveau mot de passe</label>
        <input type="password" id="acc-new" name="new-password" class="price-input"
               autocomplete="new-password" minlength="8" required
               style="width:100%;text-align:left">
        <p class="hint">8 caractères minimum.</p>

        <label class="lbl" style="margin-top:12px" for="acc-new2">Confirmer le nouveau mot de passe</label>
        <input type="password" id="acc-new2" name="confirm-password" class="price-input"
               autocomplete="new-password" minlength="8" required
               style="width:100%;text-align:left">
      </form>

      <div class="modal-actions">
        <button class="btn" onclick="closeAccount()">Annuler</button>
        <button class="btn primary" id="acc-save" onclick="saveOwnPassword()">Changer</button>
      </div>
    </div>
  </div>

  <!-- Modale : prix du configurateur -->
  <div class="modal" id="price-modal" onclick="if(event.target===this)closePricing()">
    <div class="modal-box" style="max-width:620px">
      <h3>Prix du configurateur</h3>
      <p class="sub">Prix unitaires HT et tarifs dégressifs par quantité.</p>

      <div class="set-block">
        <div id="price-list"><p class="hint">Chargement…</p></div>
        <p class="hint" style="margin-top:12px">
          Le prix d'un textile s'applique à <strong>toutes ses couleurs et
          tailles</strong> : un seul prix par article.
        </p>
        <p class="hint" style="margin-top:6px">
          <strong>Tarifs dégressifs</strong> : chaque palier indique la quantité
          minimale et le prix unitaire appliqué à partir de celle-ci. Le premier
          palier devrait commencer à 1 pour couvrir les petites commandes.
        </p>
        <p class="hint" style="margin-top:6px">
          À l'enregistrement, le prix de base est aussi mis à jour dans Shopify.
          Les remises par quantité restent à créer côté Shopify
          (« réductions automatiques ») pour être <em>facturées</em> : ici, elles
          pilotent l'affichage du configurateur. Les <strong>Coins</strong>
          passent par un devis chiffré à la main, leur prix n'est qu'indicatif.
        </p>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closePricing()">Annuler</button>
        <button class="btn primary" id="price-save" onclick="savePricing()">Enregistrer</button>
      </div>
      <p class="hint" id="price-status" style="margin-top:12px"></p>
    </div>
  </div>

  <!-- Modale : réglages de l'atelier -->
  <div class="modal" id="set-modal" onclick="if(event.target===this)closeSettings()">
    <div class="modal-box" style="max-width:520px">
      <h3>Paramètres</h3>
      <p class="sub">Réglages de l'atelier de personnalisation.</p>

      <div class="set-block">
        <label class="switch">
          <input type="checkbox" id="set-maintenance">
          <span>Mode maintenance du configurateur</span>
        </label>
        <p class="hint" style="margin-top:10px">
          Une fois activé, la page de personnalisation affiche un écran
          d'attente au lieu du configurateur. Le <strong>reste de la boutique
          continue de fonctionner</strong> : catalogue, panier, et les commandes
          déjà composées peuvent être réglées.
        </p>
        <p class="hint" style="margin-top:6px">
          Les clients déjà sur la page basculent d'eux-mêmes en moins d'une
          minute, sans avoir à recharger.
        </p>
        <p class="hint" style="margin-top:6px">
          Pour travailler sur le configurateur pendant la fermeture, ajoutez
          <strong>?apercu=1</strong> à l'adresse de la page.
        </p>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeSettings()">Annuler</button>
        <button class="btn primary" id="set-save" onclick="saveSettingsModal()">Enregistrer</button>
      </div>
      <p class="hint" id="set-status" style="margin-top:12px"></p>
    </div>
  </div>

  <!-- Modale : messages envoyés aux clients.
       UNE seule modale, là où trois s'empilaient (liste, édition, aperçu). Le
       texte s'édite sur place et l'aperçu vit sous le champ : plus de couches,
       plus d'allers-retours.

       Un seul modèle par type, parce que c'est tout ce que le système sait
       consommer — getDefaultTemplate() ne lit jamais que celui marqué par
       défaut. Créer, dupliquer ou désactiver d'autres modèles ne faisait
       qu'administrer des textes qui ne partiraient jamais. -->
  <div class="modal" id="msg-modal" onclick="if(event.target===this)closeMessages()">
    <div class="modal-box" style="width:min(94vw,640px)">
      <h3>Messages clients</h3>
      <p class="sub">Le texte envoyé avec vos devis et vos relances.</p>

      <!-- Pas de data-tab : cet attribut est réservé aux onglets de la barre
           principale, dont le gestionnaire global cherche un panneau associé. -->
      <div class="tabs" style="margin-top:4px">
        <button class="tab active" id="tab-invoice"
                onclick="switchMessageType('invoice')">Devis</button>
        <button class="tab" id="tab-reminder"
                onclick="switchMessageType('reminder')">Relance</button>
      </div>

      <div class="set-block">
        <label class="lbl" for="msg-content" id="msg-label">Message envoyé avec le devis</label>
        <textarea id="msg-content" class="msg-editor" spellcheck="true"
                  oninput="majApercu()"
                  placeholder="Bonjour {nom}, ..."></textarea>

        <!-- Jetons CLIQUABLES : un clic les insère au curseur. C'est le gain de
             temps réel — auparavant il fallait les recopier depuis une légende. -->
        <div class="msg-vars" id="msg-vars">
          <button type="button" class="msg-var" onclick="insertVar('{nom}')"
                  title="Nom du client">{nom}</button>
          <button type="button" class="msg-var" onclick="insertVar('{produit}')"
                  title="Nom du produit">{produit}</button>
          <button type="button" class="msg-var" onclick="insertVar('{quantite}')"
                  title="Quantité commandée">{quantite}</button>
          <button type="button" class="msg-var" onclick="insertVar('{total}')"
                  title="Montant total">{total}</button>
          <button type="button" class="msg-var" onclick="insertVar('{entreprise}')"
                  title="Entreprise du client">{entreprise}</button>
        </div>

        <!-- Aperçu sous le champ, mis à jour à la frappe : les valeurs
             d'exemple sont connues du navigateur, aucune requête n'est utile. -->
        <div class="msg-preview-lbl lbl">Aperçu</div>
        <div class="msg-preview" id="msg-preview"></div>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeMessages()">Fermer</button>
        <button class="btn primary" id="msg-save" onclick="saveMessage()">Enregistrer</button>
      </div>
      <p class="hint" id="msg-status" style="margin-top:12px"></p>
    </div>
  </div>

  ${
    isOwner
      ? `
  <!-- Modale : gestion des administrateurs (owner uniquement) -->
  <div class="modal" id="adm-modal" onclick="if(event.target===this)closeAdmins()">
    <div class="modal-box" style="max-width:560px">
      <h3>Administrateurs</h3>
      <p class="sub">Invitez votre équipe et gérez les accès au dashboard.</p>

      <div class="set-block">
        <label class="lbl">Inviter un administrateur</label>
        <div class="mail-row">
          <!-- autocomplete="off" : sans lui, le navigateur propose ici
               l adresse de l admin connecte, alors qu on invite un collegue. -->
          <input type="email" id="adm-email" class="price-input" autocomplete="off"
                 data-lpignore="true" data-1p-ignore="true"
                 placeholder="collegue@exemple.com">
          <button class="btn primary" id="adm-add" onclick="inviteAdmin()">Générer le mot de passe</button>
        </div>
        <p class="hint">
          Un mot de passe de 8 caractères est généré automatiquement. Il ne s'affiche
          qu'une seule fois : partagez-le aussitôt.
        </p>
        <p class="hint" id="adm-status"></p>

        <!-- Identifiants fraîchement générés + partage -->
        <div id="adm-cred" class="adm-cred-box" style="display:none">
          <div class="lbl" style="margin-bottom:8px">Identifiants à transmettre</div>
          <div class="mono" id="adm-cred-txt"></div>
          <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
            <button class="btn primary" onclick="shareCreds()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>
              Partager
            </button>
            <button class="btn" onclick="copyCreds()">Copier</button>
          </div>
          <p class="hint" id="adm-share-hint" style="margin-top:8px"></p>
        </div>
      </div>

      <div class="set-block">
        <label class="lbl">Comptes existants <span id="adm-count" class="opt"></span></label>
        <div id="adm-list" style="margin-top:10px">
          <p class="hint">Chargement…</p>
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeAdmins()">Fermer</button>
      </div>
    </div>
  </div>`
      : ''
  }

  <!-- Modale : expédier (répercuté dans Shopify, e-mail envoyé au client) -->
  <div class="modal" id="ship-modal" onclick="if(event.target===this)closeShip()">
    <div class="modal-box">
      <h3>Marquer comme expédiée</h3>
      <p class="sub">
        La commande sera marquée comme traitée dans Shopify, et
        <strong>le client recevra son e-mail d'expédition</strong>. Cette action
        n'est pas réversible depuis ce tableau de bord.
      </p>

      <label class="lbl" style="margin-top:16px">Numéro de suivi <span class="opt">(facultatif)</span></label>
      <input type="text" id="ship-num" class="price-input mono" placeholder="Ex. 6A123456789">

      <label class="lbl" style="margin-top:12px">Transporteur <span class="opt">(facultatif)</span></label>
      <input type="text" id="ship-carrier" class="price-input" placeholder="Ex. Colissimo, DHL, Chronopost">
      <p class="hint">S'ils sont renseignés, Shopify les inclut dans l'e-mail au client.</p>

      <div class="modal-actions">
        <button class="btn" onclick="closeShip()">Annuler</button>
        <button class="btn primary" id="ship-go" onclick="confirmShip()">Expédier et prévenir le client</button>
      </div>
      <p class="hint" id="ship-status" style="margin-top:12px"></p>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script${nonce ? ` nonce="${nonce}"` : ''}>
    var UNSEEN=${seenPayload};

    /* ═══════════ Menus déroulants personnalisés (.dd) ═══════════
       Remplacent les <select> natifs, dont le menu (dessiné par l'OS) débordait
       de l'écran sur mobile sans qu'aucun CSS ne puisse l'en empêcher. */

    function ddCloseAll(except){
      document.querySelectorAll('.dd.open').forEach(function(d){
        if(d===except) return;
        d.classList.remove('open');
        var b=d.querySelector('.dd-btn');
        if(b) b.setAttribute('aria-expanded','false');
      });
    }

    function ddToggle(btn){
      var dd=btn.closest('.dd');
      var willOpen=!dd.classList.contains('open');
      ddCloseAll(dd);
      dd.classList.toggle('open', willOpen);
      btn.setAttribute('aria-expanded', willOpen?'true':'false');
      if(!willOpen) return;

      /* Si le menu déborderait à droite, on l'aligne sur le bord droit du
         bouton. (Le CSS le borne déjà en largeur ; ceci gère le placement.) */
      dd.classList.remove('to-left');
      var m=dd.querySelector('.dd-menu');
      if(m && m.getBoundingClientRect().right > document.documentElement.clientWidth-4){
        dd.classList.add('to-left');
      }
      // Amène l'option courante dans le champ de vision.
      var on=m && m.querySelector('.dd-item.on');
      if(on) on.scrollIntoView({block:'nearest'});
    }

    /* Sélection d'une option : met à jour le libellé, puis déclenche l'action
       associée (rechargement serveur, ou filtre client). */
    function ddPick(item){
      var dd=item.closest('.dd');
      var val=item.getAttribute('data-value');
      dd.setAttribute('data-value', val);
      var txt=dd.querySelector('.dd-txt');
      if(txt) txt.textContent=item.textContent.trim();

      dd.querySelectorAll('.dd-item').forEach(function(i){
        var on=i===item;
        i.classList.toggle('on', on);
        i.setAttribute('aria-selected', on?'true':'false');
      });
      ddCloseAll();

      var fn=window[dd.getAttribute('data-onpick')||'applyFilters'];
      if(typeof fn==='function') fn(dd);
    }

    /* Clic à l'extérieur, ou Échap : on referme. */
    document.addEventListener('click', function(e){
      if(!e.target.closest('.dd')) ddCloseAll();
    });
    document.addEventListener('keydown', function(e){
      if(e.key==='Escape') ddCloseAll();
    });

    /* ─────────── Auto-rafraîchissement du dashboard ───────────
       On interroge périodiquement /api/admin/status (léger : juste des
       compteurs). Si l'état a changé (nouvelle commande/devis, etc.), on recharge
       la page — SAUF si l'utilisateur est occupé (champ en cours de saisie, menu
       ou modale ouverte), pour ne rien interrompre. */
    var DASH_STATE=${JSON.stringify({
      orders: orders.length,
      quotes: quotes.length,
      designs: designs.length,
      newOrders: newOrders.length,
      newQuotes: newQuotes.length,
    })};
    /* Fréquence de vérification : 5 s (était 20 s).

       Le webhook orders/create fait entrer la commande en base immédiatement,
       mais l'atelier ne la voyait qu'au tick suivant — jusqu'à 20 s d'attente
       devant un écran qui semblait figé.

       Le coût reste négligeable : /api/admin/status ne renvoie que cinq
       compteurs, et dashCheck() s'abstient dès que l'onglet passe en
       arrière-plan (document.hidden). */
    var AUTO_REFRESH_MS=5000;

    /* dashBusy() a été retiré avec le rechargement automatique : il servait à
       repérer les moments « occupés » (champ focalisé, modale ouverte) pour
       différer un reload. La page ne se recharge plus d'elle-même — voir
       showRefreshBanner(). */

    function dashChanged(s){
      return s.orders!==DASH_STATE.orders || s.quotes!==DASH_STATE.quotes ||
             s.designs!==DASH_STATE.designs || s.newOrders!==DASH_STATE.newOrders ||
             s.newQuotes!==DASH_STATE.newQuotes;
    }

    var dashPending=false;   // un changement a été détecté (bandeau affiché)
    async function dashCheck(){
      // Ne vérifie pas si l'onglet est en arrière-plan (économie).
      if(document.hidden) return;
      try{
        var r=await fetch('/api/admin/status',{headers:{'Accept':'application/json'},credentials:'same-origin'});
        // 401 = session finie (déconnexion ailleurs, ou compte bloqué par
        // l'admin principal). On recharge : la page de connexion s'affiche avec
        // l'explication, au lieu de laisser un dashboard figé et inutilisable.
        if(r.status===401){ location.reload(); return; }
        if(!r.ok) return;
        var s=await r.json();
        if(!s||!s.ok) return;
        if(dashChanged(s)){
          dashPending=true;
          // Badge IMMÉDIAT : dès qu'une nouvelle commande/devis est détecté,
          // la cloche se met à jour.
          bumpBell(s);
          /* PAS de location.reload() ici.
             Le rechargement automatique coupait la lecture d'une commande, la
             saisie d'une note ou un simple défilement : dashBusy() ne couvrait
             que les champs focalisés et les modales, pas le fait de consulter
             la page. On signale la nouveauté et l'utilisateur rafraîchit quand
             il le décide. */
          showRefreshBanner();
        }
      }catch(e){/* réseau indisponible : on réessaiera au prochain tick */}
    }

    /* Bandeau « nouvelles données » : invite à rafraîchir, sans l'imposer.
       Affiché une seule fois, il reste jusqu'au clic ou au rechargement. */
    function showRefreshBanner(){
      if(document.getElementById('dash-refresh-bar')) return;
      var bar=document.createElement('div');
      bar.id='dash-refresh-bar';
      bar.className='refresh-bar';
      bar.innerHTML=
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">'+
          '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'+
        '</svg>'+
        '<span>De nouvelles données sont disponibles.</span>'+
        '<button type="button" onclick="location.reload()">Actualiser</button>'+
        '<button type="button" class="refresh-bar-x" onclick="this.parentNode.remove()" aria-label="Ignorer">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>'+
        '</button>';
      document.body.appendChild(bar);
    }

    /* Met à jour la pastille de la cloche en direct, sans recharger la page.
       Reflète le total (commandes + devis) non vus renvoyé par /status. */
    function bumpBell(s){
      var total=(Number(s.newOrders)||0)+(Number(s.newQuotes)||0);
      var dot=document.getElementById('bell-dot');
      if(!dot) return;
      if(total>0){
        dot.textContent=total;
        dot.style.display='';
        // Petit rappel visuel que quelque chose est arrivé.
        var btn=document.getElementById('bell-btn');
        if(btn){ btn.style.animation='none'; void btn.offsetWidth; btn.style.animation='bellRing .5s ease'; }
      }else{
        dot.style.display='none';
      }
      // Mémorise les nouveaux compteurs pour ne pas re-sonner au tick suivant.
      DASH_STATE.newOrders=Number(s.newOrders)||0;
      DASH_STATE.newQuotes=Number(s.newQuotes)||0;
    }
    setInterval(dashCheck, AUTO_REFRESH_MS);
    // Vérifie aussi quand l'utilisateur revient sur l'onglet.
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) dashCheck(); });

    /* LIMITÉ AUX ONGLETS PORTANT data-tab.

       Le sélecteur balayait TOUS les .tab du document, y compris ceux des
       modales. Cliquer « Relances » dans la modale des messages exécutait donc
       ce gestionnaire : son data-tab étant absent, la recherche du panneau
       correspondant levait une TypeError — et la barre principale se
       retrouvait sans onglet actif, tous ses panneaux masqués. */
    var tabs=document.querySelectorAll('.tab[data-tab]');
    tabs.forEach(function(t){t.addEventListener('click',function(){
      tabs.forEach(function(x){x.classList.remove('active')});t.classList.add('active');
      document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
      document.getElementById('p-'+t.dataset.tab).classList.add('active');
      var s=document.getElementById('search');s.value='';filterCards(true);
    });});
    /* Filtre courant de l'onglet Devis : 'open' (à traiter), 'group', 'all'. */
    var quoteFilter='open';
    /* Filtre courant de l'onglet Commandes (étape de production). */
    var orderFilter='all';

    function filterQuotes(btn){
      quoteFilter=btn.getAttribute('data-qf');
      document.querySelectorAll('#quote-filters .chip-filter')
        .forEach(function(b){b.classList.toggle('active',b===btn);});
      filterCards(true);
    }

    /* Statut de production : appelé par le menu .dd (data-value = le filtre). */
    function filterOrders(dd){
      orderFilter=(dd && dd.getAttribute('data-value')) || 'all';
      filterCards(true);
    }

    /* ── Suivi de production ── */
    var PROD_CLS={to_produce:'todo',producing:'doing',ready:'ready',shipped:'done'};
    var PROD_LBL={to_produce:'À produire',producing:'En production',ready:'Prête',shipped:'Expédiée'};

    /* « Expédiée » n'est pas un simple clic : Shopify enverra un e-mail au
       client. On demande confirmation et on propose un n° de suivi. */
    var shipCtx=null;
    function setProdStatus(orderId,status,btn){
      if(status==='shipped'){
        shipCtx={orderId:orderId,btn:btn};
        document.getElementById('ship-num').value='';
        document.getElementById('ship-carrier').value='';
        document.getElementById('ship-status').textContent='';
        document.getElementById('ship-modal').classList.add('open');
        return;
      }
      doProdStatus(orderId,status,btn,null);
    }

    function closeShip(){
      document.getElementById('ship-modal').classList.remove('open');
      shipCtx=null;
    }
    function confirmShip(){
      if(!shipCtx) return;
      var st=document.getElementById('ship-status');
      var go=document.getElementById('ship-go');
      go.disabled=true; st.className='hint'; st.textContent='Expédition dans Shopify…';
      doProdStatus(shipCtx.orderId,'shipped',shipCtx.btn,{
        tracking:document.getElementById('ship-num').value.trim(),
        carrier:document.getElementById('ship-carrier').value.trim()
      },function(res){
        go.disabled=false;
        if(res && res.ok){ closeShip(); }
        else { st.className='hint err'; st.textContent=(res&&res.error)||'Échec.'; }
      });
    }

    function doProdStatus(orderId,status,btn,extra,done){
      var steps=document.getElementById('steps-'+orderId);
      if(steps) steps.querySelectorAll('.step').forEach(function(b){b.disabled=true;});

      var payload={status:status};
      if(extra){ payload.tracking=extra.tracking; payload.carrier=extra.carrier; }

      fetch('/api/admin/orders/'+encodeURIComponent(orderId)+'/status',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      })
      .then(function(r){
        /* Le contrôleur répond en JSON même sur 400/502 (refus Shopify), et ce
           message est utile : on le laisse passer. En revanche une 401 ou une
           erreur générée par le proxy renvoie du HTML — r.json() lèverait
           alors une erreur de parsing incompréhensible à la place de la cause.
           Cette route déclenche le mail de confirmation au client : un
           diagnostic exact compte ici plus que partout ailleurs. */
        if(r.status===401) throw new Error('Session expirée : reconnectez-vous.');
        var ct=r.headers.get('content-type')||'';
        if(ct.indexOf('application/json')===-1){
          throw new Error('Le serveur a répondu ' + r.status + '.');
        }
        return r.json();
      })
      .then(function(res){
        if(!res.ok){
          /* Shopify a refusé : on NE marque PAS la commande expédiée, sinon le
             dashboard mentirait (le client n'a rien reçu). */
          if(done){ done(res); return; }
          throw new Error(res.error||'Échec');
        }
        // Étape active
        if(steps) steps.querySelectorAll('.step').forEach(function(b){
          b.classList.toggle('active', b===btn);
        });
        // Pastille de l'en-tête
        var card=document.getElementById('card-'+orderId);
        if(card){
          card.setAttribute('data-prod',status);
          var pill=card.querySelector('.pill.prod');
          if(pill){
            pill.className='pill prod '+(PROD_CLS[status]||'todo');
            pill.textContent=PROD_LBL[status]||status;
          }
        }
        filterCards();
        if(res.shopify) toast(res.shopify);
        // Shopify ne sait pas revenir en arrière : la synchro rétablira le
        // statut précédent. On le dit plutôt que de laisser la correction
        // disparaître silencieusement deux minutes plus tard.
        if(res.notice) toast(res.notice);
        if(done) done(res);
      })
      .catch(function(e){
        if(done) done({ok:false,error:e.message});
        else alert('Impossible de changer le statut : '+e.message);
      })
      .finally(function(){
        if(steps) steps.querySelectorAll('.step').forEach(function(b){b.disabled=false;});
      });
    }

    /* Message éphémère (confirmation d'expédition). */
    function toast(msg){
      var t=document.getElementById('toast');
      t.textContent=msg; t.classList.add('show');
      setTimeout(function(){t.classList.remove('show');},4500);
    }

    /* ── Note interne ── */
    function saveNote(orderId){
      var input=document.getElementById('note-'+orderId);
      var st=document.getElementById('note-status-'+orderId);
      if(!input) return;
      /* Verrou anti double-envoi : sans lui, deux clics rapides lançaient deux
         POST concurrents et le dernier arrivé écrasait l'autre. */
      if(input.dataset.saving==='1') return;
      input.dataset.saving='1';
      st.className='hint'; st.textContent='Enregistrement…';
      fetch('/api/admin/orders/'+encodeURIComponent(orderId)+'/note',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({note:input.value})
      })
      .then(function(r){
        /* fetch ne rejette PAS sur une erreur HTTP : sans ce test, une 401
           (session expirée) ou une 502 du proxy tombait dans .catch en
           essayant de parser du HTML, et le message affiché devenait
           « Erreur réseau » — un diagnostic faux, qui envoyait chercher le
           problème du mauvais côté. */
        if(r.status===401) throw new Error('Session expirée : reconnectez-vous.');
        if(!r.ok) throw new Error('Le serveur a répondu ' + r.status + '.');
        return r.json();
      })
      .then(function(res){
        if(res.ok){ st.className='hint ok'; st.textContent='Note enregistrée.'; }
        else { st.className='hint err'; st.textContent=res.error||"Échec de l'enregistrement."; }
        setTimeout(function(){st.textContent='';},2200);
      })
      .catch(function(e){
        st.className='hint err';
        st.textContent=e.message||'Erreur réseau.';
      })
      .then(function(){ input.dataset.saving=''; });
    }

    /* ── Relance d'un devis impayé ── */
    function remindQuote(quoteId,btn){
      var original=btn.textContent;
      btn.disabled=true; btn.textContent='Envoi…';
      fetch('/api/admin/quotes/'+encodeURIComponent(quoteId)+'/remind',{method:'POST'})
      .then(function(r){return r.json();})
      .then(function(res){
        if(res.ok){
          btn.textContent='Relance envoyée';
          setTimeout(function(){btn.disabled=false;btn.textContent=original;},2500);
        }else{
          btn.disabled=false; btn.textContent=original;
          alert('Relance impossible : '+(res.error||''));
        }
      })
      .catch(function(e){
        btn.disabled=false; btn.textContent=original;
        alert('Erreur réseau : '+e.message);
      });
    }

    /* Filtres SERVEUR (période, tri) : ils rechargent la page avec la query.
       On lit tous les .filter-sel de la page, car ils ne sont plus tous dans
       #filters (la période est descendue près du filtre de statut). Le select de
       statut n'a pas d'attribut name : il est purement client, donc ignoré. */
    function applyFilters(){
      var p=new URLSearchParams();
      // Les menus .dd portent leur clé (data-name) et leur valeur (data-value).
      // Ceux sans data-name sont des filtres client : on les ignore ici.
      document.querySelectorAll('.dd[data-name]').forEach(function(d){
        var name=d.getAttribute('data-name');
        var val=d.getAttribute('data-value');
        if(!name) return;
        if(val && val!=='all' && val!=='date_desc') p.set(name,val);
      });
      var qs=p.toString();
      window.location.href='/api/admin'+(qs?('?'+qs):'');
    }

    /* ── Export CSV : reprend les filtres affichés ── */
    function toggleExport(){
      document.getElementById('export-menu').classList.toggle('open');
    }
    document.addEventListener('click',function(e){
      var w=document.querySelector('.export-wrap');
      if(w && !w.contains(e.target))
        document.getElementById('export-menu').classList.remove('open');
    });
    function exportCsv(type){
      var p=new URLSearchParams(window.location.search);
      p.set('type',type);
      window.location.href='/api/admin/export.csv?'+p.toString();
      document.getElementById('export-menu').classList.remove('open');
      return false;
    }

    /* ── Menu « Paramètres » : Prix, Réglages, Admins, Compte, Thème ── */
    function closeCog(){
      var m=document.getElementById('cog-menu');
      if(!m) return;
      m.classList.remove('open');
      m.parentNode.classList.remove('open');
      document.getElementById('cog-btn').setAttribute('aria-expanded','false');
    }
    function toggleCog(e){
      e.stopPropagation();                              // sinon le doc referme aussitôt
      var m=document.getElementById('cog-menu');
      var ouvert=m.classList.toggle('open');
      m.parentNode.classList.toggle('open',ouvert);
      document.getElementById('cog-btn').setAttribute('aria-expanded',ouvert?'true':'false');
      /* En mobile le panneau est en position:fixed et la barre a une hauteur
         libre (deux lignes) : on mesure plutôt que de supposer. Inutilisé sur
         grand écran, où le panneau est ancré sur son bouton. */
      if(ouvert){
        var bar=document.querySelector('.topbar');
        if(bar) m.style.setProperty('--cog-top',(bar.getBoundingClientRect().bottom+8)+'px');
      }
      /* Un seul panneau ouvert à la fois dans la barre. */
      document.getElementById('notif-pop').classList.remove('open');
    }
    /* Toute entrée du menu referme d'abord : sans quoi le panneau resterait
       ouvert derrière la modale, et réapparaîtrait à sa fermeture. */
    function fromCog(action){ closeCog(); action(); }

    /* ── Notifications : panneau déroulant sous la cloche ── */
    function toggleNotifs(e){
      e.stopPropagation();                              // sinon le doc referme aussitôt
      document.getElementById('notif-pop').classList.toggle('open');
      document.getElementById('export-menu').classList.remove('open');
      closeCog();
    }
    /* Clic à l'extérieur, ou Échap : on referme. */
    document.addEventListener('click',function(e){
      var w=document.querySelector('.bell-wrap');
      if(w && !w.contains(e.target))
        document.getElementById('notif-pop').classList.remove('open');
      var c=document.querySelector('.menu-wrap');
      if(c && !c.contains(e.target)) closeCog();
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){
        document.getElementById('notif-pop').classList.remove('open');
        closeCog();
      }
    });

    /* Depuis une notification : ouvrir le bon onglet, dérouler la carte. */
    function gotoCard(tab,cardId){
      document.getElementById('notif-pop').classList.remove('open');
      var t=document.querySelector('.tab[data-tab="'+tab+'"]');
      if(t) t.click();
      /* Onglet Devis : le sous-filtre « à traiter » masque les devis payés. */
      if(tab==='quotes'){
        var all=document.querySelector('#quote-filters .chip-filter[data-qf="all"]');
        if(all) filterQuotes(all);
      }
      var card=document.getElementById(cardId);
      if(!card) return;
      card.classList.add('open');
      card.scrollIntoView({behavior:'smooth',block:'center'});
      card.classList.remove('flash');
      void card.offsetWidth;                            // relance l'animation
      card.classList.add('flash');
      /* Ouverte depuis une notification : elle est lue immédiatement aussi. */
      markCardSeen(card);
    }

    /* Marquer toutes les nouveautés comme lues. */
    function markSeen(){
      var bell=document.getElementById('bell-btn');
      var dot=bell.querySelector('.bell-dot');
      if(!dot) return;                                  // rien de neuf
      fetch('/api/admin/seen',{
        method:'POST',
        credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(UNSEEN)
      }).then(function(r){
        /* fetch ne rejette PAS sur un 401 ou un 500 : sans ce test, l'UI
           retirait les badges et affichait « Vous êtes à jour » alors que le
           serveur avait refusé. Une session expirée pendant la nuit suffisait :
           l'admin croyait avoir traité des commandes qu'il ne reverrait plus. */
        if(!r.ok) throw new Error('HTTP '+r.status);
        dot.remove();
        document.querySelectorAll('.badge-new').forEach(function(b){b.remove();});
        var clear=document.querySelector('.notif-clear');
        if(clear) clear.remove();
        document.getElementById('notif-list').innerHTML=
          '<div class="notif-empty"><div class="ico">&#10003;</div>'+
          '<p>Rien de nouveau.</p><small>Vous êtes à jour.</small></div>';
      }).catch(function(){
        /* On ne touche à RIEN : les badges restent, l'état affiché continue de
           refléter la base. */
        showAlert('Marquage impossible',
          'Les nouveautés restent non lues. Rechargez la page et réessayez.',
          'error');
      });
    }

    /* ═══════════════ Modale de confirmation (succès / erreur) ═══════════════ */

    var ICO_OK='<svg width="34" height="34" viewBox="0 0 24 24" fill="none" '+
      'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'+
      '<path d="M20 6L9 17l-5-5"/></svg>';
    var ICO_ERR='<svg width="34" height="34" viewBox="0 0 24 24" fill="none" '+
      'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'+
      '<path d="M18 6L6 18M6 6l12 12"/></svg>';

    /**
     * Affiche une confirmation centrée.
     * @param title  titre court
     * @param text   détail (optionnel)
     * @param type   'success' (défaut) ou 'error'
     */
    function showAlert(title, text, type){
      var m=document.getElementById('alert-modal');
      if(!m) return;
      var isErr = type==='error';
      m.classList.toggle('is-error', isErr);
      document.getElementById('alert-ico').innerHTML = isErr ? ICO_ERR : ICO_OK;
      document.getElementById('alert-title').textContent = title || (isErr?'Échec':'Enregistré');
      var p=document.getElementById('alert-text');
      p.textContent = text || '';
      p.style.display = text ? '' : 'none';
      m.classList.add('open');
    }
    function closeAlert(){
      var m=document.getElementById('alert-modal');
      if(m) m.classList.remove('open');
    }
    /* Échap ferme la confirmation. */
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape') closeAlert();
    });

    /* ═══════════════ Mon compte : changer mon mot de passe ═══════════════ */

    function openAccount(){
      ['acc-cur','acc-new','acc-new2'].forEach(function(id){
        var el=document.getElementById(id); if(el) el.value='';
      });
      document.getElementById('acc-modal').classList.add('open');
      var f=document.getElementById('acc-cur'); if(f) f.focus();
    }
    function closeAccount(){
      document.getElementById('acc-modal').classList.remove('open');
    }

    async function saveOwnPassword(){
      var cur=document.getElementById('acc-cur').value;
      var pwd=document.getElementById('acc-new').value;
      var pwd2=document.getElementById('acc-new2').value;
      var btn=document.getElementById('acc-save');

      // Contrôles côté client : messages immédiats, sans aller-retour serveur.
      if(!cur){ showAlert('Champ manquant','Saisissez votre mot de passe actuel.','error');
        document.getElementById('acc-cur').focus(); return; }
      if(pwd.length<8){ showAlert('Mot de passe trop court',
        'Le nouveau mot de passe doit faire au moins 8 caractères.','error');
        document.getElementById('acc-new').focus(); return; }
      if(pwd!==pwd2){ showAlert('Confirmation différente',
        'Les deux nouveaux mots de passe ne correspondent pas.','error');
        document.getElementById('acc-new2').focus(); return; }

      btn.disabled=true;
      try{
        var r=await fetch('/api/admin/me/password',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify({currentPassword:cur,newPassword:pwd})
        });
        var d=await r.json();
        btn.disabled=false;
        if(!d.ok){ showAlert('Échec', d.error||'Le mot de passe n\\'a pas été changé.','error'); return; }
        closeAccount();

        /* Déconnexion après changement de mot de passe.

           La session en cours reste techniquement valide, mais elle a été
           ouverte avec l'ANCIEN mot de passe : la garder revient à laisser
           active une authentification que l'admin vient justement de révoquer.
           C'est le comportement attendu partout ailleurs, et il compte
           doublement si le changement fait suite à une compromission.

           5 secondes affichées plutôt qu'une redirection sèche : l'admin doit
           voir que l'opération a réussi avant de se retrouver sur l'écran de
           connexion — sinon le retour au login se lit comme un échec. */
        var reste = 5;
        var msg = function () {
          return 'Utilisez le nouveau mot de passe à votre prochaine connexion.\\n' +
                 'Déconnexion dans ' + reste + ' seconde' + (reste > 1 ? 's' : '') + '…';
        };
        showAlert('Mot de passe changé', msg());

        /* Le bouton de la modale d'alerte fermerait la fenêtre sans annuler le
           compte à rebours : on le neutralise, la déconnexion étant de toute
           façon inévitable. */
        var btnAlert = document.querySelector('#alert-modal .btn');
        if (btnAlert) { btnAlert.disabled = true; btnAlert.style.opacity = '.5'; }

        var tic = setInterval(function () {
          reste--;
          if (reste > 0) { showAlert('Mot de passe changé', msg()); return; }
          clearInterval(tic);
          /* Même route que le lien « Déconnexion » de l'en-tête : elle supprime
             le cookie côté serveur puis redirige vers l'écran de connexion. */
          window.location.href = '/api/admin/logout';
        }, 1000);
      }catch(e){
        btn.disabled=false;
        showAlert('Erreur réseau', e.message, 'error');
      }
    }

    /* ═══════════════════ Prix du configurateur ═══════════════════ */

    var PRICE_KEYS=[];   // ordre des produits, fourni par le serveur
    var PRICE_TIERS={};  // grilles dégressives chargées, par produit
    var PRICE_QUOTE_ONLY=[]; // produits sur devis : ni champ, ni grille

    function openPricing(){
      document.getElementById('price-modal').classList.add('open');
      loadPricing();
    }
    function closePricing(){
      document.getElementById('price-modal').classList.remove('open');
    }

    /* ── Réglages de l'atelier ─────────────────────────────────────────────
       Nommée saveSettingsModal et non saveSettings : ce script est inline et
       vit dans la portée globale de la page, où un nom générique finit par
       rencontrer son homonyme. Le suffixe dit d'où vient la fonction.

       (Aucun accent grave dans ce fichier : tout le dashboard est un template
       string TypeScript, une paire de backticks y refermerait la chaîne.) */
    function openSettings(){
      document.getElementById('set-modal').classList.add('open');
      loadSettings();
    }
    function closeSettings(){
      document.getElementById('set-modal').classList.remove('open');
    }

    async function loadSettings(){
      var box=document.getElementById('set-maintenance');
      var st=document.getElementById('set-status');
      if(st) st.textContent='';
      if(!box) return;
      /* Désactivée le temps du chargement : cocher avant que l'état réel soit
         connu aurait enregistré une valeur devinée. */
      box.disabled=true;
      try{
        var r=await fetch('/api/admin/settings',{credentials:'same-origin'});
        var d=await r.json();
        if(!d.ok||!d.settings){ if(st) st.textContent=d.error||'Réglages indisponibles.'; return; }
        box.checked=!!d.settings.maintenanceEnabled;
        box.disabled=false;
      }catch(e){
        if(st) st.textContent='Réglages indisponibles — vérifiez la connexion.';
      }
    }

    async function saveSettingsModal(){
      var box=document.getElementById('set-maintenance');
      var btn=document.getElementById('set-save');
      var st=document.getElementById('set-status');
      if(!box) return;
      if(btn){ btn.disabled=true; btn.textContent='Enregistrement…'; }
      if(st) st.textContent='';
      try{
        /* SEUL le mode maintenance est transmis : le point d'entrée n'écrit
           que les clés reçues, les relances de devis restent donc intactes. */
        var r=await fetch('/api/admin/settings',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify({ maintenanceEnabled: box.checked })
        });
        var d=await r.json();
        if(!d.ok){ showAlert('Enregistrement impossible', d.error||'Erreur inconnue.', 'error'); return; }
        closeSettings();
        showAlert(
          box.checked ? 'Configurateur fermé' : 'Configurateur rouvert',
          box.checked
            ? "Les visiteurs voient désormais l'écran de maintenance. Les clients déjà sur la page basculeront en moins d'une minute."
            : 'Le configurateur est de nouveau accessible.'
        );
      }catch(e){
        showAlert('Enregistrement impossible', 'Le serveur ne répond pas.', 'error');
      }finally{
        if(btn){ btn.disabled=false; btn.textContent='Enregistrer'; }
      }
    }

    async function loadPricing(){
      var box=document.getElementById('price-list');
      var st=document.getElementById('price-status');
      if(st) st.textContent='';
      box.innerHTML='<p class="hint">Chargement…</p>';
      try{
        var r=await fetch('/api/admin/pricing',{credentials:'same-origin'});
        var d=await r.json();
        if(!d.ok){ box.innerHTML='<p class="hint">'+admEsc(d.error||'Erreur')+'</p>'; return; }
        PRICE_KEYS=d.keys||[];
        PRICE_TIERS=d.tiers||{};
        var multi=d.multiVariant||[];
        // Produits sur devis : le serveur REJETTE leur prix. Afficher un champ
        // de saisie promettait une action impossible — la modale annonçait
        // « Prix mis à jour » alors que la valeur était jetée.
        PRICE_QUOTE_ONLY=d.quoteOnly||[];
        box.innerHTML=PRICE_KEYS.map(function(k){
          var quoteOnly=PRICE_QUOTE_ONLY.indexOf(k)!==-1;
          var noVariant=!d.variants||!d.variants[k];
          // Textiles : le prix couvre toutes les couleurs/tailles -> on le dit
          // sur la ligne, là où l'admin saisit la valeur.
          var note = quoteOnly
            ? '<span class="price-note">chiffré à la main sur chaque devis</span>'
            : (multi.indexOf(k)!==-1
              ? '<span class="price-note">toutes couleurs et tailles</span>'
              : (noVariant ? '<span class="price-note">devis — indicatif</span>' : ''));
          var tiers = PRICE_TIERS[k]||[];
          // Ni champ ni grille pour un produit sur devis : rien à enregistrer.
          var field = quoteOnly
            ? '<div class="price-field"><span class="price-note">sur devis</span></div>'
            : '<div class="price-field">'+
                '<input type="number" id="price-'+k+'" class="price-input mono" '+
                  'step="0.01" min="0" value="'+Number(d.prices[k]).toFixed(2)+'">'+
                '<span class="price-cur">€ HT</span>'+
              '</div>';
          return '<div class="price-line">'+
                   '<div class="price-lbl">'+
                     '<label for="price-'+k+'">'+admEsc(d.labels[k]||k)+'</label>'+
                     note+
                   '</div>'+
                   field+
                 '</div>'+
                 (quoteOnly ? '' : tierBlock(k, tiers));
        }).join('');
      }catch(e){
        box.innerHTML='<p class="hint">Erreur de chargement.</p>';
      }
    }

    /* Bloc « tarifs dégressifs » d'un produit : liste repliable des paliers.
       Replié par défaut — la modale afficherait sinon six grilles ouvertes. */
    function tierBlock(key, tiers){
      var n = tiers.length;
      var summary = n
        ? n+' palier'+(n>1?'s':'')
        : 'aucun palier';
      return '<details class="tier-block" id="tier-block-'+key+'"'+(n?'':'')+'>'+
               '<summary class="tier-sum">'+
                 '<svg class="tier-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg>'+
                 '<span>Tarifs dégressifs</span>'+
                 '<span class="tier-count">'+summary+'</span>'+
               '</summary>'+
               '<div class="tier-rows" id="tier-rows-'+key+'">'+
                 tiers.map(function(t){ return tierRow(t.min, t.price); }).join('')+
               '</div>'+
               '<button type="button" class="tier-add" onclick="addTier(\\''+key+'\\')">+ Ajouter un palier</button>'+
             '</details>';
    }

    /* Une ligne de palier. Les valeurs sont lues au moment d'enregistrer :
       pas d'état JS intermédiaire à tenir synchronisé avec le DOM. */
    function tierRow(min, price){
      return '<div class="tier-row">'+
               '<span class="tier-from">à partir de</span>'+
               '<input type="number" class="tier-min mono" min="1" step="1" value="'+(min||1)+'">'+
               '<span class="tier-unit">art.</span>'+
               '<input type="number" class="tier-price mono" min="0" step="0.01" value="'+Number(price||0).toFixed(2)+'">'+
               '<span class="tier-cur">€ HT</span>'+
               '<button type="button" class="tier-del" onclick="delTier(this)" aria-label="Supprimer ce palier">'+
                 '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>'+
               '</button>'+
             '</div>';
    }

    /** Ajoute un palier vide au produit. */
    function addTier(key){
      var rows=document.getElementById('tier-rows-'+key);
      if(!rows) return;
      var d=document.createElement('div');
      d.innerHTML=tierRow(1,0);
      rows.appendChild(d.firstChild);
      refreshTierCount(key);
      var last=rows.querySelector('.tier-row:last-child .tier-min');
      if(last) last.focus();
    }

    /** Retire un palier. */
    function delTier(btn){
      var row=btn.closest('.tier-row');
      var block=btn.closest('.tier-block');
      if(row) row.remove();
      if(block) refreshTierCount(block.id.replace('tier-block-',''));
    }

    /** Met à jour le compteur affiché dans l'en-tête repliable. */
    function refreshTierCount(key){
      var rows=document.getElementById('tier-rows-'+key);
      var block=document.getElementById('tier-block-'+key);
      if(!rows||!block) return;
      var n=rows.querySelectorAll('.tier-row').length;
      var el=block.querySelector('.tier-count');
      if(el) el.textContent = n ? n+' palier'+(n>1?'s':'') : 'aucun palier';
    }

    /* Lit les paliers saisis pour un produit.
       @returns {Array|null} null si une valeur est invalide (l'appelant
       interrompt alors l'enregistrement et signale le champ fautif). */
    function collectTiers(key){
      var rows=document.getElementById('tier-rows-'+key);
      if(!rows) return [];
      var out=[];
      var els=rows.querySelectorAll('.tier-row');
      for(var i=0;i<els.length;i++){
        var minEl=els[i].querySelector('.tier-min');
        var prEl=els[i].querySelector('.tier-price');
        var min=parseInt(minEl.value,10);
        var pr=parseFloat(prEl.value);
        if(isNaN(min)||min<1){ minEl.focus(); return null; }
        if(isNaN(pr)||pr<0){ prEl.focus(); return null; }
        out.push({min:min, price:pr});
      }
      return out;
    }

    async function savePricing(){
      var st=document.getElementById('price-status');
      var btn=document.getElementById('price-save');
      if(!PRICE_KEYS.length) return;

      var body={};
      var tiers={};
      for(var i=0;i<PRICE_KEYS.length;i++){
        var k=PRICE_KEYS[i];
        var el=document.getElementById('price-'+k);
        if(!el) continue;
        var v=parseFloat(el.value);
        if(isNaN(v)||v<0){
          showAlert('Prix invalide',
            'Vérifiez la valeur saisie : elle doit être un nombre positif.', 'error');
          el.focus();
          return;
        }
        body[k]=v;

        // Paliers du produit. collectTiers() met le focus sur le champ fautif
        // et renvoie null : on interrompt sans rien enregistrer.
        var t=collectTiers(k);
        if(t===null){
          showAlert('Palier invalide',
            'Chaque palier demande une quantité entière (≥ 1) et un prix positif.',
            'error');
          return;
        }
        tiers[k]=t;
      }
      body.tiers=tiers;

      btn.disabled=true; st.className='hint'; st.textContent='Enregistrement…';
      try{
        var r=await fetch('/api/admin/pricing',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify(body)
        });
        var d=await r.json();
        btn.disabled=false;
        if(!d.ok){
          st.textContent='';
          showAlert('Échec', d.error||'Les prix n\\'ont pas pu être enregistrés.', 'error');
          return;
        }

        st.textContent='';
        // Shopify a pu refuser certaines mises à jour : l'enregistrement local a
        // bien eu lieu, mais on ne peut pas parler de succès complet.
        if(d.warnings&&d.warnings.length){
          showAlert('Enregistré, mais…',
            'Shopify n\\'a pas suivi pour : '+d.warnings.join(' ; '), 'error');
        }else{
          closePricing();
          showAlert('Prix mis à jour',
            'Les nouveaux prix sont appliqués dans le configurateur et sur Shopify.');
        }
      }catch(e){
        btn.disabled=false;
        st.textContent='';
        showAlert('Erreur réseau', e.message, 'error');
      }
    }

    /* ═══════════════ Gestion des administrateurs (owner) ═══════════════ */

    var LAST_CREDS=null;   // derniers identifiants générés (pour le partage)

    function openAdmins(){
      var m=document.getElementById('adm-modal');
      if(!m) return;
      m.classList.add('open');
      loadAdmins();
    }
    function closeAdmins(){
      var m=document.getElementById('adm-modal');
      if(m) m.classList.remove('open');
    }

    function admEsc(s){
      return String(s==null?'':s).replace(/[&<>"']/g,function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }

    /* Liste des comptes + actions bloquer/débloquer. */
    async function loadAdmins(){
      var box=document.getElementById('adm-list');
      if(!box) return;
      box.innerHTML='<p class="hint">Chargement…</p>';
      try{
        var r=await fetch('/api/admin/admins',{credentials:'same-origin'});
        var d=await r.json();
        if(!d.ok){box.innerHTML='<p class="hint">'+admEsc(d.error||'Erreur')+'</p>';return;}
        if(!d.admins.length){box.innerHTML='<p class="hint">Aucun compte.</p>';return;}

        // Compteur à côté du titre de la section.
        var cnt=document.getElementById('adm-count');
        if(cnt) cnt.textContent='('+d.admins.length+')';

        box.innerHTML=d.admins.map(function(a){
          var isMe=d.me&&a.id===d.me.id;
          var owner=a.role==='owner';
          var tag=owner
            ? '<span class="pill ok">Principal</span>'
            : (a.blocked?'<span class="pill neutral">Bloqué</span>':'<span class="pill ok">Actif</span>');
          var last=a.lastLoginAt
            ? 'Dernière connexion : '+new Date(a.lastLoginAt).toLocaleString('fr-FR')
            : 'Jamais connecté';
          // Rattachement Shopify (client créé à l'invitation).
          var shop=a.shopifyCustomerId
            ? '<span class="adm-shop" title="Client Shopify rattaché">Shopify ✓</span>'
            : '';
          // L'owner et soi-même ne peuvent pas être bloqués.
          var actions=(owner||isMe)
            ? ''
            : '<button class="btn adm-mini" onclick="toggleBlock(\\''+a.id+'\\','+(!a.blocked)+')">'+
              (a.blocked?'Débloquer':'Bloquer')+'</button>'+
              '<button class="btn adm-mini" onclick="resetPass(\\''+a.id+'\\')">Nouveau mot de passe</button>';
          // Initiales pour l'avatar.
          var ini=(a.email||'?').trim().slice(0,2).toUpperCase();
          return '<div class="adm-row'+(a.blocked?' is-blocked':'')+'">'+
                 '<div class="adm-av">'+admEsc(ini)+'</div>'+
                 '<div class="adm-main">'+
                   '<div class="adm-mail">'+admEsc(a.email)+
                     (isMe?' <span class="adm-you">vous</span>':'')+'</div>'+
                   '<div class="adm-meta">'+last+shop+'</div>'+
                 '</div>'+
                 '<div class="adm-side">'+tag+
                   (actions?'<div class="adm-acts">'+actions+'</div>':'')+
                 '</div>'+
                 '</div>';
        }).join('');
      }catch(e){
        box.innerHTML='<p class="hint">Erreur de chargement.</p>';
      }
    }

    /* Invite : e-mail -> mot de passe généré côté serveur. */
    async function inviteAdmin(){
      var input=document.getElementById('adm-email');
      var btn=document.getElementById('adm-add');
      var status=document.getElementById('adm-status');
      var email=(input.value||'').trim();
      if(!email){status.textContent='Renseignez un e-mail.';return;}

      btn.disabled=true;status.textContent='Création…';
      try{
        var r=await fetch('/api/admin/admins',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify({email:email})
        });
        var d=await r.json();
        if(!d.ok){status.textContent=d.error||'Erreur.';btn.disabled=false;return;}

        // Le rattachement Shopify est un complément : on informe sans bloquer.
        status.textContent='Compte créé.'+(d.shopify&&d.shopify.note?' '+d.shopify.note:'');
        input.value='';
        showCreds(d.admin.email,d.password);
        loadAdmins();
      }catch(e){
        status.textContent='Erreur réseau.';
      }
      btn.disabled=false;
    }

    /* Régénère le mot de passe d'un compte existant. */
    async function resetPass(id){
      var status=document.getElementById('adm-status');
      status.textContent='Génération…';
      try{
        var r=await fetch('/api/admin/admins/'+id+'/password',{
          method:'POST',credentials:'same-origin'
        });
        var d=await r.json();
        if(!d.ok){status.textContent=d.error||'Erreur.';return;}
        status.textContent='Nouveau mot de passe généré.';
        showCreds(d.email,d.password);
      }catch(e){status.textContent='Erreur réseau.';}
    }

    /* Bloque / débloque un compte. */
    async function toggleBlock(id,blocked){
      var status=document.getElementById('adm-status');
      try{
        var r=await fetch('/api/admin/admins/'+id+'/blocked',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          credentials:'same-origin',
          body:JSON.stringify({blocked:blocked})
        });
        var d=await r.json();
        if(!d.ok){status.textContent=d.error||'Erreur.';return;}
        status.textContent=blocked?'Compte bloqué.':'Compte débloqué.';
        loadAdmins();
      }catch(e){status.textContent='Erreur réseau.';}
    }

    /* Affiche les identifiants générés + prépare le partage. */
    function showCreds(email,password){
      var url=location.origin+'/api/admin';
      LAST_CREDS={
        email:email,
        password:password,
        text:'Accès administrateur Custom Textile\\n'+
             'Lien : '+url+'\\n'+
             'E-mail : '+email+'\\n'+
             'Mot de passe : '+password
      };
      var box=document.getElementById('adm-cred');
      document.getElementById('adm-cred-txt').innerHTML=
        '<div class="adm-cred-line"><span>Lien</span><b>'+admEsc(url)+'</b></div>'+
        '<div class="adm-cred-line"><span>E-mail</span><b>'+admEsc(email)+'</b></div>'+
        '<div class="adm-cred-line"><span>Mot de passe</span><b>'+admEsc(password)+'</b></div>';
      box.style.display='block';
      document.getElementById('adm-share-hint').textContent='';
    }

    /* VRAI panneau de partage du système (Web Share API) : ouvre le sélecteur
       d'applications natif (WhatsApp, Gmail, Messages…). Repli : copie. */
    async function shareCreds(){
      if(!LAST_CREDS) return;
      var hint=document.getElementById('adm-share-hint');
      if(navigator.share){
        try{
          await navigator.share({
            title:'Accès administrateur — Custom Textile',
            text:LAST_CREDS.text
          });
          hint.textContent='Partagé.';
          return;
        }catch(e){
          // L'utilisateur a annulé : on ne fait rien de plus.
          if(e && e.name==='AbortError'){hint.textContent='';return;}
        }
      }
      // Navigateur sans panneau natif (souvent desktop) : on copie.
      copyCreds();
      hint.textContent='Partage natif indisponible ici : identifiants copiés.';
    }

    function copyCreds(){
      if(!LAST_CREDS) return;
      var hint=document.getElementById('adm-share-hint');
      navigator.clipboard.writeText(LAST_CREDS.text).then(function(){
        hint.textContent='Identifiants copiés.';
      }).catch(function(){
        hint.textContent='Copie impossible : sélectionnez le texte manuellement.';
      });
    }
    /* Pagination : nb d'éléments par page, et page courante par panel. */
    var PAGE_SIZE=10;
    var pageByPanel={ 'p-orders':1, 'p-quotes':1, 'p-designs':1 };

    function filterCards(resetPage){
      var q=document.getElementById('search').value.toLowerCase().trim();
      var panel=document.querySelector('.panel.active');
      var isQuotes = panel.id==='p-quotes';
      var isOrders = panel.id==='p-orders';

      // Un changement de filtre/recherche renvoie à la page 1.
      if(resetPage) pageByPanel[panel.id]=1;

      // 1) Détermine les cartes qui PASSENT les filtres (avant pagination).
      var matched=[];
      panel.querySelectorAll('.card').forEach(function(c){
        var hay=c.getAttribute('data-search')||'';
        var matchText = !q || hay.indexOf(q)!==-1;

        var matchStatus = true;
        if(isQuotes && quoteFilter!=='all'){
          var isGrp=c.getAttribute('data-group')==='true';
          // Plus de filtre « payés » : un devis payé est devenu une commande
          // et n'est plus servi ici (getQuotes, includePaid=false). Reste
          // « groupe » (raccourci) et « à traiter » (= tout le reste).
          matchStatus = (quoteFilter==='group') ? isGrp : true;
        }
        if(isOrders && orderFilter!=='all'){
          if(orderFilter==='group'){
            matchStatus = c.getAttribute('data-group')==='true';
          } else {
            matchStatus = (c.getAttribute('data-prod')||'to_produce')===orderFilter;
          }
        }
        if(matchText && matchStatus) matched.push(c); else c.style.display='none';
      });

      // 2) Pagination sur les cartes filtrées.
      var total=matched.length;
      var pages=Math.max(1, Math.ceil(total/PAGE_SIZE));
      var page=Math.min(pageByPanel[panel.id]||1, pages);
      pageByPanel[panel.id]=page;
      var start=(page-1)*PAGE_SIZE, end=start+PAGE_SIZE;
      matched.forEach(function(c,i){ c.style.display=(i>=start && i<end)?'':'none'; });

      // 3) Barre de pagination.
      renderPager(panel.id, page, pages, total);

      // Messages « aucun élément dans cette catégorie ».
      var noneQ=document.getElementById('quotes-none');
      if(noneQ) noneQ.style.display = (isQuotes && total===0) ? '' : 'none';
      var noneO=document.getElementById('orders-none');
      if(noneO) noneO.style.display = (isOrders && total===0) ? '' : 'none';
    }

    /* Construit/actualise la barre de pagination d'un panel. */
    function renderPager(panelId, page, pages, total){
      var panel=document.getElementById(panelId);
      var pager=panel.querySelector('.pager');
      if(pages<=1){ if(pager) pager.remove(); return; }
      if(!pager){
        pager=document.createElement('div');
        pager.className='pager';
        panel.appendChild(pager);
      }
      // Liste des numéros à afficher, avec ellipses si beaucoup de pages :
      // toujours 1 et la dernière, + une fenêtre autour de la page courante.
      var nums=[];
      var win=1; // pages de part et d'autre de la courante
      for(var p=1;p<=pages;p++){
        if(p===1 || p===pages || (p>=page-win && p<=page+win)) nums.push(p);
        else if(nums[nums.length-1]!=='…') nums.push('…');
      }
      var numsHtml=nums.map(function(n){
        if(n==='…') return '<span class="pg-ellipsis">…</span>';
        return '<button class="pg-num'+(n===page?' active':'')+'" data-page="'+n+'"'+
               (n===page?' disabled':'')+'>'+n+'</button>';
      }).join('');

      // Flèches + numéros de page cliquables (pagination standard).
      pager.innerHTML=
        '<button class="pg-btn" data-pg="prev" '+(page<=1?'disabled':'')+'>‹ Précédent</button>'+
        '<div class="pg-nums">'+numsHtml+'</div>'+
        '<button class="pg-btn" data-pg="next" '+(page>=pages?'disabled':'')+'>Suivant ›</button>';

      var prev=pager.querySelector('[data-pg="prev"]');
      var next=pager.querySelector('[data-pg="next"]');
      if(prev) prev.onclick=function(){ gotoPage(panelId, page-1); };
      if(next) next.onclick=function(){ gotoPage(panelId, page+1); };
      pager.querySelectorAll('.pg-num[data-page]').forEach(function(b){
        b.onclick=function(){ gotoPage(panelId, parseInt(b.getAttribute('data-page'),10)); };
      });
    }

    /* Affiche un loader (voile + spinner) sur le panel le temps du changement
       de page, puis le retire une fois les cartes rendues. La pagination est
       instantanée (côté client) : un court délai rend la transition fluide et
       professionnelle plutôt qu'un saut brutal. */
    function showPageLoader(panelId){
      var panel=document.getElementById(panelId);
      if(!panel) return null;
      var ld=panel.querySelector('.pg-loader');
      if(!ld){
        ld=document.createElement('div');
        ld.className='pg-loader';
        ld.innerHTML='<div class="pg-spinner"></div>';
        panel.appendChild(ld);
      }
      // Force le reflow pour que la transition d'opacité s'applique.
      void ld.offsetWidth;
      ld.classList.add('on');
      return ld;
    }
    function hidePageLoader(panelId){
      var panel=document.getElementById(panelId);
      var ld=panel && panel.querySelector('.pg-loader');
      if(ld) ld.classList.remove('on');
    }

    function gotoPage(panelId, page){
      showPageLoader(panelId);
      // Laisse le voile apparaître (~220ms) avant de basculer les cartes.
      setTimeout(function(){
        pageByPanel[panelId]=page;
        filterCards();
        var panel=document.getElementById(panelId);
        if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
        hidePageLoader(panelId);
      }, 220);
    }
    /* Ouvre/ferme une carte. À l'OUVERTURE d'une carte encore marquée « nouveau »,
       on la marque IMMÉDIATEMENT comme lue (serveur + interface). */
    function toggleCard(head){
      var card=head.parentElement;
      var wasClosed=!card.classList.contains('open');
      card.classList.toggle('open');
      if(wasClosed) markCardSeen(card);
    }

    /* Marque UNE carte (commande ou devis) comme lue : appel serveur, puis mise à
       jour de l'interface (badge « nouveau », pastille de la cloche, liste des
       notifications). Sans effet si la carte n'était pas « nouvelle ». */
    function markCardSeen(card){
      if(!card) return;
      var badge=card.querySelector('.badge-new');
      if(!badge) return;                                  // déjà lue

      var id=card.id||'';
      var payload={orders:[],quotes:[]};
      if(id.indexOf('card-')===0){                        // commande
        payload.orders=[id.slice(5)];
      }else if(id.indexOf('quote-')===0){                 // devis
        payload.quotes=[id.slice(6)];
      }else{
        return;
      }

      fetch('/api/admin/seen',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify(payload)
      }).then(function(r){
        /* Un 401/500 passait par ce then (fetch ne rejette que sur erreur
           réseau) : le badge disparaissait et DASH_STATE était décrémenté alors
           que la base n'avait pas bougé. L'écart désactivait en prime la
           détection de nouveautés de l'auto-refresh. */
        if(!r.ok) throw new Error('HTTP '+r.status);
        badge.remove();                                   // retire « nouveau »

        // Retire l'entrée correspondante de la liste des notifications.
        var list=document.getElementById('notif-list');
        if(list){
          var links=list.querySelectorAll('.notif');
          for(var i=0;i<links.length;i++){
            var oc=links[i].getAttribute('onclick')||'';
            if(oc.indexOf("'"+id+"'")!==-1){ links[i].remove(); break; }
          }
        }

        // Retire l'id de la liste des non-lus (pour « Tout marquer comme lu »).
        if(typeof UNSEEN==='object'&&UNSEEN){
          UNSEEN.orders=(UNSEEN.orders||[]).filter(function(x){return payload.orders.indexOf(String(x))===-1;});
          UNSEEN.quotes=(UNSEEN.quotes||[]).filter(function(x){return payload.quotes.indexOf(String(x))===-1;});
        }

        // Plus aucun « nouveau » ? -> pastille de la cloche + état vide.
        if(!document.querySelector('.badge-new')){
          var bell=document.getElementById('bell-btn');
          var dot=bell?bell.querySelector('.bell-dot'):null;
          if(dot) dot.remove();
          var clear=document.querySelector('.notif-clear');
          if(clear) clear.remove();
          if(list) list.innerHTML=
            '<div class="notif-empty"><div class="ico">&#10003;</div>'+
            '<p>Rien de nouveau.</p><small>Vous êtes à jour.</small></div>';
        }

        // L'état local suit, pour que l'auto-refresh ne recharge pas inutilement.
        if(typeof DASH_STATE==='object'&&DASH_STATE){
          if(payload.orders.length&&DASH_STATE.newOrders>0) DASH_STATE.newOrders--;
          if(payload.quotes.length&&DASH_STATE.newQuotes>0) DASH_STATE.newQuotes--;
        }
      }).catch(function(){
        /* Marquage refusé : on laisse le badge en place. L'écart avec la base
           se résorbe au prochain chargement, sans intervention. Pas de modale
           ici : l'action est implicite (ouverture d'une carte), une alerte
           serait intrusive alors que rien n'est perdu. */
      });
    }
    function zoom(u){var lb=document.getElementById('lb');document.getElementById('lb-img').src=u;lb.classList.add('open');}

    /* ── Écouteurs délégués : les données ne transitent plus par onclick ──
       Un attribut onclick est du CODE : y interpoler une valeur venant du
       formulaire public de devis permettait, avec un simple antislash final,
       de refermer la chaîne JS et d'exécuter du script arbitraire dans une
       page sans CSP. Les mêmes valeurs passent maintenant par des data-*,
       où l'échappement HTML est réellement suffisant, et sont lues ici. */
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var img = t.closest('.js-zoom');
      if (img) { zoom(img.getAttribute('data-zoom') || ''); return; }

      var inv = t.closest('.js-invoice');
      if (inv) {
        openInvoice(
          inv.getAttribute('data-qid') || '',
          inv.getAttribute('data-email') || '',
          inv.getAttribute('data-nom') || '',
          inv.getAttribute('data-produit') || '',
          inv.getAttribute('data-qty') || '1',
          inv.getAttribute('data-flock') || '0'
        );
      }
    });

    /* ── Chiffrage du devis + envoi de la facture ── */
    var invQuoteId=null, invQty=1;
    function euro(n){return n.toFixed(2).replace('.',',')+' €';}

    var invFlockCount = 0;   // nombre de pièces floquées (commande de groupe)
    function openInvoice(id,email,nom,produit,qty,flockCount){
      invQuoteId=id;
      invQty=Math.max(1,parseInt(qty,10)||1);
      invFlockCount=Math.max(0,parseInt(flockCount,10)||0);
      document.getElementById('inv-sub').textContent =
        email ? ('Destinataire : '+email) : 'Aucune adresse e-mail renseignée pour ce client.';
      document.getElementById('inv-qty').textContent = invQty;
      document.getElementById('inv-price').value='';
      document.getElementById('inv-total').textContent='—';

      // Bloc « chiffrage assisté » : visible seulement si des pièces sont floquées.
      var fb=document.getElementById('inv-flock-block');
      if(fb){
        fb.style.display = invFlockCount>0 ? 'block' : 'none';
        var fp=document.getElementById('inv-flock-price'); if(fp) fp.value='';
        var fi=document.getElementById('inv-flock-info');
        if(fi) fi.textContent = invFlockCount+' pièce(s) à floquer';
        var bd=document.getElementById('inv-breakdown'); if(bd) bd.textContent='';
      }
      /* Message provisoire, le temps que le serveur rende le vrai. Il évite un
         champ vide pendant la requête, et sert de repli si elle échoue. */
      document.getElementById('inv-msg').value =
        'Bonjour '+(nom||'')+',\\n\\n'+
        'Voici votre devis pour '+(produit||'votre commande personnalisée')+'. '+
        'Vous pouvez le régler directement via le lien ci-dessous.\\n\\n'+
        'Merci de votre confiance.\\nL\\'équipe Massacre Officiel';

      /* LE MESSAGE RÉEL, rendu par le serveur avec les données de CE devis.
         Ce qui s'affiche ici est exactement ce que recevra le client.

         Remplace un montage qui demandait l'APERÇU (avec ses variables
         d'exemple : Jean Dupont, 125,00 €…) puis tentait d'y substituer les
         vraies valeurs par recherche-remplacement. Un remplacement global du
         chiffre 5 par la quantité touchait TOUT le message : « 125,00 € » devenait
         « 123,00 € » pour une quantité de 3. Et faute de total réel, le montant
         d'exemple partait tel quel au client. */
      if (invQuoteId) {
        fetch('/api/admin/message-templates/render/'+encodeURIComponent(invQuoteId),
              {credentials:'same-origin'})
          .then(function(r){return r.json();})
          .then(function(d){
            if(d.ok && d.message) document.getElementById('inv-msg').value = d.message;
          })
          .catch(function(){
            /* Le message provisoire reste en place : l'admin peut l'ajuster et
               envoyer. Ne jamais bloquer la facturation pour un pré-remplissage. */
          });
      }
      var st=document.getElementById('inv-status');
      st.textContent=''; st.className='hint';
      var btn=document.getElementById('inv-send');
      btn.disabled=false; btn.textContent='Envoyer la facture';
      document.getElementById('inv-modal').classList.add('open');
      setTimeout(function(){document.getElementById('inv-price').focus();},60);
    }

    function updateInvoiceTotal(){
      var p=parseFloat(document.getElementById('inv-price').value);
      var base=(isFinite(p) && p>0) ? p*invQty : 0;

      // Chiffrage assisté : ajoute (prix flocage × nb de pièces floquées).
      var flockTotal=0, flockUnit=0;
      if(invFlockCount>0){
        var fp=document.getElementById('inv-flock-price');
        flockUnit=fp ? parseFloat(fp.value) : NaN;
        if(isFinite(flockUnit) && flockUnit>=0) flockTotal=flockUnit*invFlockCount;
      }

      var grand=base+flockTotal;
      var totalEl=document.getElementById('inv-total');
      totalEl.textContent = base>0 ? euro(grand) : '—';

      // Détail du calcul (transparence).
      var bd=document.getElementById('inv-breakdown');
      if(bd && invFlockCount>0){
        if(base>0){
          var unitAvg = grand/invQty;               // prix unitaire moyen
          var unitRounded = Math.round(unitAvg*100)/100;
          var shopifyTotal = unitRounded*invQty;    // ce que Shopify facturera
          var diff = Math.round((shopifyTotal-grand)*100)/100;
          bd.innerHTML='Base : '+euro(p||0)+' × '+invQty+' = <strong>'+euro(base)+'</strong>'+
            (flockTotal>0 ? ' · Flocage : '+euro(flockUnit)+' × '+invFlockCount+' = <strong>'+euro(flockTotal)+'</strong>' : '')+
            ' → Prix unitaire : <strong>'+euro(unitRounded)+'</strong>'+
            (Math.abs(diff)>=0.01 ? ' <span style="color:var(--warn)">(total facturé '+euro(shopifyTotal)+', soit '+(diff>0?'+':'')+euro(diff)+' d\\'arrondi)</span>' : '');
        } else {
          bd.textContent='Saisissez le prix unitaire pour calculer le total.';
        }
      }

      // Prix unitaire moyen mémorisé pour l'envoi (Shopify facture unit × qty).
      window._invUnitToSend = (base>0) ? (grand/invQty) : 0;
    }

    function closeInvoice(){
      document.getElementById('inv-modal').classList.remove('open');
      // Nettoie les pièces jointes temporaires
      window.invoiceAttachments = [];
      updateAttachmentsList();
      invQuoteId=null;
    }

    /* ── Gestion des pièces jointes ── */
    window.invoiceAttachments = [];  // Stockage des fichiers uploadés

    function formatFileSize(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getFileIcon(type) {
      if (type.startsWith('image/')) return 'img';
      if (type === 'application/pdf') return 'pdf';
      if (type.includes('word') || type.includes('document')) return 'doc';
      if (type.includes('sheet') || type.includes('excel')) return 'xls';
      return 'file';
    }

    function updateAttachmentsList() {
      const list = document.getElementById('inv-files-list');
      const status = document.getElementById('inv-upload-status');
      
      if (!window.invoiceAttachments || window.invoiceAttachments.length === 0) {
        list.style.display = 'none';
        status.style.display = 'none';
        return;
      }

      list.style.display = 'block';
      list.innerHTML = window.invoiceAttachments.map((file, index) => {
        const icon = getFileIcon(file.type);
        const statusClass = file.error ? 'error' : (file.uploaded ? 'uploaded' : 'uploading');
        
        return [
          '<div class="file-item ' + statusClass + '">',
          '  <div class="file-icon ' + icon + '">' + icon.toUpperCase()[0] + '</div>',
          '  <div class="file-info">',
          '    <div class="file-name" title="' + escapeHtml(file.name) + '">' + escapeHtml(file.name) + '</div>',
          '    <div class="file-size">' + formatFileSize(file.size || 0) + (file.error ? ' - ' + file.error : '') + '</div>',
          '    ' + (!file.uploaded && !file.error ? '<div class="upload-progress"><div class="upload-bar" style="width:' + (file.progress || 0) + '%"></div></div>' : ''),
          '  </div>',
          '  <div class="file-actions">',
          '    <button type="button" class="file-remove" onclick="removeAttachment(' + index + ')" title="Supprimer">×</button>',
          '  </div>',
          '</div>'
        ].join('');
      }).join('');

      // Status global
      const uploaded = window.invoiceAttachments.filter(f => f.uploaded).length;
      const total = window.invoiceAttachments.length;
      const errors = window.invoiceAttachments.filter(f => f.error).length;
      
      if (errors > 0) {
        status.className = 'hint err';
        status.textContent = errors + ' fichier' + (errors > 1 ? 's' : '') + ' en erreur sur ' + total;
        status.style.display = 'block';
      } else if (uploaded === total && total > 0) {
        status.className = 'hint ok';
        status.textContent = uploaded + ' fichier' + (uploaded > 1 ? 's' : '') + ' prêt' + (uploaded > 1 ? 's' : '') + ' à envoyer';
        status.style.display = 'block';
      } else if (uploaded < total) {
        status.className = 'hint';
        status.textContent = 'Upload en cours... ' + uploaded + '/' + total;
        status.style.display = 'block';
      } else {
        status.style.display = 'none';
      }
    }

    function removeAttachment(index) {
      if (window.invoiceAttachments && window.invoiceAttachments[index]) {
        window.invoiceAttachments.splice(index, 1);
        updateAttachmentsList();
      }
    }

    async function uploadFile(file) {
      // Validation côté client
      if (file.size > 10 * 1024 * 1024) {
        return { error: 'Fichier trop volumineux (max 10 MB)' };
      }

      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        return { error: 'Type de fichier non autorisé' };
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await fetch('/api/uploads/quote-attachment', {
          method: 'POST',
          body: formData
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          return { error: error.message || "Erreur d'upload" };
        }

        const result = await response.json();
        return {
          name: result.name || file.name,
          url: result.url,
          type: result.type || file.type,
          size: result.size || file.size
        };
      } catch (e) {
        return { error: 'Erreur réseau: ' + e.message };
      }
    }

    async function handleFiles(files) {
      if (!files || files.length === 0) return;

      // Limite à 5 fichiers au total
      const currentCount = window.invoiceAttachments ? window.invoiceAttachments.length : 0;
      const filesToProcess = Array.from(files).slice(0, 5 - currentCount);
      
      if (filesToProcess.length < files.length) {
        document.getElementById('inv-upload-status').textContent = 'Maximum 5 fichiers autorisés';
        document.getElementById('inv-upload-status').className = 'hint err';
        document.getElementById('inv-upload-status').style.display = 'block';
      }

      for (const file of filesToProcess) {
        const fileObj = {
          name: file.name,
          type: file.type,
          size: file.size,
          progress: 0,
          uploaded: false,
          error: null
        };

        window.invoiceAttachments.push(fileObj);
        updateAttachmentsList();

        // Upload async
        const result = await uploadFile(file);
        const index = window.invoiceAttachments.length - 1;
        
        if (result.error) {
          window.invoiceAttachments[index].error = result.error;
        } else {
          window.invoiceAttachments[index] = {
            ...window.invoiceAttachments[index],
            ...result,
            uploaded: true,
            progress: 100
          };
        }
        
        updateAttachmentsList();
      }
    }

    function handleFileSelect(event) {
      handleFiles(event.target.files);
      event.target.value = ''; // Reset pour permettre le même fichier
    }

    function handleDragOver(event) {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('inv-drop-zone').classList.add('drag-over');
    }

    function handleDragLeave(event) {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('inv-drop-zone').classList.remove('drag-over');
    }

    function handleFileDrop(event) {
      event.preventDefault();
      event.stopPropagation();
      document.getElementById('inv-drop-zone').classList.remove('drag-over');
      handleFiles(event.dataTransfer.files);
    }

    function sendInvoice(){
      if(!invQuoteId) return;
      var btn=document.getElementById('inv-send');
      var st=document.getElementById('inv-status');
      var price=parseFloat(document.getElementById('inv-price').value);

      if(!isFinite(price) || price<=0){
        st.className='hint err';
        st.textContent='Indiquez un prix unitaire supérieur à 0.';
        document.getElementById('inv-price').focus();
        return;
      }

      // Commande de groupe avec flocage : on facture le prix unitaire MOYEN
      // (base + flocages réparti sur toutes les pièces), calculé en direct.
      var unitToSend = price;
      if(invFlockCount>0){
        updateInvoiceTotal();
        if(window._invUnitToSend>0) unitToSend = window._invUnitToSend;
      }

      btn.disabled=true; btn.textContent='Envoi…';
      st.className='hint'; st.textContent='Application du prix, puis envoi…';

      fetch('/api/admin/quotes/'+encodeURIComponent(invQuoteId)+'/invoice',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          unitPrice:unitToSend,
          message:document.getElementById('inv-msg').value,
          attachments: window.invoiceAttachments || []
        })
      })
      .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
      .then(function(res){
        if(res.ok && res.body.ok){
          st.className='hint ok';
          st.textContent='Facture envoyée'+(res.body.to?(' à '+res.body.to):'')+
            (res.body.total?(' — total '+String(res.body.total).replace('.',',')+' €'):'')+'.';
          btn.textContent='Envoyée';
          setTimeout(function(){closeInvoice();location.reload();},1800);
        }else{
          st.className='hint err';
          st.textContent=(res.body && res.body.error) || "L'envoi a échoué.";
          btn.disabled=false; btn.textContent='Réessayer';
        }
      })
      .catch(function(e){
        st.className='hint err';
        st.textContent='Erreur réseau : '+e.message;
        btn.disabled=false; btn.textContent='Réessayer';
      });
    }

    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){
        document.getElementById('lb').classList.remove('open');
        closeInvoice();
      }
    });

    /* Filet de securite pour le champ de recherche.

       La cause du pre-remplissage est traitee dans le HTML : le champ et les
       champs mot de passe de la modale « Mon compte » vivent desormais chacun
       dans leur propre <form>, ce qui empeche le navigateur de les associer.

       Ce qui suit ne couvre plus que le cas residuel : une valeur restauree
       au retour arriere, ou un gestionnaire tiers qui ignore autocomplete.

       Remplacait une pile bien plus lourde (readonly leve apres 1 s, name
       aleatoire, MutationObserver, intervalle de 200 ms) qui traitait le
       symptome sans jamais l atteindre. L observateur, en particulier,
       surveillait l attribut value alors que le navigateur ecrit la propriete :
       il ne s est jamais declenche. */
    (function(){
      var s=document.getElementById('search');
      if(!s) return;

      /* Vrai des que l utilisateur a saisi quelque chose. Pas d ecouteur
         'input' : le navigateur le declenche AUSSI pour son autocompletion,
         ce qui desarmait le nettoyage. */
      var typed=false;
      s.addEventListener('keydown', function(e){
        if(e.key && e.key.length===1) typed=true;
        else if(e.key==='Backspace'||e.key==='Delete') typed=true;
      });
      s.addEventListener('paste',            function(){ typed=true; });
      s.addEventListener('compositionstart', function(){ typed=true; });

      var clear=function(){
        if(!typed && s.value){ s.value=''; filterCards(true); }
      };

      clear();
      /* pageshow couvre le retour arriere : le navigateur restaure alors les
         valeurs de formulaire, y compris celles qu on vient d effacer. */
      window.addEventListener('pageshow', function(){ typed=false; clear(); });
    })();

    filterCards(true);

    /* ── Messages clients ───────────────────────────────────────────────
       Un modèle par type, édité sur place. Remplace douze fonctions et trois
       modales imbriquées qui administraient des modèles multiples dont un seul
       partait jamais (celui marqué par défaut, seul lu par getDefaultTemplate).

       Le parcours passe de six à neuf clics à trois : ouvrir, éditer,
       enregistrer. */
    var currentMessageType = 'invoice';

    /* Le texte tel qu'il est en base, par type. Évite de relire le serveur à
       chaque bascule d'onglet — et permet de savoir si quelque chose a changé. */
    var messagesCharges = {};

    /* Valeurs d'exemple de l'aperçu. Côté navigateur : l'aperçu suit la frappe,
       aucune requête n'est utile. Elles doivent rester alignées sur celles du
       serveur (admin.controller.ts, route preview). */
    var EXEMPLE_VARS = {
      '{nom}': 'Jean Dupont',
      '{produit}': 'T-shirt Coton personnalisé',
      '{quantite}': '50',
      '{total}': '625,00 €',
      '{entreprise}': 'Massacre Officiel'
    };

    function openMessages(){
      document.getElementById('msg-modal').classList.add('open');
      switchMessageType(currentMessageType);
    }

    function closeMessages(){
      document.getElementById('msg-modal').classList.remove('open');
    }

    function switchMessageType(type){
      currentMessageType = type;

      var onglets = document.querySelectorAll('#msg-modal .tab');
      for (var i = 0; i < onglets.length; i++){
        onglets[i].classList.toggle('active', onglets[i].id === 'tab-' + type);
      }

      document.getElementById('msg-label').textContent =
        type === 'invoice' ? 'Message envoyé avec le devis'
                           : 'Message de relance, si le devis reste impayé';

      var st = document.getElementById('msg-status');
      st.textContent = ''; st.className = 'hint';

      var champ = document.getElementById('msg-content');

      /* Déjà chargé : on repose le texte sans requête. */
      if (typeof messagesCharges[type] === 'string'){
        champ.value = messagesCharges[type];
        majApercu();
        return;
      }

      champ.value = '';
      document.getElementById('msg-preview').textContent = 'Chargement…';

      fetch('/api/admin/message-templates/' + type, {credentials:'same-origin'})
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(!d.ok) throw new Error(d.error || 'Chargement impossible.');
          var liste = d.templates || [];
          /* Le modèle par défaut est le seul que le serveur envoie jamais :
             c'est donc lui qu'on édite. À défaut, le premier venu. */
          var modele = null;
          for (var i = 0; i < liste.length; i++){
            if (liste[i].isDefault){ modele = liste[i]; break; }
          }
          if (!modele && liste.length) modele = liste[0];

          messagesCharges[type] = modele ? (modele.content || '') : '';
          if (modele && modele.id) messagesCharges[type + ':id'] = modele.id;
          if (modele && modele.name) messagesCharges[type + ':nom'] = modele.name;

          if (currentMessageType === type){
            champ.value = messagesCharges[type];
            majApercu();
          }
        })
        .catch(function(e){
          if (currentMessageType !== type) return;
          document.getElementById('msg-preview').textContent = '';
          st.textContent = 'Chargement impossible : ' + e.message;
          st.className = 'hint err';
        });
    }

    /** Insère une variable au curseur, puis rend la main au champ. */
    function insertVar(jeton){
      var champ = document.getElementById('msg-content');
      var debut = champ.selectionStart || 0;
      var fin = champ.selectionEnd || 0;
      champ.value = champ.value.slice(0, debut) + jeton + champ.value.slice(fin);
      /* Le curseur se replace APRÈS le jeton : on continue de taper dans la
         foulée, sans reprendre la souris. */
      var pos = debut + jeton.length;
      champ.focus();
      champ.setSelectionRange(pos, pos);
      majApercu();
    }

    /** Remplace les variables par leurs valeurs d'exemple, sous le champ. */
    function majApercu(){
      var texte = document.getElementById('msg-content').value || '';
      for (var jeton in EXEMPLE_VARS){
        if (!Object.prototype.hasOwnProperty.call(EXEMPLE_VARS, jeton)) continue;
        texte = texte.split(jeton).join(EXEMPLE_VARS[jeton]);
      }
      var vue = document.getElementById('msg-preview');
      vue.textContent = texte.trim() || 'Le message est vide.';
      vue.classList.toggle('is-empty', !texte.trim());
    }

    function saveMessage(){
      var type = currentMessageType;
      var contenu = (document.getElementById('msg-content').value || '').trim();
      var st = document.getElementById('msg-status');
      var btn = document.getElementById('msg-save');

      if(!contenu){
        st.textContent = 'Le message ne peut pas être vide.';
        st.className = 'hint err';
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Enregistrement…';

      var charge = {
        type: type,
        name: messagesCharges[type + ':nom'] ||
              (type === 'invoice' ? 'Message de devis' : 'Message de relance'),
        content: contenu,
        isActive: true,
        /* Toujours par défaut : c'est le seul modèle du type, et getDefaultTemplate
           ne lit que celui-là. Un modèle non-défaut ne partirait jamais. */
        isDefault: true
      };
      if (messagesCharges[type + ':id']) charge.id = messagesCharges[type + ':id'];

      fetch('/api/admin/message-templates', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(charge)
      })
        .then(function(r){ return r.json(); })
        .then(function(d){
          if(!d.ok) throw new Error(d.error || 'Enregistrement refusé.');
          messagesCharges[type] = contenu;
          if (d.template && d.template.id) messagesCharges[type + ':id'] = d.template.id;
          st.textContent = 'Message enregistré.';
          st.className = 'hint ok';
        })
        .catch(function(e){
          st.textContent = e.message;
          st.className = 'hint err';
        })
        .finally(function(){
          btn.disabled = false;
          btn.textContent = 'Enregistrer';
        });
    }

    /* Conservée : utilisée aussi par la liste des pièces jointes d'un devis. */
    function escapeHtml(text){
      var div=document.createElement('div');
      div.textContent=text;
      return div.innerHTML;
    }
  </script>`, nonce);
}
