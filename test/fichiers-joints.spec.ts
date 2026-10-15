import {
  estImageJointe,
  fichiersJointsValides,
  libelleFichier,
  nouveauFichierJoint,
} from '../src/admin/fichiers-joints';
import { dashboardPage, listeFichiersJoints, productionSheetPage } from '../src/admin/admin.view';

const PDF = 'https://res.cloudinary.com/c/raw/upload/v1/customizer/commandes/20500/BAT_1.pdf';
const PNG = 'https://res.cloudinary.com/c/image/upload/v1/customizer/commandes/20500/maquette_1.png';

const joint = (p: Partial<Parameters<typeof nouveauFichierJoint>[0]>) =>
  nouveauFichierJoint({
    libelle: '',
    nom: 'f.pdf',
    url: PDF,
    type: 'application/pdf',
    taille: 10,
    ajoutePar: 'sam@test.fr',
    maintenant: new Date('2026-10-15T12:02:00Z'),
    ...p,
  });

const commande = (fichiersJoints: unknown) =>
  ({
    shopifyOrderId: '42', orderNumber: '#20500', fichiersJoints,
    lineItems: [{ title: 'Patchs personnalisés', quantity: 50, properties: [] }],
    productionStatus: 'to_produce', totalPrice: '250.00', receivedAt: new Date(),
  }) as any;

describe('fichiers joints : règles', () => {
  it('libellé : une ligne, 80 caractères, repli sur le nom', () => {
    expect(libelleFichier('  BAT\nsigné ', 'x.pdf')).toBe('BAT signé');
    expect(libelleFichier('', 'x.pdf')).toBe('x.pdf');
    expect(libelleFichier(undefined, '')).toBe('Fichier');
    expect(libelleFichier('a'.repeat(100), 'x').length).toBe(80);
  });

  it('écarte les entrées incomplètes et les URL hors Cloudinary', () => {
    const ok = joint({});
    expect(fichiersJointsValides([ok, { id: 'x', libelle: 'y', url: 'https://evil.com/a.pdf' }, null])).toEqual([ok]);
    expect(fichiersJointsValides(null)).toEqual([]);
  });

  it('reconnaît les images', () => {
    expect(estImageJointe({ type: 'image/png', url: PNG })).toBe(true);
    expect(estImageJointe({ type: 'application/pdf', url: PDF })).toBe(false);
  });
});

describe('fichiers joints : affichage', () => {
  const bat = joint({ libelle: 'BAT signé', nom: 'bat.pdf' });
  const maq = joint({ nom: 'maquette.png', url: PNG, type: 'image/png' });

  it('liste de la carte : lien, auteur, date, bouton de retrait', () => {
    const html = listeFichiersJoints([bat, maq], '42');
    expect(html).toContain('BAT signé');
    expect(html).toContain('ajouté par sam@test.fr le 15/10/2026 à 14:02');
    expect(html).toContain(`data-fichier="${bat.id}"`);
    expect(html).toContain('fj-vignette');
    expect(listeFichiersJoints(null, '42')).toContain('Aucun fichier joint');
  });

  it('échappe le libellé', () => {
    const html = listeFichiersJoints([joint({ libelle: '<img src=x onerror=alert(1)>' })], '42');
    expect(html).not.toContain('<img src=x');
  });

  it('carte du dashboard : bloc et bouton d’ajout', () => {
    const html = dashboardPage([commande([bat])], [], [], 'https://x', '', {});
    expect(html).toContain('Fichiers joints (BAT signé, maquette…)');
    expect(html).toContain('+ Joindre un fichier');
    expect(html).toContain(`/api/admin/orders/42/fichiers/${bat.id}`);
  });

  it('liens d’ouverture : par le backend, jamais l’URL Cloudinary directe', () => {
    const html = listeFichiersJoints([bat], '42');
    expect(html).toContain(`href="/api/admin/orders/42/fichiers/${bat.id}"`);
    expect(html).not.toContain(`href="${PDF}"`);
  });

  it('fiche de production : images en grand, documents en liens', () => {
    const html = productionSheetPage(commande([bat, maq]), '');
    expect(html).toContain('Fichiers joints');
    expect(html).toContain(`<img src="${PNG}"`);
    expect(html).toContain(`<a href="/api/admin/orders/42/fichiers/${bat.id}"`);
    expect(productionSheetPage(commande(null), '')).not.toContain('Fichiers joints');
  });
});
