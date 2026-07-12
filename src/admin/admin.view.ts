/**
 * Rendu HTML du dashboard admin (page autonome, styles inline).
 * Aucune dépendance externe : tout est inclus pour rester simple et fiable.
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

/** Formate un montant avec le symbole € (on affiche toujours en euro). */
function money(amount: unknown): string {
  const n = parseFloat(String(amount ?? ''));
  if (Number.isNaN(n)) return '';
  return n.toFixed(2).replace('.', ',') + ' €';
}

const LAYOUT_HEAD = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Admin — Custom Textile</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f4f5f7;color:#14181c}
  header{background:#14181c;color:#fff;padding:14px 22px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10}
  header h1{font-size:16px;font-weight:800;letter-spacing:.3px}
  header .logout{color:#cbd2da;font-size:12px;text-decoration:none}
  header .logout:hover{color:#fff}
  .wrap{max-width:1200px;margin:0 auto;padding:22px}
  .tabs{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
  .tab{padding:9px 16px;border-radius:9px;border:1.5px solid #e5e7ea;background:#fff;cursor:pointer;font-size:13px;font-weight:700;color:#5b636c}
  .tab.active{background:#14181c;color:#fff;border-color:#14181c}
  .tab .badge{display:inline-block;margin-left:6px;background:rgba(0,0,0,.12);border-radius:20px;padding:1px 8px;font-size:11px}
  .tab.active .badge{background:rgba(255,255,255,.22)}
  .toolbar{display:flex;gap:10px;margin-bottom:14px;flex-wrap:wrap}
  .toolbar input{flex:1;min-width:200px;padding:10px 12px;border:1.5px solid #e5e7ea;border-radius:9px;font-size:13px;outline:none}
  .toolbar input:focus{border-color:#14181c}
  .btn{padding:10px 14px;border:1.5px solid #14181c;background:#14181c;color:#fff;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px}
  .btn.ghost{background:#fff;color:#14181c}
  .panel{display:none}
  .panel.active{display:block}
  .card{background:#fff;border:1px solid #eceef1;border-radius:12px;padding:16px;margin-bottom:14px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
  .card-head.clickable{cursor:pointer;user-select:none}
  .card-head.clickable:hover .card-title{color:#1e46b8}
  .card-body{display:none;margin-top:12px;border-top:1px solid #f0f2f4;padding-top:8px}
  .card.open .card-body{display:block}
  .caret{display:inline-block;font-size:11px;color:#8a929b;transition:transform .15s}
  .card.open .caret{transform:rotate(90deg)}
  .card-title{font-size:15px;font-weight:800}
  .card-sub{font-size:12px;color:#8a929b;margin-top:2px}
  .chip{display:inline-block;background:#f2f3f5;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;color:#5b636c;margin-right:6px}
  .chip.paid{background:#e5f6ec;color:#1a8a3c}
  .items{margin-top:10px}
  .item{border-top:1px solid #f0f2f4;padding:10px 0;display:flex;gap:12px;flex-wrap:wrap}
  .thumbs{display:flex;gap:8px;flex-wrap:wrap}
  .thumb{width:74px;height:74px;border-radius:8px;border:1px solid #e5e7ea;object-fit:contain;background:#fafbfc;cursor:pointer}
  .props{flex:1;min-width:220px;font-size:12px;color:#333}
  .props .k{color:#8a929b;font-weight:700;text-transform:uppercase;font-size:10px;letter-spacing:.3px}
  .props .row{margin:2px 0}
  .props a{color:#1e46b8;text-decoration:none;word-break:break-all}
  .empty{text-align:center;color:#8a929b;padding:60px 20px;font-size:14px}
  .lightbox{position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;z-index:100;padding:30px}
  .lightbox.open{display:flex}
  .lightbox img{max-width:92vw;max-height:88vh;border-radius:8px;background:#fff}
</style></head><body>`;

/** Page de connexion. */
export function loginPage(error?: boolean): string {
  return `${LAYOUT_HEAD}
  <div style="max-width:360px;margin:12vh auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 20px 50px rgba(0,0,0,.12)">
    <h1 style="font-size:18px;font-weight:800;margin-bottom:4px">Espace administration</h1>
    <p style="font-size:12px;color:#8a929b;margin-bottom:18px">Custom Textile — accès réservé</p>
    ${error ? '<p style="color:#c0392b;font-size:12px;margin-bottom:12px">Mot de passe incorrect.</p>' : ''}
    <form method="post" action="/api/admin/login">
      <input name="password" type="password" placeholder="Mot de passe" autofocus
        style="width:100%;padding:12px 14px;border:1.5px solid #e5e7ea;border-radius:10px;font-size:14px;outline:none;margin-bottom:14px">
      <button class="btn" style="width:100%;justify-content:center;padding:12px" type="submit">Se connecter</button>
    </form>
  </div></body></html>`;
}

/** Rendu d'une commande. */
function orderCard(o: Order): string {
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  const itemsHtml = items
    .map((li: any) => {
      const props: Array<{ name: string; value: string }> = Array.isArray(li.properties)
        ? li.properties
        : [];
      const imgs = props.filter((p) => isImg(p.value));
      const links = props.filter((p) => !isImg(p.value) && isUrl(p.value));
      const texts = props.filter((p) => !isUrl(p.value));
      const thumbs = imgs
        .map((p) => `<img class="thumb" src="${esc(p.value)}" title="${esc(p.name)}" onclick="zoom('${esc(p.value)}')">`)
        .join('');
      const textRows = texts
        .map((p) => `<div class="row"><span class="k">${esc(p.name)}</span> ${esc(p.value)}</div>`)
        .join('');
      const linkRows = links
        .map((p) => `<div class="row"><span class="k">${esc(p.name)}</span> <a href="${esc(p.value)}" target="_blank">télécharger</a></div>`)
        .join('');
      return `<div class="item">
        <div class="thumbs">${thumbs || '<span style="color:#c0c6cc;font-size:11px">— pas d&#39;aperçu —</span>'}</div>
        <div class="props">
          <div class="row"><strong>${esc(li.title)}</strong> ${li.variantTitle ? `· ${esc(li.variantTitle)}` : ''} × ${esc(li.quantity)}</div>
          ${textRows}${linkRows}
        </div>
      </div>`;
    })
    .join('');
  const paid = (o.financialStatus || '').toLowerCase() === 'paid';
  const nbItems = items.reduce((s: number, li: any) => s + (li.quantity || 0), 0);
  // La carte est cliquable : l'en-tête déplie/replie le détail (.card-body).
  return `<div class="card" data-search="${esc([o.orderNumber, o.customerName, o.customerEmail].join(' ').toLowerCase())}">
    <div class="card-head clickable" onclick="toggleCard(this)">
      <div>
        <div class="card-title">${esc(o.orderNumber || '#' + o.shopifyOrderId)} <span class="caret">▸</span></div>
        <div class="card-sub">${esc(o.customerName || '')} ${o.customerEmail ? '· ' + esc(o.customerEmail) : ''} · ${nbItems} article(s)</div>
      </div>
      <div style="text-align:right">
        <span class="chip ${paid ? 'paid' : ''}">${esc(o.financialStatus || '—')}</span>
        <div class="card-sub" style="margin-top:6px;font-weight:800;color:#14181c">${money(o.totalPrice)}</div>
        <div class="card-sub">${o.shopifyCreatedAt ? new Date(o.shopifyCreatedAt).toLocaleString('fr-FR') : ''}</div>
      </div>
    </div>
    <div class="card-body">
      <div class="items">${itemsHtml || '<div class="card-sub">Aucun article.</div>'}</div>
    </div>
  </div>`;
}

/** Rendu d'un devis. */
function quoteCard(q: Quote): string {
  const d: any = q.quoteData || {};
  const c = d.customer || {};
  const coin = d.coin || {};
  const previews: any[] = Array.isArray(coin.previews) ? coin.previews : [];
  const thumbs = previews
    .flatMap((p) => [p.logo, p.base].filter(isImg))
    .map((u) => `<img class="thumb" src="${esc(u)}" onclick="zoom('${esc(u)}')">`)
    .join('');
  const details = Array.isArray(coin.details) ? coin.details : [];
  return `<div class="card" data-search="${esc([c.nom, c.email, coin.name].join(' ').toLowerCase())}">
    <div class="card-head clickable" onclick="toggleCard(this)">
      <div>
        <div class="card-title">${esc(coin.name || 'Devis')} <span class="caret">▸</span></div>
        <div class="card-sub">${esc(c.nom || '')} ${c.email ? '· ' + esc(c.email) : ''} ${c.telephone ? '· ' + esc(c.telephone) : ''}</div>
      </div>
      <div style="text-align:right">
        <span class="chip">Qté ${esc(coin.qty || '')}</span>
        <div class="card-sub" style="margin-top:6px">${q.createdAt ? new Date(q.createdAt).toLocaleString('fr-FR') : ''}</div>
        ${q.draftOrderId ? `<div class="card-sub">Draft #${esc(q.draftOrderId)}</div>` : ''}
      </div>
    </div>
    <div class="card-body">
      <div class="item">
        <div class="thumbs">${thumbs || '<span style="color:#c0c6cc;font-size:11px">— pas d&#39;aperçu —</span>'}</div>
        <div class="props">
          ${details.map((x: string) => `<div class="row">${esc(x)}</div>`).join('')}
          ${c.entreprise ? `<div class="row"><span class="k">Entreprise</span> ${esc(c.entreprise)}</div>` : ''}
          ${c.message ? `<div class="row"><span class="k">Message</span> ${esc(c.message)}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

/** Rendu d'un design sauvegardé. */
function designCard(d: Design, frontendUrl: string): string {
  const url = `${frontendUrl}/pages/configurateur?design=${d.id}`;
  return `<div class="card" data-search="${esc([d.productType, d.id].join(' ').toLowerCase())}">
    <div class="card-head">
      <div>
        <div class="card-title">${esc(d.productType || 'Design')}</div>
        <div class="card-sub">ID ${esc(d.id)}</div>
      </div>
      <div style="text-align:right">
        <div class="card-sub">${d.createdAt ? new Date(d.createdAt).toLocaleString('fr-FR') : ''}</div>
        <a class="btn ghost" style="margin-top:6px" href="${esc(url)}" target="_blank">Ouvrir</a>
      </div>
    </div>
  </div>`;
}

/** Page principale du dashboard. */
export function dashboardPage(
  orders: Order[],
  quotes: Quote[],
  designs: Design[],
  frontendUrl: string,
): string {
  const ordersHtml = orders.length
    ? orders.map(orderCard).join('')
    : '<div class="empty">Aucune commande captée pour l\'instant.<br>Les commandes payées apparaîtront ici via le webhook.</div>';
  const quotesHtml = quotes.length
    ? quotes.map(quoteCard).join('')
    : '<div class="empty">Aucun devis pour l\'instant.</div>';
  const designsHtml = designs.length
    ? designs.map((d) => designCard(d, frontendUrl)).join('')
    : '<div class="empty">Aucun design sauvegardé pour l\'instant.</div>';

  return `${LAYOUT_HEAD}
  <header>
    <h1>🎨 Custom Textile — Administration</h1>
    <a class="logout" href="/api/admin/logout">Se déconnecter</a>
  </header>
  <div class="wrap">
    <div class="tabs">
      <div class="tab active" data-tab="orders">Commandes <span class="badge">${orders.length}</span></div>
      <div class="tab" data-tab="quotes">Devis <span class="badge">${quotes.length}</span></div>
      <div class="tab" data-tab="designs">Designs <span class="badge">${designs.length}</span></div>
    </div>
    <div class="toolbar">
      <input id="search" placeholder="Rechercher (client, n° commande, produit…)" oninput="filter()">
      <a class="btn ghost" href="/api/admin/export.csv">⬇ Export CSV (commandes)</a>
    </div>
    <div class="panel active" id="p-orders">${ordersHtml}</div>
    <div class="panel" id="p-quotes">${quotesHtml}</div>
    <div class="panel" id="p-designs">${designsHtml}</div>
  </div>
  <div class="lightbox" id="lb" onclick="this.classList.remove('open')"><img id="lb-img" src=""></div>
  <script>
    var tabs=document.querySelectorAll('.tab');
    tabs.forEach(function(t){t.onclick=function(){
      tabs.forEach(function(x){x.classList.remove('active')});t.classList.add('active');
      document.querySelectorAll('.panel').forEach(function(p){p.classList.remove('active')});
      document.getElementById('p-'+t.dataset.tab).classList.add('active');
      document.getElementById('search').value='';filter();
    };});
    function filter(){
      var q=document.getElementById('search').value.toLowerCase();
      var panel=document.querySelector('.panel.active');
      panel.querySelectorAll('.card').forEach(function(c){
        var hay=c.getAttribute('data-search')||'';
        c.style.display=(!q||hay.indexOf(q)!==-1)?'':'none';
      });
    }
    function zoom(u){var lb=document.getElementById('lb');document.getElementById('lb-img').src=u;lb.classList.add('open');}
    function toggleCard(head){head.parentElement.classList.toggle('open');}
  </script></body></html>`;
}
