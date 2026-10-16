import {
  estCommandeManuelle,
  formulaireDepuisCommande,
  lireSaisieManuelle,
  numeroManuel,
} from '../src/admin/commandes-manuelles';
import { dashboardPage, productionSheetPage } from '../src/admin/admin.view';

const MAINTENANT = new Date('2026-10-16T10:00:00Z');

const formulaire = (p: Record<string, unknown> = {}) => ({
  client: { nom: 'Lucas Julien', entreprise: 'Armée de l’Air', email: 'Lucas@Exemple.fr', telephone: '0144428498' },
  adresse: { ligne1: '1 place Joffre', ligne2: 'BAT 44', codePostal: '75007', ville: 'Paris', pays: 'France' },
  articles: [{ titre: 'Patch personnalisé (PVC)', quantite: 250, details: 'Taille : 8 cm\nFormat : Rond\n\n' }],
  date: '2026-10-14',
  total: '960,00',
  paiement: 'pending',
  ...p,
});

describe('commandes manuelles : règles', () => {
  it('reconnaît les identifiants négatifs, et eux seuls', () => {
    expect(estCommandeManuelle('-1')).toBe(true);
    expect(estCommandeManuelle('-42')).toBe(true);
    expect(estCommandeManuelle('6123456789012')).toBe(false);
    expect(estCommandeManuelle('-1 OR 1')).toBe(false);
    expect(numeroManuel('-1')).toBe('M-1001');
    expect(numeroManuel('-23')).toBe('M-1023');
  });

  it('normalise une saisie complète au format des lignes Shopify', () => {
    const r = lireSaisieManuelle(formulaire(), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    const s = r.saisie;
    expect(s.customerName).toBe('Lucas Julien');
    expect(s.customerEmail).toBe('lucas@exemple.fr');
    expect(s.totalPrice).toBe('960.00');
    expect(s.financialStatus).toBe('pending');
    expect(s.shopifyCreatedAt.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(s.lineItems).toEqual([
      expect.objectContaining({
        title: 'Patch personnalisé (PVC)',
        quantity: 250,
        properties: [
          { name: 'Détail 1', value: 'Taille : 8 cm' },
          { name: 'Détail 2', value: 'Format : Rond' },
        ],
      }),
    ]);
    expect((s.customerInfo as any).shipping).toMatchObject({ company: 'Armée de l’Air', city: 'Paris', zip: '75007' });
  });

  it('ignore les lignes d’article laissées vides', () => {
    const r = lireSaisieManuelle(formulaire({ articles: [{ titre: '', quantite: 0, details: '' }, { titre: 'Drapeau', quantite: 2 }] }));
    expect('saisie' in r && r.saisie.lineItems.length).toBe(1);
  });

  it.each([
    [{ client: { nom: '', entreprise: '' } }, 'nom du client'],
    [{ client: { nom: 'A', email: 'pas-un-mail' } }, 'e-mail invalide'],
    [{ articles: [] }, 'au moins un article'],
    [{ articles: [{ titre: '', quantite: 3 }] }, 'doit avoir un nom'],
    [{ articles: [{ titre: 'Patch', quantite: 0.5 }] }, 'Quantité invalide'],
    [{ total: 'abc' }, 'Montant total invalide'],
    [{ paiement: 'refunded' }, 'paiement inconnu'],
    [{ date: '2030-01-01' }, 'dans le futur'],
    [{ date: '14/10/2026' }, 'Date de commande invalide'],
  ])('refuse %j', (p, message) => {
    const r = lireSaisieManuelle(formulaire(p), MAINTENANT);
    expect('erreur' in r && r.erreur).toContain(message);
  });

  it('le formulaire de modification restitue la saisie', () => {
    const r = lireSaisieManuelle(formulaire(), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    const f = formulaireDepuisCommande(r.saisie) as any;
    expect(f.client).toEqual({ nom: 'Lucas Julien', entreprise: 'Armée de l’Air', email: 'lucas@exemple.fr', telephone: '0144428498' });
    expect(f.articles[0]).toEqual({ titre: 'Patch personnalisé (PVC)', quantite: 250, details: 'Taille : 8 cm\nFormat : Rond' });
    expect(f.date).toBe('2026-10-14');
    expect(f.total).toBe('960.00');
    // Relire le formulaire redonne la même saisie.
    const r2 = lireSaisieManuelle(f, MAINTENANT);
    expect('saisie' in r2 && r2.saisie.lineItems).toEqual(r.saisie.lineItems);
  });
});

describe('commandes manuelles : affichage', () => {
  const manuelle = () => {
    const r = lireSaisieManuelle(formulaire(), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    return { ...r.saisie, shopifyOrderId: '-1', orderNumber: 'M-1001', productionStatus: 'to_produce', seen: true, receivedAt: new Date() } as any;
  };
  const shopify = {
    shopifyOrderId: '6100000000001', orderNumber: '#20800', customerName: 'Client Shopify', financialStatus: 'paid',
    lineItems: [{ title: 'Patch personnalisé (PVC)', quantity: 10, properties: [] }],
    productionStatus: 'to_produce', totalPrice: '50.00', receivedAt: new Date(), seen: true,
  } as any;

  it('distingue la commande manuelle dans la liste', () => {
    const html = dashboardPage([manuelle(), shopify], [], [], 'https://x', '', {});
    expect(html).toContain('class="card card-manuelle"');
    expect(html).toContain('Saisie manuelle</span>');
    expect(html).toContain('Hors Shopify');
    expect(html).toContain('✍ Saisies manuelles (1)');
    expect(html).toContain('+ Nouvelle commande');
    // Seule la commande manuelle est modifiable.
    expect(html.match(/js-modifier-manuelle"/g)).toHaveLength(1);
    expect(html).toContain('data-manuelle="false"');
  });

  it('fiche de production : client et articles saisis', () => {
    const html = productionSheetPage(manuelle(), '');
    expect(html).toContain('M-1001');
    expect(html).toContain('Lucas Julien');
    expect(html).toContain('Format : Rond');
  });
});
