import {
  CATALOGUE_MANUEL,
  avecDesign,
  commandeManuelleDeLignes,
  designsConserves,
  formulaireDepuisCommande,
  ressourceCommande,
  estCommandeManuelle,
  lireSaisieManuelle,
  lireTextes,
  numeroManuel,
  proprieteVersTexte,
  texteVersPropriete,
} from '../src/admin/commandes-manuelles';
import { evaluerLignes } from '../src/shared/reconnaissance-configurateur';
import { dashboardPage, productionSheetPage } from '../src/admin/admin.view';

/**
 * Commandes manuelles : commandes DÉJÀ PAYÉES, saisies par l'admin, visibles
 * dans le dashboard seulement (rien sur Shopify, aucun e-mail). Montant total
 * saisi par l'admin, sans calcul.
 */
const MAINTENANT = new Date('2026-10-19T10:00:00Z');

const formulaire = (p: Record<string, unknown> = {}) => ({
  client: { nom: 'Lucas Julien', email: 'Lucas@Exemple.fr', telephone: '0144428498' },
  adresse: { ligne1: '1 place Joffre', codePostal: '75007', ville: 'Paris', pays: 'France' },
  articles: [{ titre: 'Patch personnalisé (PVC)', quantite: 250, details: 'Taille : 8 cm\nFormat : Rond\n\n' }],
  date: '2026-10-14',
  total: '960,00',
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

  it('enregistre une commande payée, au montant saisi, lignes au format Shopify', () => {
    const r = lireSaisieManuelle(formulaire(), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    const s = r.saisie;
    expect(s.customerName).toBe('Lucas Julien');
    expect(s.customerEmail).toBe('lucas@exemple.fr');
    expect(s.financialStatus).toBe('paid');
    expect(s.totalPrice).toBe('960.00');
    expect(s.shopifyCreatedAt.toISOString().slice(0, 10)).toBe('2026-10-14');
    expect(s.lineItems).toEqual([
      expect.objectContaining({
        title: 'Patch personnalisé (PVC)',
        quantity: 250,
        price: '0.00',
        properties: [
          { name: 'Détail 1', value: 'Taille : 8 cm' },
          { name: 'Détail 2', value: 'Format : Rond' },
        ],
      }),
    ]);
    expect((s.customerInfo as any).shipping).toMatchObject({ city: 'Paris', zip: '75007' });
  });

  it('e-mail facultatif : aucune facture n’est envoyée', () => {
    const r = lireSaisieManuelle(formulaire({ client: { nom: 'Sans e-mail' } }), MAINTENANT);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.customerEmail).toBeNull();
    expect(r.saisie.financialStatus).toBe('paid');
  });

  it('le montant est celui saisi, jamais recalculé depuis les articles', () => {
    const r = lireSaisieManuelle(
      formulaire({ total: '1 234,5', articles: [{ titre: 'Drapeau personnalisé', quantite: 3, prix: 99 }] }),
      MAINTENANT,
    );
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.totalPrice).toBe('1234.50');
    expect(r.saisie.lineItems[0].price).toBe('0.00');
  });

  it('ignore les blocs d’article laissés vides', () => {
    const r = lireSaisieManuelle(formulaire({ articles: [{ titre: '', quantite: 1, details: '' }, { titre: 'Drapeau personnalisé', quantite: 2 }] }));
    expect('saisie' in r && r.saisie.lineItems.length).toBe(1);
  });

  it.each([
    [{ client: { nom: '', email: 'a@b.fr' } }, 'nom du client'],
    [{ client: { nom: 'A', email: 'pas-un-mail' } }, 'e-mail invalide'],
    [{ articles: [] }, 'au moins un article'],
    [{ articles: [{ titre: '', quantite: 3, details: 'Rond' }] }, 'dans la liste'],
    [{ articles: [{ titre: 'Patch', quantite: 2 }] }, 'Article inconnu'],
    [{ articles: [{ titre: 'Coin métal personnalisé', quantite: 0.5 }] }, 'Quantité invalide'],
    [{ total: '' }, 'montant total TTC'],
    [{ total: '0' }, 'Montant total invalide'],
    [{ total: 'abc' }, 'Montant total invalide'],
    [{ date: '2030-01-01' }, 'dans le futur'],
    [{ date: '14/10/2026' }, 'Date de commande invalide'],
  ])('refuse %j', (p, message) => {
    const r = lireSaisieManuelle(formulaire(p), MAINTENANT);
    expect('erreur' in r && r.erreur).toContain(message);
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
    for (let k = 0; k < 3; k++) {
      const x = avecDesign(l, 0, 'u');
      if ('erreur' in x) throw new Error(x.erreur);
      l = x.lignes;
    }
    expect(avecDesign(l, 0, 'u')).toEqual({ erreur: '5 designs au plus par article.' });
    expect(avecDesign(lignes, 3, 'u')).toEqual({ erreur: 'Article introuvable.' });
  });

  it('filet : retrouve une ancienne commande manuelle sur une commande Shopify', () => {
    const lignes = [{ title: 'Coin métal', properties: [{ name: 'Détail 1', value: 'x' }, { name: '_Commande manuelle', value: '-7' }] }];
    expect(commandeManuelleDeLignes(lignes)).toBe('-7');
    expect(commandeManuelleDeLignes([{ properties: [{ name: '_Commande manuelle', value: '42' }] }])).toBeNull();
    expect(evaluerLignes(lignes as any).reconnue).toBe(true);
  });
});

describe('manches personnalisées (textiles)', () => {
  const saisie = (articles: unknown[]) =>
    lireSaisieManuelle({ client: { nom: 'A' }, total: '50', articles }, MAINTENANT);

  it('ajoute les manches cochées à un textile', () => {
    const r = saisie([{ titre: 'T-shirt coton personnalisé', quantite: 2, manches: ['droite', 'gauche', 'dos'] }]);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual([
      { name: 'Manche droite', value: 'Personnalisée' },
      { name: 'Manche gauche', value: 'Personnalisée' },
    ]);
  });

  it('ignore les manches sur un article qui n’est pas un textile', () => {
    const r = saisie([{ titre: 'Drapeau personnalisé', quantite: 1, manches: ['droite'] }]);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual([]);
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

  it('carte : badge, « Hors Shopify », aucun bouton de facture', () => {
    const html = dashboardPage([manuelle(), shopify], [], [], 'https://x', '', {});
    expect(html).toContain('Saisie manuelle</span>');
    expect(html).toContain('Hors Shopify');
    expect(html).toContain('✍ Saisies manuelles (1)');
    expect(html).toContain('+ Nouvelle commande');
    expect(html).not.toContain('js-facturer-manuelle');
    // Seule la commande manuelle se modifie.
    expect(html.match(/js-modifier-manuelle"/g)).toHaveLength(1);
  });

  it('formulaire : trois étapes, montant saisi, ni facture ni prix unitaire', () => {
    const html = dashboardPage([manuelle()], [], [], 'https://x', '', {});
    expect(html).toContain('id="mn-etape-3"');
    expect(html).toContain('Articles &amp; design');
    // Étape 2 : deux sections repliables ; plus de section « Autres fichiers ».
    expect(html).toContain('id="mn-pli-articles"');
    expect(html).toContain('id="mn-pli-tl"');
    expect(html).toContain('id="mn-logo-depot"');
    expect(html).toContain('Y a-t-il des textes sur les designs ?');
    expect(html).not.toContain('id="mn-depot"');
    expect(html).not.toContain('Autres fichiers');
    expect(html).toContain('id="mn-total"');
    expect(html).toContain('✓ Payée (hors boutique)');
    expect(html).toContain('data-catalogue="');
    expect(html).toContain(CATALOGUE_MANUEL[0].articles[0]);
    expect(html).not.toContain('data-grilles=');
    expect(html).not.toContain('La facture est envoyée');
  });

  it('chiffre d’affaires : la commande manuelle (payée) est comptée', () => {
    const html = dashboardPage([manuelle(), shopify], [], [], 'https://x', '', {});
    expect(html).toMatch(/1\s?010,00/); // 960 + 50
  });

  it('fiche de production : client, articles, et pas le repère technique', () => {
    const o = manuelle();
    o.lineItems[0].properties.push({ name: '_Commande manuelle', value: '-1' });
    const html = productionSheetPage(o, '');
    expect(html).toContain('M-1001');
    expect(html).toContain('Lucas Julien');
    expect(html).toContain('Format : Rond');
    expect(html).not.toMatch(/_?Commande manuelle/);
  });
});

describe('modification et suppression', () => {
  const o = {
    shopifyOrderId: '-1', orderNumber: 'M-1001', customerName: 'Lucas Julien', customerEmail: 'l@b.fr', customerPhone: '01',
    customerInfo: { shipping: { address1: '1 place Joffre', zip: '75007', city: 'Paris', country: 'France' } },
    totalPrice: '960.00', shopifyCreatedAt: new Date('2026-10-14T10:00:00Z'),
    lineItems: [{
      title: 'T-shirt coton personnalisé', quantity: 4, properties: [
        { name: 'Détail 1', value: 'Taille : M' },
        { name: 'Manche droite', value: 'Personnalisée' },
        { name: 'Design', value: 'https://res.cloudinary.com/c/image/upload/v1/customizer/commandes/M-1001/logo_1.png' },
      ],
    }],
  } as any;

  it('le formulaire de modification restitue la saisie, designs compris', () => {
    const f = formulaireDepuisCommande(o) as any;
    expect(f.client).toEqual({ nom: 'Lucas Julien', email: 'l@b.fr', telephone: '01' });
    expect(f.adresse).toMatchObject({ ligne1: '1 place Joffre', codePostal: '75007', ville: 'Paris' });
    expect(f.articles[0]).toEqual({
      titre: 'T-shirt coton personnalisé', quantite: 4, details: 'Taille : M', manches: ['droite'],
      designs: ['https://res.cloudinary.com/c/image/upload/v1/customizer/commandes/M-1001/logo_1.png'],
      textes: [], logos: [],
    });
    expect(f.total).toBe('960.00');
    expect(f.date).toBe('2026-10-14');
    // Relire le formulaire redonne les mêmes lignes (designs conservés).
    const r = lireSaisieManuelle(f);
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual(o.lineItems[0].properties);
  });

  it('ne conserve que des designs Cloudinary', () => {
    expect(designsConserves(['https://res.cloudinary.com/c/raw/upload/v1/a.pdf', 'https://evil.com/x.png', 42])).toEqual([
      'https://res.cloudinary.com/c/raw/upload/v1/a.pdf',
    ]);
  });

  it('retrouve la ressource Cloudinary d’un fichier de commande, et seulement celle-là', () => {
    expect(ressourceCommande('https://res.cloudinary.com/c/image/upload/v12/customizer/commandes/M-1001/logo_1.png')).toEqual({
      publicId: 'customizer/commandes/M-1001/logo_1', resourceType: 'image',
    });
    expect(ressourceCommande('https://res.cloudinary.com/c/raw/upload/v12/customizer/commandes/M-1001/bat_1.pdf')).toEqual({
      publicId: 'customizer/commandes/M-1001/bat_1.pdf', resourceType: 'raw',
    });
    expect(ressourceCommande('https://res.cloudinary.com/c/image/upload/v1/customizer/logos/x.png')).toBeNull();
  });

  it('la carte d’une commande manuelle porte le bouton « Modifier »', () => {
    const html = dashboardPage([{ ...o, productionStatus: 'to_produce', receivedAt: new Date(), seen: true, financialStatus: 'paid' }], [], [], 'https://x', '', {});
    expect(html.match(/js-modifier-manuelle"/g)).toHaveLength(1);
    expect(html).toContain('data-form="');
    expect(html).toContain('id="mn-suppr"');
    // Confirmation par une fenêtre du dashboard, pas par une alerte du navigateur.
    expect(html).toContain('id="mn-suppr-modal"');
    expect(html).not.toContain("window.confirm('Supprimer définitivement");
  });
});

describe('textes et logos', () => {
  it('un texte devient une propriété lisible, relue à l’identique', () => {
    const t = { texte: 'MASSACRE · 2026', vue: 'Dos', police: 'Anton', style: 'Gras', taille: 4.5 };
    const v = texteVersPropriete(t);
    expect(v).toBe('« MASSACRE · 2026 » · Dos · Anton · Gras · 4,5 cm');
    expect(proprieteVersTexte(v)).toEqual(t);
    expect(proprieteVersTexte(texteVersPropriete({ texte: 'A', vue: 'Face', police: '', style: 'Normal', taille: null }))).toEqual({
      texte: 'A', vue: 'Face', police: '', style: 'Normal', taille: null,
    });
  });

  it('valide les textes : vue, police, style, taille', () => {
    expect(lireTextes([{ texte: '  ', vue: 'Face' }])).toEqual({ textes: [] });
    expect('erreur' in lireTextes([{ texte: 'A', vue: 'Ventre' }])).toBe(true);
    expect('erreur' in lireTextes([{ texte: 'A', vue: 'Face', police: 'Comic Sans' }])).toBe(true);
    expect('erreur' in lireTextes([{ texte: 'A', vue: 'Face', taille: 'grand' }])).toBe(true);
    expect(lireTextes([{ texte: 'A', vue: 'cœur', police: 'Anton', taille: '3,5' }])).toEqual({
      textes: [{ texte: 'A', vue: 'Cœur', police: 'Anton', style: 'Normal', taille: 3.5 }],
    });
  });

  it('les textes et logos conservés deviennent des propriétés de la ligne, et se relisent', () => {
    const logo = 'https://res.cloudinary.com/c/image/upload/v1/customizer/commandes/M-1001/logo_2.png';
    const r = lireSaisieManuelle({
      client: { nom: 'A' }, total: '10',
      articles: [{
        titre: 'Sweatshirt personnalisé', quantite: 1,
        textes: [{ texte: 'MASSACRE', vue: 'Dos', police: 'Anton', style: 'Gras', taille: 4 }],
        logos: [{ url: logo, vue: 'Face' }, { url: logo, vue: 'Face' }, { url: 'https://evil.com/x.png', vue: 'Dos' }],
      }],
    });
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.saisie.lineItems[0].properties).toEqual([
      { name: 'Texte 1', value: '« MASSACRE » · Dos · Anton · Gras · 4 cm' },
      { name: 'Logo face', value: logo },
      { name: 'Logo face 2', value: logo },
    ]);
    const f = formulaireDepuisCommande({ lineItems: r.saisie.lineItems } as any) as any;
    expect(f.articles[0].textes).toEqual([{ texte: 'MASSACRE', vue: 'Dos', police: 'Anton', style: 'Gras', taille: 4 }]);
    expect(f.articles[0].logos).toEqual([{ url: logo, vue: 'Face' }, { url: logo, vue: 'Face' }]);
  });

  it('un logo envoyé s’ajoute à sa ligne avec sa vue', () => {
    let r = avecDesign([{ title: 'x', properties: [] }], 0, 'u1', 'Dos');
    if ('erreur' in r) throw new Error(r.erreur);
    r = avecDesign(r.lignes, 0, 'u2', 'dos');
    if ('erreur' in r) throw new Error(r.erreur);
    expect(r.lignes[0].properties).toEqual([{ name: 'Logo dos', value: 'u1' }, { name: 'Logo dos 2', value: 'u2' }]);
    expect(avecDesign([{ title: 'x' }], 0, 'u', 'Ventre')).toEqual({ erreur: 'Vue du logo inconnue.' });
  });
});
