import { dashboardPage } from '../src/admin/admin.view';
import type { Order } from '../src/database/entities/order.entity';

/**
 * « Voir le SVG » : le fichier de découpe s'ouvre dans la visionneuse, en
 * grand, au clic — jamais chargé automatiquement (isImg exclut les .svg).
 */
const SVG = 'https://res.cloudinary.com/demo/raw/upload/v1/text_front_1.svg';

function page(valeur: string): string {
  const commande = {
    shopifyOrderId: '1005',
    orderNumber: 1005,
    totalPrice: '68.00',
    lineItems: [
      {
        title: 'Textile - Sweatshirt',
        quantity: 1,
        properties: [{ name: '_Texte face (SVG)', value: valeur }],
      },
    ],
    productionStatus: 'to_produce',
    financialStatus: 'paid',
    receivedAt: new Date(),
    shopifyCreatedAt: new Date(),
  } as unknown as Order;
  return dashboardPage([commande], [], [], 'https://exemple.fr', 'boutique', {
    limits: { orders: 300, quotes: 500 },
  });
}

describe('dashboard — aperçu du SVG de découpe', () => {
  it('propose « Voir le SVG » sans charger le SVG à l’ouverture', () => {
    const html = page(SVG);
    expect(html).toContain('Voir le SVG');
    expect(html).toContain(`data-zoom="${SVG}"`);
    expect(html).not.toMatch(new RegExp(`<img[^>]+src="${SVG.replace(/[.?]/g, '\$&')}"`));
  });

  it('ignore les SVG hors des hôtes autorisés', () => {
    expect(page('https://evil.example/x.svg')).not.toContain('Voir le SVG');
  });

  it('agrandit le SVG dans la visionneuse', () => {
    const html = page(SVG);
    const zoom = html.match(/function zoom\(u\)\{[^\n]*\}/)![0];
    const classes = new Set<string>();
    const im = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) }, src: '' };
    const doc = { getElementById: (id: string) => (id === 'lb-img' ? im : { classList: { add() {} } }) };
    const appeler = new Function('document', `${zoom}; return zoom;`)(doc);
    appeler(SVG);
    expect(classes.has('svg')).toBe(true);
    appeler('https://res.cloudinary.com/demo/image/upload/apercu.png');
    expect(classes.has('svg')).toBe(false);
  });
});
