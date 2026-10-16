import {
  brouillonDepuisManuelle,
  commandeManuelleDeLignes,
  estCommandeManuelle,
  factureDe,
  lireSaisieManuelle,
  numeroManuel,
} from '../src/admin/commandes-manuelles';
import { evaluerLignes } from '../src/shared/reconnaissance-configurateur';
import { dashboardPage, productionSheetPage } from '../src/admin/admin.view';

const MAINTENANT = new Date('2026-10-16T10:00:00Z');

const formulaire = (p: Record<string, unknown> = {}) => ({
  client: { nom: 'Lucas Julien', entreprise: 'Armée de l’Air', email: 'Lucas@Exemple.fr', telephone: '0144428498' },
  adresse: { ligne1: '1 place Joffre', ligne2: 'BAT 44', codePostal: '75007', ville: 'Paris', pays: 'France' },
  articles: [{ titre: 'Patch personnalisé (PVC)', quantite: 250, details: 'Taille : 8 cm\nFormat : Rond\n\n' }],
  date: '2026-10-14',
  total: '960,00',
  mode: 'facture',
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
    [{ mode: 'virement' }, 'paiement inconnu'],
    [{ total: '' }, 'montant total TTC'],
    [{ total: '0' }, 'Montant total invalide'],
    [{ client: { nom: 'A', email: '' } }, 'facture lui est envoyée'],
    [{ date: '2030-01-01' }, 'dans le futur'],
    [{ date: '14/10/2026' }, 'Date de commande invalide'],
  ])('refuse %j', (p, message) => {
    const r = lireSaisieManuelle(formulaire(p), MAINTENANT);
    expect('erreur' in r && r.erreur).toContain(message);
  });

  it('mode « déjà payé » : e-mail facultatif, commande marquée payée', () => {
    const r = lireSaisieManuelle(formulaire({ mode: 'payee', client: { nom: 'Lucas Julien' } }), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.mode).toBe('payee');
    expect(r.saisie.financialStatus).toBe('paid');
    expect(r.saisie.customerEmail).toBeNull();
  });

  it('brouillon Shopify : lignes libres à 0 €, repère caché, client et adresse', () => {
    const r = lireSaisieManuelle(formulaire(), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    const b = brouillonDepuisManuelle({ ...r.saisie, shopifyOrderId: '-3', orderNumber: 'M-1003' });
    expect(b.line_items).toEqual([
      {
        title: 'Patch personnalisé (PVC)',
        quantity: 250,
        price: '0.00',
        custom: true,
        properties: [
          { name: 'Détail 1', value: 'Taille : 8 cm' },
          { name: 'Détail 2', value: 'Format : Rond' },
          { name: '_Commande manuelle', value: '-3' },
        ],
      },
    ]);
    expect(b.email).toBe('lucas@exemple.fr');
    expect(b.customer).toEqual({ email: 'lucas@exemple.fr', first_name: 'Lucas', last_name: 'Julien', phone: '0144428498' });
    expect(b.shipping_address).toMatchObject({ company: 'Armée de l’Air', address1: '1 place Joffre', zip: '75007', city: 'Paris', country: 'France' });
    expect(b.note).toContain('M-1003');
    expect(b.tags).toContain('manuelle');
  });

  it('retrouve la commande manuelle depuis les lignes de la commande Shopify', () => {
    const lignes = [{ title: 'Coin métal', properties: [{ name: 'Détail 1', value: 'x' }, { name: '_Commande manuelle', value: '-7' }] }];
    expect(commandeManuelleDeLignes(lignes)).toBe('-7');
    expect(commandeManuelleDeLignes([{ properties: [{ name: '_Commande manuelle', value: '42' }] }])).toBeNull();
    expect(commandeManuelleDeLignes(null)).toBeNull();
    // Titre libre : la commande Shopify reste visible dans le dashboard.
    expect(evaluerLignes(lignes as any).reconnue).toBe(true);
  });

  it('lit le suivi de facture', () => {
    expect(factureDe({ customerInfo: { facture: { statut: 'envoyee', le: 'x' } } })?.statut).toBe('envoyee');
    expect(factureDe({ customerInfo: { manuelle: true } })).toBeNull();
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
    // Plus de modification : seuls les boutons de facturation, sur la commande manuelle.
    expect(html).not.toContain('js-modifier-manuelle');
    expect(html.match(/js-facturer-manuelle"/g)).toHaveLength(2);
    expect(html).toContain('data-manuelle="false"');
  });

  it('formulaire en trois étapes, sans modification ni suppression', () => {
    const o = manuelle();
    o.fichiersJoints = [
      { id: 'f1', libelle: 'BAT', nom: 'bat.pdf', url: 'https://res.cloudinary.com/c/raw/upload/v1/customizer/commandes/1001/bat.pdf', type: 'application/pdf', taille: 1, ajoutePar: 'a', ajouteLe: '2026-10-16T10:00:00Z' },
    ];
    const html = dashboardPage([o], [], [], 'https://x', '', {});
    expect(html).toContain('id="mn-etape-1"');
    expect(html).toContain('Articles &amp; design');
    expect(html).toContain('id="mn-etape-3"');
    expect(html).toContain('id="mn-page-3"');
    expect(html).toContain('id="mn-depot"');
    expect(html).toContain('Envoyer la facture au client');
    expect(html).not.toContain('id="mn-suppr"');
    expect(html).not.toContain('data-fichiers=');
  });

  it('carte « Commandes reçues » : répartition Shopify / manuelles au verso', () => {
    const html = dashboardPage([manuelle(), shopify], [], [], 'https://x', '', {});
    expect(html).toContain('class="stat t-blue stat-flip"');
    expect(html).toContain('aria-label="Commandes reçues : 2, dont 1 Shopify et 1 saisies manuelles"');
    expect(html).toMatch(/<span class="num mono">1<\/span><span class="cap">Shopify<\/span>/);
    expect(html).toMatch(/<span class="num mono">1<\/span><span class="cap">Manuelles<\/span>/);
  });

  it('pastille selon la facture Shopify, boutons masqués une fois envoyée', () => {
    const o = manuelle();
    o.customerInfo = { ...o.customerInfo, facture: { statut: 'envoyee', le: '2026-10-16T10:00:00Z', draftOrderId: '99' } };
    const html = dashboardPage([o], [], [], 'https://x', '', {});
    expect(html).toContain('Facture envoyée le 16 oct. 2026');
    expect(html).not.toContain('js-facturer-manuelle"');
    o.customerInfo.facture = { statut: 'echec', le: '2026-10-16T10:00:00Z', erreur: 'refus' };
    expect(dashboardPage([o], [], [], 'https://x', '', {})).toContain('Facture non envoyée');
  });

  it('le repère caché du brouillon n’apparaît pas en spécification', () => {
    const o = manuelle();
    o.lineItems[0].properties.push({ name: '_Commande manuelle', value: '-1' });
    expect(dashboardPage([o], [], [], 'https://x', '', {})).not.toContain('Commande manuelle</b>');
    expect(productionSheetPage(o, '')).not.toMatch(/_?Commande manuelle/);
  });

  it('fiche de production : client et articles saisis', () => {
    const html = productionSheetPage(manuelle(), '');
    expect(html).toContain('M-1001');
    expect(html).toContain('Lucas Julien');
    expect(html).toContain('Format : Rond');
  });
});
