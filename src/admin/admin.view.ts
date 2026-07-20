/**
 * Rendu HTML du dashboard admin (page autonome, styles inline).
 * UI de production : scan rapide des commandes, détail dépliable, dark/light.
 */
import { Order } from '../database/entities/order.entity';
import { Quote } from '../database/entities/quote.entity';
import { Design } from '../database/entities/design.entity';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string),
  );
}
function isImg(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u) && /\.(png|jpe?g|webp|gif|svg)/i.test(u);
}
function isUrl(u: unknown): u is string {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}
function money(amount: unknown): string {
  const n = parseFloat(String(amount ?? ''));
  if (Number.isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',') + ' €';
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
@media (prefers-color-scheme:dark){
  :root{
    --paper:#16181c; --surface:#1d2025; --raise:#23272e;
    --ink:#eceae5; --muted:#9a938a; --faint:#6a655d;
    --line:#2c3037; --line-soft:#24272d;
    --accent:#f4763e; --accent-soft:#3a251c;
    --ok:#6fbf83; --ok-soft:#1f2f24;
    --warn:#e0a95c; --warn-soft:#332a19;
    --danger:#f0705f; --danger-soft:#3a1f1c;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 30px rgba(0,0,0,.35);
    --shadow-hover:0 2px 6px rgba(0,0,0,.4),0 18px 40px rgba(0,0,0,.5);
  }
}
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
:root[data-theme="dark"]{
  --paper:#16181c; --surface:#1d2025; --raise:#23272e;
  --ink:#eceae5; --muted:#9a938a; --faint:#6a655d;
  --line:#2c3037; --line-soft:#24272d;
  --accent:#f4763e; --accent-soft:#3a251c;
  --ok:#6fbf83; --ok-soft:#1f2f24; --warn:#e0a95c; --warn-soft:#332a19;
  --danger:#f0705f; --danger-soft:#3a1f1c;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 30px rgba(0,0,0,.35);
  --shadow-hover:0 2px 6px rgba(0,0,0,.4),0 18px 40px rgba(0,0,0,.5);
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

.wrap{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,34px) clamp(16px,4vw,32px) 80px}

/* Stat strip */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px}
.stat{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:16px 18px;box-shadow:var(--shadow);
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  transition:border-color .15s, transform .15s;
}
.stat:hover{border-color:var(--accent);transform:translateY(-1px)}
.stat-body{min-width:0}
.stat .num{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1}
.stat .cap{margin-top:6px;color:var(--muted);font-size:12px}
.stat.accent .num{color:var(--accent)}
/* Médaillon de l'icône : discret par défaut, coloré sur la carte accentuée. */
.stat-ico{
  flex:none;width:40px;height:40px;border-radius:11px;
  display:grid;place-items:center;
  background:var(--raise);color:var(--muted);
}
.stat-ico svg{width:20px;height:20px}
.stat.accent .stat-ico{background:rgba(194,65,12,.12);color:var(--accent)}
.stat:hover .stat-ico{color:var(--accent)}

/* Tabs */
.tabs{display:inline-flex;background:var(--raise);border-radius:11px;padding:4px;gap:2px;margin-bottom:16px}
.tab{
  border:none;background:none;cursor:pointer;font:inherit;
  padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;color:var(--muted);
  display:inline-flex;align-items:center;gap:8px;transition:.15s;
}
.tab:hover{color:var(--ink)}
.tab.active{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.tab .count{font-size:11px;font-weight:700;color:var(--faint)}
.tab.active .count{color:var(--accent)}

/* Toolbar */
.toolbar{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.search{position:relative;flex:1;min-width:220px}
.search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--faint)}
.search input{
  width:100%;padding:11px 14px 11px 38px;border:1px solid var(--line);border-radius:10px;
  background:var(--surface);color:var(--ink);font:inherit;font-size:13.5px;outline:none;transition:.15s;
}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.search input::placeholder{color:var(--faint)}
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
.avatar{
  width:38px;height:38px;border-radius:10px;flex-shrink:0;
  background:var(--accent-soft);color:var(--accent);
  display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;
}
.head .id{font-size:15px;font-weight:800;letter-spacing:-.01em;display:flex;align-items:center;gap:7px}
.head .sub{color:var(--muted);font-size:12.5px;margin-top:2px}
.head .right{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:5px}
.amount{font-size:15px;font-weight:800;letter-spacing:-.01em}
.when{color:var(--faint);font-size:11.5px}
.caret{color:var(--faint);transition:transform .2s;flex-shrink:0;margin-left:2px}
.card.open .caret{transform:rotate(90deg);color:var(--accent)}

/* Status pill */
.pill{
  display:inline-flex;align-items:center;gap:5px;
  font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:.01em;
}
.pill::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.pill.ok{background:var(--ok-soft);color:var(--ok)}
.pill.warn{background:var(--warn-soft);color:var(--warn)}
.pill.neutral{background:var(--raise);color:var(--muted)}

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

/* Suivi de production */
.pills{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.pill.prod::before{width:6px;height:6px}
.pill.prod.todo{background:var(--raise);color:var(--muted)}
.pill.prod.doing{background:var(--warn-soft);color:var(--warn)}
.pill.prod.ready{background:#e6eefc;color:#2b57c4}
.pill.prod.done{background:var(--ok-soft);color:var(--ok)}
:root[data-theme="dark"] .pill.prod.ready{background:#1c2740;color:#7fa4f0}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .pill.prod.ready{background:#1c2740;color:#7fa4f0}}

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
.bell-dot{
  position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;
  background:var(--accent);color:#fff;border-radius:9px;
  font-size:10.5px;font-weight:800;line-height:17px;text-align:center;
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
.grp-list tfoot td{font-weight:800;background:var(--raise)}
.grp-list .empty{color:var(--faint)}

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
.price-field{display:flex;align-items:center;gap:8px;flex:none}
.price-field .price-input{width:110px;text-align:right;font-size:14px}
.price-cur{font-size:11.5px;color:var(--faint);font-weight:700;min-width:34px}

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
    grid-column:1/-1;width:100%;text-align:left;
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

  /* — Stats : 2 colonnes. Le chiffre est réduit et ne se coupe plus
       (« 4510,60 € » passait sur 2 lignes). — */
  .stats{grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px}
  .stat{padding:13px;gap:8px}
  .stat-body{min-width:0}
  .stat .num{font-size:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stat .cap{font-size:11px}
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

@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function shell(body: string): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Administration — Custom Textile</title>
<style>${STYLE}</style></head><body>${body}
<script>
(function(){
  // Thème mémorisé
  var KEY='ct_admin_theme';
  try{var t=localStorage.getItem(KEY);if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}
  window.toggleTheme=function(){
    var cur=document.documentElement.getAttribute('data-theme');
    var next=cur==='dark'?'light':(cur==='light'?'dark':(matchMedia('(prefers-color-scheme:dark)').matches?'light':'dark'));
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
export function loginPage(error?: boolean, reason?: 'blocked'): string {
  return shell(`
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div style="width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:32px;box-shadow:var(--shadow)">
      <div class="brand" style="margin-bottom:22px">
        <div class="brand-mark">✦</div>
        <div class="brand-txt"><b>Custom Textile</b><span>Espace de production</span></div>
      </div>
      <h1 style="font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Connexion</h1>
      <p style="font-size:13px;color:var(--muted);margin-bottom:20px">Accès réservé à l'équipe.</p>
      ${error ? '<p style="color:var(--accent);font-size:12.5px;background:var(--accent-soft);padding:9px 12px;border-radius:9px;margin-bottom:14px">E-mail ou mot de passe incorrect, ou compte bloqué.</p>' : ''}
      ${reason === 'blocked' ? '<p style="color:var(--danger);font-size:12.5px;background:var(--danger-soft);padding:9px 12px;border-radius:9px;margin-bottom:14px">Votre session a pris fin : votre accès a été suspendu. Contactez l’administrateur principal.</p>' : ''}
      <form method="post" action="/api/admin/login">
        <label class="lbl" style="display:block;margin-bottom:6px">E-mail</label>
        <input name="email" type="email" autocomplete="username" required autofocus
          style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--paper);color:var(--ink);font:inherit;font-size:14px;outline:none;margin-bottom:14px">
        <label class="lbl" style="display:block;margin-bottom:6px">Mot de passe</label>
        <input name="password" type="password" autocomplete="current-password" required
          style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--paper);color:var(--ink);font:inherit;font-size:14px;outline:none;margin-bottom:16px">
        <button type="submit"
          style="width:100%;padding:12px;border:none;border-radius:11px;background:var(--accent);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer">Se connecter</button>
      </form>
    </div>
  </div>`);
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
  const [label, cls] = map[prod] || map.to_produce;
  const t = o.trackingNumber ? ` title="Suivi : ${esc(o.trackingNumber)}"` : '';
  return `<span class="pill ${cls}"${t}>Shopify : ${label}</span>`;
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
    ? `<div class="thumbs">${imgs.map((p) => `<img class="thumb" src="${esc(p.value)}" title="${esc(p.name)}" onclick="zoom('${esc(p.value)}')" alt="${esc(p.name)}">`).join('')}</div>`
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

/** Atelier / à fabriquer : machine à coudre stylisée (aiguille + fil). */
const ICO_MAKE = svg(
  '<path d="M3 20h18"/><path d="M6 20v-5a3 3 0 013-3h7"/><path d="M16 5v7"/><circle cx="16" cy="4" r="1.6"/><path d="M9 12V9a3 3 0 016 0"/>',
);
/** Commandes reçues : carton. */
const ICO_BOX = svg(
  '<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
);
/** Chiffre d'affaires : euro. */
const ICO_EURO = svg(
  '<path d="M17 6.3A6.5 6.5 0 007.5 12a6.5 6.5 0 009.5 5.7"/><path d="M4 10.5h8"/><path d="M4 13.5h8"/>',
);
/** Devis : enveloppe. */
const ICO_QUOTE = svg(
  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
);

/** Carte du bandeau de statistiques : valeur, libellé et icône. */
function statCard(
  value: string | number,
  caption: string,
  icon: string,
  cls = '',
): string {
  return `<div class="stat ${cls}">
    <div class="stat-body">
      <div class="num mono">${value}</div>
      <div class="cap">${caption}</div>
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

function orderCard(o: Order): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const nbItems = items.reduce((s: number, li: any) => s + (li.quantity || 0), 0);
  const productNames = items.map((li: any) => li.title).filter(Boolean);
  const summary = productNames.length
    ? productNames.slice(0, 2).join(', ') + (productNames.length > 2 ? `…` : '')
    : `${nbItems} article(s)`;
  const search = esc([o.orderNumber, o.customerName, o.customerEmail, ...productNames].join(' ').toLowerCase());
  const prod = o.productionStatus || 'to_produce';
  const id = esc(o.shopifyOrderId);

  return `<div class="card" data-search="${search}" data-prod="${esc(prod)}" id="card-${id}">
    <div class="head" onclick="toggleCard(this)">
      <div class="avatar">${esc(initials(o.customerName))}</div>
      <div>
        <div class="id mono">${esc(o.orderNumber || '#' + o.shopifyOrderId)}
          ${o.seen ? '' : '<span class="badge-new">nouveau</span>'}
          <svg class="caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>
        <div class="sub">${esc(o.customerName || 'Client')} · ${esc(summary)} · ${nbItems} art.</div>
      </div>
      <div class="right">
        <div class="pills">${prodPill(prod)}${shipPill(o)}${statusPill(o.financialStatus)}</div>
        <div class="amount mono">${money(o.totalPrice)}</div>
        <div class="when mono">${fdate(o.shopifyCreatedAt)} · ${ftime(o.shopifyCreatedAt)}</div>
      </div>
    </div>

    <div class="body">
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

      <div class="section-lbl lbl">Articles à produire</div>
      ${items.map(itemRow).join('') || '<div class="kv"><span class="empty">Aucun article.</span></div>'}

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

/** Statut lisible d'un devis + pastille. */
function quoteStatus(q: Quote): { key: string; pill: string } {
  const s = q.draftStatus || 'open';
  if (s === 'completed') {
    return { key: 'paid', pill: `<span class="pill ok">Payé</span>` };
  }
  if (s === 'invoice_sent') {
    return { key: 'sent', pill: `<span class="pill warn">Facture envoyée</span>` };
  }
  return { key: 'open', pill: `<span class="pill neutral">À chiffrer</span>` };
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

/** Rend le tableau croisé + la liste des flocages en HTML (carte et fiche). */
function groupSummaryHtml(rows: any[]): string {
  const agg = groupAggregate(rows);
  if (!agg.matrix.length) return '';

  const head =
    `<tr><th>Couleur</th>${agg.sizes
      .map((s) => `<th class="num">${esc(s)}</th>`)
      .join('')}<th class="num">Total</th></tr>`;

  const body = agg.matrix
    .map(
      (m) =>
        `<tr><td>${esc(m.color)}</td>${agg.sizes
          .map((s) => {
            const n = m.counts[s] || 0;
            return `<td class="num${n ? '' : ' zero'}">${n || '·'}</td>`;
          })
          .join('')}<td class="num tot">${m.total}</td></tr>`,
    )
    .join('');

  const foot =
    `<tr><td>Total</td>${agg.sizes
      .map((s) => `<td class="num tot">${agg.colTotals[s] || 0}</td>`)
      .join('')}<td class="num tot">${agg.grandTotal}</td></tr>`;

  const flocksHtml = agg.flocks.length
    ? `<div class="grp-flocks">
         <div class="grp-flocks-lbl">Flocages (${agg.flocks.length})</div>
         <div class="grp-flock-list">${agg.flocks
           .map(
             (f) =>
               `<span class="grp-flock">${
                 f.name ? esc(f.name) + ' → ' : ''
               }<strong>${esc(f.text)}</strong> <em>${esc(f.size)}/${esc(
                 f.color,
               )}</em></span>`,
           )
           .join('')}</div>
       </div>`
    : '';

  return `<div class="grp-agg-wrap">
    <table class="grp-agg">
      <thead>${head}</thead>
      <tbody>${body}</tbody>
      <tfoot>${foot}</tfoot>
    </table>
  </div>${flocksHtml}`;
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
    ? `<div class="thumbs">${imgs.map((u) => `<img class="thumb" src="${esc(u)}" onclick="zoom('${esc(u)}')" alt="aperçu">`).join('')}</div>`
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
          ? `<div class="section-lbl lbl">Récap production (par taille / couleur)</div>
      ${groupSummaryHtml(groupRows)}
      <div class="section-lbl lbl">Liste détaillée (${group.hasFlock ? 'flocage à chiffrer' : 'sans flocage'})</div>
      <div class="grp-list-wrap">
        <table class="grp-list">
          <thead><tr><th>Nom / réf.</th><th>Taille</th><th>Couleur</th><th>Floquage</th><th class="num">Qté</th></tr></thead>
          <tbody>
            ${groupRows
              .map(
                (r) => `<tr>
                  <td>${esc(r.name || '—')}</td>
                  <td>${esc(r.size || '')}</td>
                  <td>${esc(r.color || '')}</td>
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
              : `<button class="btn primary" onclick="openInvoice('${esc(q.id)}','${esc(c.email || '')}','${esc(c.nom || '')}','${esc(group ? group.productLabel || 'Commande de groupe' : coin.name || '')}',${group ? Number(group.pieces) || groupRows.reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0) : Number(coin.qty) || 1},${group ? groupRows.filter((r: any) => r.flock).reduce((s: number, r: any) => s + (Number(r.qty) || 0), 0) : 0})">
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
export function productionSheetPage(o: Order): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const info: any = o.customerInfo || {};
  const s = info.shipping || info.billing || {};
  const addr = [s.address1, s.address2, [s.zip, s.city].filter(Boolean).join(' '), s.country]
    .filter(Boolean)
    .map(esc)
    .join(', ');

  const itemsHtml = items
    .map((li: any, idx: number) => {
      const props: Array<{ name: string; value: string }> = Array.isArray(li.properties) ? li.properties : [];
      const imgs = props.filter((p) => isImg(p.value));
      const texts = props.filter((p) => !isUrl(p.value));
      return `<section class="ps-item">
        <div class="ps-item-head">
          <span class="ps-num">${idx + 1}</span>
          <h2>${esc(li.title)}${li.variantTitle ? ` · ${esc(li.variantTitle)}` : ''}</h2>
          <span class="ps-qty">× ${esc(li.quantity)}</span>
        </div>
        <div class="ps-specs">
          ${texts.map((p) => `<div><b>${esc(p.name)}</b><span>${esc(p.value)}</span></div>`).join('') || '<div><span>Aucune spécification.</span></div>'}
        </div>
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
<style>
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
  .ps-visuals{display:flex;gap:14px;flex-wrap:wrap}
  .ps-visuals figure{width:190px}
  .ps-visuals img{width:100%;height:190px;object-fit:contain;border:1px solid #e4e0d9;
    border-radius:8px;background:#faf9f7}
  .ps-visuals figcaption{font-size:10.5px;color:#8b8478;text-align:center;margin-top:5px;font-weight:600}
  .ps-none{font-size:12.5px;color:#a29a8e}
  footer.ps-foot{margin-top:22px;padding-top:12px;border-top:1px solid #e4e0d9;
    font-size:11px;color:#a29a8e;display:flex;justify-content:space-between}
  @media print{
    body{background:#fff;padding:0}
    .toolbar{display:none}
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
export function groupSheetPage(q: Quote): string {
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
<style>
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
                `<tr><td>${i + 1}</td><td>${esc(r.name || '—')}</td><td>${esc(r.size || '')}</td><td>${esc(r.color || '')}</td><td>${r.flock ? esc(r.flock) : '—'}</td><td class="num">${esc(r.qty || 1)}</td></tr>`,
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
        `<tr><td>${esc(m.color)}</td>${agg.sizes
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
  } = {},
): string {
  const me = extra.me;
  const isOwner = me?.role === 'owner';
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

  const revenue = orders.reduce((s, o) => s + (parseFloat(String(o.totalPrice || '')) || 0), 0);
  // Devis : « à traiter » (à chiffrer ou facture envoyée) vs « payés ».
  const isGroupQuote = (q: Quote): boolean => {
    const d: any = q.quoteData || {};
    return d.group !== null && d.group !== undefined;
  };
  const nbPaid = quotes.filter((q) => q.draftStatus === 'completed').length;
  // « À traiter » exclut les groupes (onglet dédié) : le compteur doit refléter
  // exactement ce que le filtre affiche, sinon la puce promet plus de résultats
  // qu'elle n'en montre.
  const nbOpen = quotes.filter(
    (q) => q.draftStatus !== 'completed' && !isGroupQuote(q),
  ).length;
  // Commandes de groupe : comptage séparé pour affichage distinct.
  const nbGroup = quotes.filter(isGroupQuote).length;
  // Commandes : comptage par étape de production (pour les filtres).
  const prodCounts: Record<string, number> = {};
  orders.forEach((o) => {
    const k = o.productionStatus || 'to_produce';
    prodCounts[k] = (prodCounts[k] || 0) + 1;
  });
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
      <div class="brand-mark">✦</div>
      <div class="brand-txt"><b>Custom Textile</b><span>Production &amp; commandes</span></div>
    </div>
    <div class="topbar-actions">
      <div class="bell-wrap">
        <button class="theme-btn" id="bell-btn" onclick="toggleNotifs(event)" title="Nouveautés depuis votre dernière visite">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0"/></svg>
          ${nbNew ? `<span class="bell-dot">${nbNew}</span>` : ''}
        </button>
        <div class="notif-pop" id="notif-pop">
          <div class="notif-head">
            <b>Notifications</b>
            ${nbNew ? `<button class="notif-clear" onclick="markSeen()">Tout marquer comme lu</button>` : ''}
          </div>
          <div class="notif-list" id="notif-list">${notifList}</div>
        </div>
      </div>
      <button class="theme-btn" onclick="openPricing()" title="Modifier les prix du configurateur">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 7a6 6 0 1 0 0 10"/>
          <path d="M6 10h8"/>
          <path d="M6 14h8"/>
        </svg>
        Prix
      </button>
      ${
        isOwner
          ? `<button class="theme-btn" onclick="openAdmins()" title="Gérer les administrateurs">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>
        Admins
      </button>`
          : ''
      }
      <button class="theme-btn" onclick="openAccount()" title="${esc(me?.email || 'Mon compte')} — changer mon mot de passe">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Mon compte
      </button>
      <button class="theme-btn" onclick="toggleTheme()" title="Basculer le thème">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
        Thème
      </button>
      <a class="logout" href="/api/admin/logout" title="Se déconnecter">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
        Déconnexion
      </a>
    </div>
  </div>

  <div class="wrap">
    <div class="stats">
      ${statCard(nbToMake, 'À fabriquer', ICO_MAKE, 'accent')}
      ${statCard(orders.length, 'Commandes reçues', ICO_BOX)}
      ${statCard(money(revenue), "Chiffre d'affaires", ICO_EURO)}
      ${statCard(nbOpen, 'Devis à traiter', ICO_QUOTE)}
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="orders">Commandes <span class="count mono">${orders.length}</span></button>
      <button class="tab" data-tab="quotes">Devis <span class="count mono">${quotes.length}</span></button>
      <button class="tab" data-tab="designs">Designs <span class="count mono">${designs.length}</span></button>
    </div>

    <div class="toolbar">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <!-- type=text + autocomplete=off + readonly temporaire : empêche le 
             navigateur de pré-remplir le champ avec l'e-mail de connexion.
             Le readonly est retiré après 1 seconde en JS. -->
        <input id="search" type="text" name="search-${Date.now()}" readonly
               autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
               data-form-type="other" data-lpignore="true" data-1p-ignore="true"
               placeholder="Rechercher une commande, un client, un produit…" oninput="filterCards(true)">
      </div>

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
             ${orders.map(orderCard).join('')}
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
               <button class="chip-filter" data-qf="paid" onclick="filterQuotes(this)">
                 Payés <span class="count mono">${nbPaid}</span>
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
      <p id="alert-text"></p>
      <button class="btn primary" onclick="closeAlert()">OK</button>
    </div>
  </div>

  <!-- Modale : mon compte (changement de mot de passe) -->
  <div class="modal" id="acc-modal" onclick="if(event.target===this)closeAccount()">
    <div class="modal-box" style="max-width:420px">
      <h3>Mon compte</h3>
      <p class="sub">${esc(me?.email || '')}</p>

      <div class="set-block">
        <label class="lbl" for="acc-cur">Mot de passe actuel</label>
        <input type="password" id="acc-cur" class="price-input" autocomplete="current-password"
               style="width:100%;text-align:left">

        <label class="lbl" style="margin-top:12px" for="acc-new">Nouveau mot de passe</label>
        <input type="password" id="acc-new" class="price-input" autocomplete="new-password"
               style="width:100%;text-align:left">
        <p class="hint">8 caractères minimum.</p>

        <label class="lbl" style="margin-top:12px" for="acc-new2">Confirmer le nouveau mot de passe</label>
        <input type="password" id="acc-new2" class="price-input" autocomplete="new-password"
               style="width:100%;text-align:left">
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closeAccount()">Annuler</button>
        <button class="btn primary" id="acc-save" onclick="saveOwnPassword()">Changer</button>
      </div>
    </div>
  </div>

  <!-- Modale : prix du configurateur -->
  <div class="modal" id="price-modal" onclick="if(event.target===this)closePricing()">
    <div class="modal-box" style="max-width:540px">
      <h3>Prix du configurateur</h3>
      <p class="sub">Prix unitaires HT affichés aux clients.</p>

      <div class="set-block">
        <div id="price-list"><p class="hint">Chargement…</p></div>
        <p class="hint" style="margin-top:12px">
          Le prix d'un textile s'applique à <strong>toutes ses couleurs et
          tailles</strong> : un seul prix par article.
        </p>
        <p class="hint" style="margin-top:6px">
          À l'enregistrement, le prix est aussi mis à jour dans Shopify : le client
          paiera bien le nouveau prix au checkout. Les <strong>Coins</strong>
          passent par un devis chiffré à la main, leur prix ici n'est qu'indicatif.
        </p>
      </div>

      <div class="modal-actions">
        <button class="btn" onclick="closePricing()">Annuler</button>
        <button class="btn primary" id="price-save" onclick="savePricing()">Enregistrer</button>
      </div>
      <p class="hint" id="price-status" style="margin-top:12px"></p>
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
          <input type="email" id="adm-email" class="price-input" placeholder="collegue@exemple.com">
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

  <script>
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
    var AUTO_REFRESH_MS=20000;   // fréquence de vérification (20 s)

    // L'utilisateur est-il en train de faire quelque chose qu'il ne faut pas
    // interrompre ? (saisie dans un champ, ou une modale/overlay visible)
    function dashBusy(){
      var ae=document.activeElement;
      if(ae&&(ae.tagName==='INPUT'||ae.tagName==='TEXTAREA'||ae.tagName==='SELECT'||ae.isContentEditable)){
        return true;
      }
      // Un menu déroulant ouvert : recharger le fermerait sous le doigt.
      if(document.querySelector('.dd.open')) return true;
      // Modales/overlays ouverts (id ou classe contenant "modal"/"overlay"/"invoice"/"drawer").
      var open=document.querySelectorAll('.modal,.overlay,[class*="modal"],[class*="overlay"],[class*="drawer"]');
      for(var i=0;i<open.length;i++){
        var el=open[i];var st=window.getComputedStyle(el);
        if(st.display!=='none'&&st.visibility!=='hidden'&&el.offsetParent!==null){return true;}
      }
      return false;
    }

    function dashChanged(s){
      return s.orders!==DASH_STATE.orders || s.quotes!==DASH_STATE.quotes ||
             s.designs!==DASH_STATE.designs || s.newOrders!==DASH_STATE.newOrders ||
             s.newQuotes!==DASH_STATE.newQuotes;
    }

    var dashPending=false;   // un changement a été détecté mais on attend d'être libre
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
        if(dashChanged(s)) dashPending=true;
      }catch(e){/* réseau indisponible : on réessaiera au prochain tick */}

      // Recharge dès qu'un changement est en attente ET que l'utilisateur est libre.
      if(dashPending && !dashBusy()){
        location.reload();
      }
    }
    setInterval(dashCheck, AUTO_REFRESH_MS);
    // Vérifie aussi quand l'utilisateur revient sur l'onglet.
    document.addEventListener('visibilitychange',function(){ if(!document.hidden) dashCheck(); });

    var tabs=document.querySelectorAll('.tab');
    tabs.forEach(function(t){t.addEventListener('click',function(){
      tabs.forEach(function(x){x.classList.remove('active')});t.classList.add('active');
      document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
      document.getElementById('p-'+t.dataset.tab).classList.add('active');
      var s=document.getElementById('search');s.value='';filterCards(true);
    });});
    /* Filtre courant de l'onglet Devis : 'open' (à traiter), 'paid', 'all'. */
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
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      })
      .then(function(r){return r.json();})
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
      st.className='hint'; st.textContent='Enregistrement…';
      fetch('/api/admin/orders/'+encodeURIComponent(orderId)+'/note',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({note:input.value})
      })
      .then(function(r){return r.json();})
      .then(function(res){
        if(res.ok){ st.className='hint ok'; st.textContent='Note enregistrée.'; }
        else { st.className='hint err'; st.textContent="Échec de l'enregistrement."; }
        setTimeout(function(){st.textContent='';},2200);
      })
      .catch(function(){ st.className='hint err'; st.textContent='Erreur réseau.'; });
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

    /* ── Notifications : panneau déroulant sous la cloche ── */
    function toggleNotifs(e){
      e.stopPropagation();                              // sinon le doc referme aussitôt
      document.getElementById('notif-pop').classList.toggle('open');
      document.getElementById('export-menu').classList.remove('open');
    }
    /* Clic à l'extérieur, ou Échap : on referme. */
    document.addEventListener('click',function(e){
      var w=document.querySelector('.bell-wrap');
      if(w && !w.contains(e.target))
        document.getElementById('notif-pop').classList.remove('open');
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape')
        document.getElementById('notif-pop').classList.remove('open');
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
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(UNSEEN)
      }).then(function(){
        dot.remove();
        document.querySelectorAll('.badge-new').forEach(function(b){b.remove();});
        var clear=document.querySelector('.notif-clear');
        if(clear) clear.remove();
        document.getElementById('notif-list').innerHTML=
          '<div class="notif-empty"><div class="ico">&#10003;</div>'+
          '<p>Rien de nouveau.</p><small>Vous êtes à jour.</small></div>';
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
        showAlert('Mot de passe changé',
          'Utilisez le nouveau mot de passe à votre prochaine connexion.');
      }catch(e){
        btn.disabled=false;
        showAlert('Erreur réseau', e.message, 'error');
      }
    }

    /* ═══════════════════ Prix du configurateur ═══════════════════ */

    var PRICE_KEYS=[];   // ordre des produits, fourni par le serveur

    function openPricing(){
      document.getElementById('price-modal').classList.add('open');
      loadPricing();
    }
    function closePricing(){
      document.getElementById('price-modal').classList.remove('open');
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
        var multi=d.multiVariant||[];
        box.innerHTML=PRICE_KEYS.map(function(k){
          var noVariant=!d.variants||!d.variants[k];
          // Textiles : le prix couvre toutes les couleurs/tailles -> on le dit
          // sur la ligne, là où l'admin saisit la valeur.
          var note = multi.indexOf(k)!==-1
            ? '<span class="price-note">toutes couleurs et tailles</span>'
            : (noVariant ? '<span class="price-note">devis — indicatif</span>' : '');
          return '<div class="price-line">'+
                   '<div class="price-lbl">'+
                     '<label for="price-'+k+'">'+admEsc(d.labels[k]||k)+'</label>'+
                     note+
                   '</div>'+
                   '<div class="price-field">'+
                     '<input type="number" id="price-'+k+'" class="price-input mono" '+
                       'step="0.01" min="0" value="'+Number(d.prices[k]).toFixed(2)+'">'+
                     '<span class="price-cur">€ HT</span>'+
                   '</div>'+
                 '</div>';
        }).join('');
      }catch(e){
        box.innerHTML='<p class="hint">Erreur de chargement.</p>';
      }
    }

    async function savePricing(){
      var st=document.getElementById('price-status');
      var btn=document.getElementById('price-save');
      if(!PRICE_KEYS.length) return;

      var body={};
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
      }

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
          var st=c.getAttribute('data-qstatus')||'open';
          var isGrp=c.getAttribute('data-group')==='true';
          if(quoteFilter==='group'){
            matchStatus = isGrp;
          } else if(quoteFilter==='paid'){
            matchStatus = (st==='paid');
          } else {
            // filter='open': non payés et non-groupe (les commandes de groupe
            // ont leur propre onglet « 🎯 Commandes de groupe »).
            matchStatus = (st!=='paid') && !isGrp;
          }
        }
        if(isOrders && orderFilter!=='all'){
          matchStatus = (c.getAttribute('data-prod')||'to_produce')===orderFilter;
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
      var from=(page-1)*PAGE_SIZE+1, to=Math.min(page*PAGE_SIZE, total);
      // Boutons construits par le DOM (pas d'onclick inline avec apostrophes
      // imbriquées, qui cassaient le script généré).
      pager.innerHTML=
        '<button class="pg-btn" data-pg="prev" '+(page<=1?'disabled':'')+'>‹ Précédent</button>'+
        '<span class="pg-info">'+from+'–'+to+' sur '+total+'</span>'+
        '<button class="pg-btn" data-pg="next" '+(page>=pages?'disabled':'')+'>Suivant ›</button>';
      var prev=pager.querySelector('[data-pg="prev"]');
      var next=pager.querySelector('[data-pg="next"]');
      if(prev) prev.onclick=function(){ gotoPage(panelId, page-1); };
      if(next) next.onclick=function(){ gotoPage(panelId, page+1); };
    }

    function gotoPage(panelId, page){
      pageByPanel[panelId]=page;
      filterCards();
      // Remonte en haut de la liste pour le confort de lecture.
      var panel=document.getElementById(panelId);
      if(panel) panel.scrollIntoView({behavior:'smooth', block:'start'});
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
      }).then(function(){
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
      });
    }
    function zoom(u){var lb=document.getElementById('lb');document.getElementById('lb-img').src=u;lb.classList.add('open');}

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
      document.getElementById('inv-msg').value =
        'Bonjour '+(nom||'')+',\\n\\n'+
        'Voici votre devis pour '+(produit||'votre commande personnalisée')+'. '+
        'Vous pouvez le régler directement via le lien ci-dessous.\\n\\n'+
        'Merci de votre confiance.\\nL\\'équipe Custom Textile';
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
      invQuoteId=null;
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
          message:document.getElementById('inv-msg').value
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

    // Pagination initiale : applique les filtres + la 1re page dès le chargement.
    /* Chrome ignore souvent autocomplete=off et réinjecte l'e-mail de connexion
       dans le champ de recherche (il le prend pour un identifiant). On le vide
       au chargement, puis une fois de plus après le remplissage automatique,
       qui survient juste après. */
    (function(){
      var s=document.getElementById('search');
      if(!s) return;
      
      // Retire readonly après que le navigateur ait tenté son autocomplétion
      setTimeout(function(){ 
        s.removeAttribute('readonly'); 
        s.value = ''; // Force le vide une dernière fois
      }, 1000);
      
      /* Vrai seulement quand l'utilisateur a tapé : tant qu'il n'a pas touché au
         champ, toute valeur qui apparaît vient du remplissage automatique. */
      var typed=false;
      s.addEventListener('keydown', function(){ typed=true; });
      s.addEventListener('paste',   function(){ typed=true; });
      s.addEventListener('input', function(){ typed=true; });

      var clear=function(){
        if(!typed && s.value){ 
          s.value=''; 
          filterCards(true); 
        }
      };
      
      // Nettoyage immédiat et répété
      clear();
      [100,300,600,1200].forEach(function(d){ setTimeout(clear, d); });

      /* Chrome remplit parfois APRÈS le premier clic dans la page (ou au retour
         d'onglet) : on surveille tant que l'utilisateur n'a rien saisi. */
      s.addEventListener('focus', function(){
        if(!typed && s.value) { s.value=''; filterCards(true); }
      });
      document.addEventListener('click', clear, true);
      window.addEventListener('pageshow', function(){ typed=false; clear(); });
    })();

    filterCards(true);
  </script>`);
}
