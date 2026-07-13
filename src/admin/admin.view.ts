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

const STYLE = `
:root{
  --paper:#fbfaf8; --surface:#ffffff; --raise:#f6f4f0;
  --ink:#1b1f24; --muted:#8b8478; --faint:#b3ada2;
  --line:#e9e6e0; --line-soft:#f0ede8;
  --accent:#c2410c; --accent-soft:#fbeae1;
  --ok:#3f7d4e; --ok-soft:#e7f0e9;
  --warn:#b45309; --warn-soft:#fbefd9;
  --shadow:0 1px 2px rgba(27,31,36,.04),0 8px 24px rgba(27,31,36,.05);
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
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 30px rgba(0,0,0,.35);
  }
}
:root[data-theme="light"]{
  --paper:#fbfaf8; --surface:#ffffff; --raise:#f6f4f0;
  --ink:#1b1f24; --muted:#8b8478; --faint:#b3ada2;
  --line:#e9e6e0; --line-soft:#f0ede8;
  --accent:#c2410c; --accent-soft:#fbeae1;
  --ok:#3f7d4e; --ok-soft:#e7f0e9; --warn:#b45309; --warn-soft:#fbefd9;
  --shadow:0 1px 2px rgba(27,31,36,.04),0 8px 24px rgba(27,31,36,.05);
}
:root[data-theme="dark"]{
  --paper:#16181c; --surface:#1d2025; --raise:#23272e;
  --ink:#eceae5; --muted:#9a938a; --faint:#6a655d;
  --line:#2c3037; --line-soft:#24272d;
  --accent:#f4763e; --accent-soft:#3a251c;
  --ok:#6fbf83; --ok-soft:#1f2f24; --warn:#e0a95c; --warn-soft:#332a19;
  --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 30px rgba(0,0,0,.35);
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

.wrap{max-width:1080px;margin:0 auto;padding:clamp(20px,4vw,34px) clamp(16px,4vw,32px) 80px}

/* Stat strip */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:26px}
.stat{
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);
  padding:16px 18px;box-shadow:var(--shadow);
}
.stat .num{font-size:26px;font-weight:800;letter-spacing:-.02em;line-height:1}
.stat .cap{margin-top:6px;color:var(--muted);font-size:12px}
.stat.accent .num{color:var(--accent)}

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
  box-shadow:var(--shadow);overflow:hidden;transition:border-color .15s;
}
.card:hover{border-color:var(--line)}
.card.open{border-color:var(--accent)}
.head{
  display:grid;grid-template-columns:auto 1fr auto;gap:16px;align-items:center;
  padding:15px 18px;cursor:pointer;user-select:none;
}
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
  background:var(--raise);cursor:zoom-in;transition:.15s;
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
.lightbox img{max-width:92vw;max-height:88vh;border-radius:10px;background:var(--surface);box-shadow:0 30px 80px rgba(0,0,0,.5)}

/* Modale : envoi de facture */
.modal{position:fixed;inset:0;background:rgba(10,10,12,.6);backdrop-filter:blur(3px);
  display:none;align-items:center;justify-content:center;z-index:110;padding:24px}
.modal.open{display:flex}
.modal-box{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  width:min(94vw,480px);padding:24px;box-shadow:0 30px 70px rgba(0,0,0,.3)}
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
  .head{grid-template-columns:auto 1fr;gap:12px}
  .head .right{grid-column:1/-1;text-align:left;align-items:flex-start;flex-direction:row;justify-content:space-between;width:100%}
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
export function loginPage(error?: boolean): string {
  return shell(`
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px">
    <div style="width:100%;max-width:380px;background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:32px;box-shadow:var(--shadow)">
      <div class="brand" style="margin-bottom:22px">
        <div class="brand-mark">✦</div>
        <div class="brand-txt"><b>Custom Textile</b><span>Espace de production</span></div>
      </div>
      <h1 style="font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:4px">Connexion</h1>
      <p style="font-size:13px;color:var(--muted);margin-bottom:20px">Accès réservé à l'équipe.</p>
      ${error ? '<p style="color:var(--accent);font-size:12.5px;background:var(--accent-soft);padding:9px 12px;border-radius:9px;margin-bottom:14px">Mot de passe incorrect. Réessayez.</p>' : ''}
      <form method="post" action="/api/admin/login">
        <label class="lbl" style="display:block;margin-bottom:6px">Mot de passe</label>
        <input name="password" type="password" autofocus
          style="width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:11px;background:var(--paper);color:var(--ink);font:inherit;font-size:14px;outline:none;margin-bottom:16px">
        <button type="submit"
          style="width:100%;padding:12px;border:none;border-radius:11px;background:var(--accent);color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer">Se connecter</button>
      </form>
    </div>
  </div>`);
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

function orderCard(o: Order): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const nbItems = items.reduce((s: number, li: any) => s + (li.quantity || 0), 0);
  const productNames = items.map((li: any) => li.title).filter(Boolean);
  const summary = productNames.length
    ? productNames.slice(0, 2).join(', ') + (productNames.length > 2 ? `…` : '')
    : `${nbItems} article(s)`;
  const search = esc([o.orderNumber, o.customerName, o.customerEmail, ...productNames].join(' ').toLowerCase());
  return `<div class="card" data-search="${search}">
    <div class="head" onclick="toggleCard(this)">
      <div class="avatar">${esc(initials(o.customerName))}</div>
      <div>
        <div class="id mono">${esc(o.orderNumber || '#' + o.shopifyOrderId)}
          <svg class="caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>
        <div class="sub">${esc(o.customerName || 'Client')} · ${esc(summary)} · ${nbItems} art.</div>
      </div>
      <div class="right">
        ${statusPill(o.financialStatus)}
        <div class="amount mono">${money(o.totalPrice)}</div>
        <div class="when mono">${fdate(o.shopifyCreatedAt)} · ${ftime(o.shopifyCreatedAt)}</div>
      </div>
    </div>
    <div class="body">
      ${clientBlock(o)}
      <div class="section-lbl lbl">Articles à produire</div>
      ${items.map(itemRow).join('') || '<div class="kv"><span class="empty">Aucun article.</span></div>'}
    </div>
  </div>`;
}

function quoteCard(q: Quote, shopDomain: string): string {
  const d: any = q.quoteData || {};
  const c = d.customer || {};
  const coin = d.coin || {};
  const previews: any[] = Array.isArray(coin.previews) ? coin.previews : [];
  const imgs = previews.flatMap((p) => [p.logo, p.base].filter(isImg));
  const thumbs = imgs.length
    ? `<div class="thumbs">${imgs.map((u) => `<img class="thumb" src="${esc(u)}" onclick="zoom('${esc(u)}')" alt="aperçu">`).join('')}</div>`
    : `<div class="no-thumb">Sans aperçu</div>`;
  const details: string[] = Array.isArray(coin.details) ? coin.details : [];
  const search = esc([c.nom, c.email, coin.name].join(' ').toLowerCase());
  return `<div class="card" data-search="${search}">
    <div class="head" onclick="toggleCard(this)">
      <div class="avatar">${esc(initials(c.nom))}</div>
      <div>
        <div class="id">${esc(coin.name || 'Devis')}
          <svg class="caret" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 6l6 6-6 6"/></svg></div>
        <div class="sub">${esc(c.nom || 'Client')}${c.email ? ' · ' + esc(c.email) : ''}</div>
      </div>
      <div class="right">
        <span class="pill neutral">Qté ${esc(coin.qty || '')}</span>
        <div class="when mono">${fdate(q.createdAt)} · ${ftime(q.createdAt)}</div>
        ${q.draftOrderId ? `<div class="when mono">Brouillon #${esc(q.draftOrderId)}</div>` : ''}
      </div>
    </div>
    <div class="body">
      ${(c.telephone || c.entreprise || c.message) ? `<div class="section-lbl lbl">Contact</div>
      <div class="client">
        ${c.telephone ? `<div class="kv"><span class="k">Téléphone</span><a href="tel:${esc(c.telephone)}">${esc(c.telephone)}</a></div>` : ''}
        ${c.entreprise ? `<div class="kv"><span class="k">Société</span>${esc(c.entreprise)}</div>` : ''}
        ${c.message ? `<div class="kv" style="grid-column:1/-1"><span class="k">Message</span>${esc(c.message)}</div>` : ''}
      </div>` : ''}
      <div class="section-lbl lbl">Détail du produit</div>
      <div class="item">
        ${thumbs}
        <div class="item-body">
          <div class="specs">${details.map((x) => `<span class="spec">${esc(x)}</span>`).join('') || '<span class="empty">—</span>'}</div>
        </div>
      </div>
      <div class="quote-actions">
        ${
          q.draftOrderId
            ? `<button class="btn primary" onclick="openInvoice('${esc(q.id)}','${esc(c.email || '')}','${esc(c.nom || '')}','${esc(coin.name || '')}',${Number(coin.qty) || 1})">
                 ✉ Chiffrer et envoyer la facture
               </button>
               <span class="hint">Vous fixez le prix et envoyez la facture au client, sans quitter cette page.</span>`
            : `<span class="hint">Aucun brouillon Shopify associé : facture indisponible.</span>`
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

export function dashboardPage(
  orders: Order[],
  quotes: Quote[],
  designs: Design[],
  frontendUrl: string,
  shopDomain = '',
): string {
  const revenue = orders.reduce((s, o) => s + (parseFloat(String(o.totalPrice || '')) || 0), 0);
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
      <button class="theme-btn" onclick="toggleTheme()" title="Basculer le thème">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.36 6.36l-.7-.7M6.34 6.34l-.7-.7m12.72 0l-.7.7M6.34 17.66l-.7.7M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
        Thème
      </button>
      <a class="logout" href="/api/admin/logout">Déconnexion</a>
    </div>
  </div>

  <div class="wrap">
    <div class="stats">
      <div class="stat"><div class="num mono">${orders.length}</div><div class="cap">Commandes reçues</div></div>
      <div class="stat accent"><div class="num mono">${money(revenue)}</div><div class="cap">Chiffre d'affaires</div></div>
      <div class="stat"><div class="num mono">${quotes.length}</div><div class="cap">Demandes de devis</div></div>
      <div class="stat"><div class="num mono">${designs.length}</div><div class="cap">Designs sauvegardés</div></div>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="orders">Commandes <span class="count mono">${orders.length}</span></button>
      <button class="tab" data-tab="quotes">Devis <span class="count mono">${quotes.length}</span></button>
      <button class="tab" data-tab="designs">Designs <span class="count mono">${designs.length}</span></button>
    </div>

    <div class="toolbar">
      <div class="search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
        <input id="search" placeholder="Rechercher une commande, un client, un produit…" oninput="filterCards()">
      </div>
      <a class="btn" href="/api/admin/export.csv">↓ Exporter (CSV)</a>
    </div>

    <div class="panel active" id="p-orders">${orders.length ? orders.map(orderCard).join('') : emptyOrders}</div>
    <div class="panel" id="p-quotes">${quotes.length ? quotes.map((q) => quoteCard(q, shopDomain)).join('') : emptyQuotes}</div>
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

      <label class="lbl" style="margin-top:16px">Message au client</label>
      <textarea id="inv-msg"></textarea>

      <div class="modal-actions">
        <button class="btn" onclick="closeInvoice()">Annuler</button>
        <button class="btn primary" id="inv-send" onclick="sendInvoice()">Envoyer la facture</button>
      </div>
      <p class="hint" id="inv-status" style="margin-top:12px"></p>
    </div>
  </div>

  <script>
    var tabs=document.querySelectorAll('.tab');
    tabs.forEach(function(t){t.addEventListener('click',function(){
      tabs.forEach(function(x){x.classList.remove('active')});t.classList.add('active');
      document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
      document.getElementById('p-'+t.dataset.tab).classList.add('active');
      var s=document.getElementById('search');s.value='';filterCards();
    });});
    function filterCards(){
      var q=document.getElementById('search').value.toLowerCase().trim();
      var panel=document.querySelector('.panel.active');
      panel.querySelectorAll('.card').forEach(function(c){
        var hay=c.getAttribute('data-search')||'';
        c.style.display=(!q||hay.indexOf(q)!==-1)?'':'none';
      });
    }
    function toggleCard(head){head.parentElement.classList.toggle('open');}
    function zoom(u){var lb=document.getElementById('lb');document.getElementById('lb-img').src=u;lb.classList.add('open');}

    /* ── Chiffrage du devis + envoi de la facture ── */
    var invQuoteId=null, invQty=1;
    function euro(n){return n.toFixed(2).replace('.',',')+' €';}

    function openInvoice(id,email,nom,produit,qty){
      invQuoteId=id;
      invQty=Math.max(1,parseInt(qty,10)||1);
      document.getElementById('inv-sub').textContent =
        email ? ('Destinataire : '+email) : 'Aucune adresse e-mail renseignée pour ce client.';
      document.getElementById('inv-qty').textContent = invQty;
      document.getElementById('inv-price').value='';
      document.getElementById('inv-total').textContent='—';
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
      document.getElementById('inv-total').textContent =
        (isFinite(p) && p>0) ? euro(p*invQty) : '—';
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

      btn.disabled=true; btn.textContent='Envoi…';
      st.className='hint'; st.textContent='Application du prix, puis envoi…';

      fetch('/api/admin/quotes/'+encodeURIComponent(invQuoteId)+'/invoice',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
          unitPrice:price,
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
  </script>`);
}
