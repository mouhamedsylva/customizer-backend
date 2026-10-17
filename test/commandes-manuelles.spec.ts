import {
  CATALOGUE_MANUEL,
  avecDesign,
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
  articles: [{ titre: 'Patch personnalisé (PVC)', quantite: 250, prix: '3,84', details: 'Taille : 8 cm\nFormat : Rond\n\n' }],
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
    const r = lireSaisieManuelle(formulaire({ articles: [{ titre: '', quantite: 0, details: '' }, { titre: 'Drapeau personnalisé', quantite: 2, prix: 19.9 }] }));
    expect('saisie' in r && r.saisie.lineItems.length).toBe(1);
  });

  it.each([
    [{ client: { nom: '', entreprise: '' } }, 'nom du client'],
    [{ client: { nom: 'A', email: 'pas-un-mail' } }, 'e-mail invalide'],
    [{ articles: [] }, 'au moins un article'],
    [{ articles: [{ titre: '', quantite: 3 }] }, 'au moins un article'],
    [{ articles: [{ titre: '', quantite: 3, details: 'Rond' }] }, 'dans la liste'],
    [{ articles: [{ titre: 'Patch', quantite: 2 }] }, 'Article inconnu'],
    [{ articles: [{ titre: 'Coin métal personnalisé', quantite: 0.5 }] }, 'Quantité invalide'],
    [{ mode: 'virement' }, 'paiement inconnu'],
    [{ articles: [{ titre: 'Coin métal personnalisé', quantite: 10 }] }, 'prix unitaire de « Coin métal personnalisé »'],
    [{ articles: [{ titre: 'Coin métal personnalisé', quantite: 10, prix: '0' }] }, 'prix unitaire'],
    [{ articles: [{ titre: 'Coin métal personnalisé', quantite: 10, prix: 'abc' }] }, 'prix unitaire'],
    [{ client: { nom: 'A', email: '' } }, 'facture lui est envoyée'],
    [{ date: '2030-01-01' }, 'dans le futur'],
    [{ date: '14/10/2026' }, 'Date de commande invalide'],
  ])('refuse %j', (p, message) => {
    const r = lireSaisieManuelle(formulaire(p), MAINTENANT);
    expect('erreur' in r && r.erreur).toContain(message);
  });

  it('total = somme des lignes (prix unitaire × quantité), au centime', () => {
    const r = lireSaisieManuelle(
      formulaire({
        total: '1',
        articles: [
          { titre: 'Patch personnalisé (PVC)', quantite: 3, prix: '24,10' },
          { titre: 'Sweatshirt personnalisé', quantite: 2, prix: 60 },
        ],
      }),
      MAINTENANT,
    );
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems.map((l) => l.price)).toEqual(['24.10', '60.00']);
    expect(r.saisie.totalPrice).toBe('192.30'); // le « total » envoyé est ignoré
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

  it('design d’un article : propriété Design, puis Design 2, 5 au plus', () => {
    const lignes = [{ title: 'Drapeau personnalisé', quantity: 1, properties: [{ name: 'Détail 1', value: 'x' }] }];
    let r = avecDesign(lignes, 0, 'https://res.cloudinary.com/c/image/upload/v1/a.png');
    if ('erreur' in r) throw new Error(r.erreur);
    expect(lignes[0].properties).toHaveLength(1); // l’original n’est pas modifié
    r = avecDesign(r.lignes, 0, 'https://res.cloudinary.com/c/raw/upload/v1/b.pdf');
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.lignes[0].properties.map((p: any) => p.name)).toEqual(['Détail 1', 'Design', 'Design 2']);
    let l: any = r.lignes;
    for (let k = 0; k < 3; k++) { const x = avecDesign(l, 0, 'u'); if ('erreur' in x) throw new Error(x.erreur); l = x.lignes; }
    expect(avecDesign(l, 0, 'u')).toEqual({ erreur: '5 designs au plus par article.' });
    expect(avecDesign(lignes, 3, 'u')).toEqual({ erreur: 'Article introuvable.' });
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
    expect(html).toContain('La facture est envoyée au client par e-mail');
    // Plus d’option « Déjà payé » dans le formulaire.
    expect(html).not.toContain('data-val="payee"');
    // Catalogue fermé transmis au menu des articles (plus de saisie libre).
    expect(html).toContain('data-catalogue="');
    expect(html).toContain(CATALOGUE_MANUEL[0].articles[0]);
    expect(html).not.toContain('mn-suggestions');
    // Grilles de prix transmises pour préremplir le prix unitaire.
    expect(html).toContain('data-grilles="');
    expect(html).not.toContain('id="mn-suppr"');
    expect(html).not.toContain('data-fichiers=');
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

describe('chiffre d’affaires', () => {
  it('ignore les commandes manuelles non payées', () => {
    const base = { lineItems: [{ title: 'Drapeau personnalisé', quantity: 1, properties: [] }], productionStatus: 'to_produce', receivedAt: new Date(), seen: true };
    const html = dashboardPage(
      [
        { ...base, shopifyOrderId: '-1', orderNumber: 'M-1001', totalPrice: '744.50', financialStatus: 'pending' },
        { ...base, shopifyOrderId: '6100000000002', orderNumber: '#20900', totalPrice: '58.70', financialStatus: 'paid' },
      ] as any,
      [], [], 'https://x', '', {},
    );
    expect(html).toContain('58,70');
    expect(html).not.toMatch(/803,20/);
  });
});

describe('manches personnalisées (textiles)', () => {
  const saisie = (articles: unknown[]) =>
    lireSaisieManuelle(
      { client: { nom: 'A', email: 'a@b.fr' }, mode: 'facture', articles },
      new Date('2026-10-17T10:00:00Z'),
    );

  it('ajoute les manches cochées à un textile', () => {
    const r = saisie([{ titre: 'T-shirt coton personnalisé', quantite: 2, prix: 36, manches: ['droite', 'gauche', 'dos'] }]);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual([
      { name: 'Manche droite', value: 'Personnalisée' },
      { name: 'Manche gauche', value: 'Personnalisée' },
    ]);
    expect(r.saisie.lineItems[0].price).toBe('36.00'); // supplément compris dans le prix reçu
  });

  it('ignore les manches sur un article qui n’est pas un textile', () => {
    const r = saisie([{ titre: 'Drapeau personnalisé', quantite: 1, prix: 19.9, manches: ['droite'] }]);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual([]);
  });

  it('transmet le prix d’une manche et la liste des textiles au formulaire', () => {
    const pricing = { prices: { sweatshirt: 60, tshirt: 32, tshirt_polyester: 32, coins: 0, drapeaux: 19.9, patches: 20, manche: 4 }, tiers: {} } as any;
    const html = dashboardPage([], [], [], 'https://x', '', { pricing });
    expect(html).toContain('data-manche="4"');
    expect(html).toContain('T-shirt coton personnalisé');
  });
});
