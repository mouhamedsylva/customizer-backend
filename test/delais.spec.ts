import { DelaisService, DELAIS_DEFAUT, validerRegle } from '../src/admin/delais.service';

/** Dépôt `settings` en mémoire. */
function build(initial: Record<string, string> = {}) {
  const lignes = new Map<string, string>(Object.entries(initial));
  const repo: any = {
    findOne: async ({ where: { key } }: any) =>
      lignes.has(key) ? { key, value: lignes.get(key) } : null,
    manager: {
      transaction: async (fn: any) =>
        fn({ getRepository: () => ({ save: async (r: any) => lignes.set(r.key, r.value) }) }),
    },
  };
  return { svc: new DelaisService(repo), lignes };
}

describe('DelaisService', () => {
  it('sert le barème actuel du thème tant que rien n’est enregistré', async () => {
    const { svc } = build();
    const d = await svc.get();
    expect(d).toEqual(DELAIS_DEFAUT);
    expect(d.sweatshirt).toEqual({ delai: '2-3 semaines', seuil: 10, grand: '3-4 semaines' });
    expect(d.patches).toEqual({ delai: '5 à 7 semaines', seuil: null, grand: null });
  });

  it('enregistre partiellement sans toucher aux autres produits', async () => {
    const { svc } = build();
    const d = await svc.save({ patches: { delai: '4 à 6 semaines', seuil: null, grand: null } });
    expect(d.patches.delai).toBe('4 à 6 semaines');
    expect(d.coins.delai).toBe('5 à 7 semaines');
    expect(d.tshirt.seuil).toBe(10);
  });

  it('refuse tout l’enregistrement si une règle est invalide', async () => {
    const { svc, lignes } = build();
    await expect(
      svc.save({
        patches: { delai: '4 semaines' },
        tshirt: { delai: '', seuil: null, grand: null },
      }),
    ).rejects.toThrow(/T-shirt coton/);
    expect(lignes.size).toBe(0);
  });

  it('exige seuil et délai grande quantité ensemble', () => {
    expect(validerRegle('sweatshirt', { delai: '2 sem.', seuil: 10, grand: '' }).erreur).toMatch(/à la fois/);
    expect(validerRegle('sweatshirt', { delai: '2 sem.', seuil: null, grand: '3 sem.' }).erreur).toMatch(/à la fois/);
    expect(validerRegle('sweatshirt', { delai: '2 sem.', seuil: 0, grand: '3 sem.' }).erreur).toMatch(/invalide/);
    expect(validerRegle('sweatshirt', { delai: '2 sem.', seuil: 20, grand: '3 sem.' }).regle)
      .toEqual({ delai: '2 sem.', seuil: 20, grand: '3 sem.' });
  });

  it('nettoie le texte (balises, espaces) et borne sa longueur', () => {
    expect(validerRegle('coins', { delai: '  <b>6</b>   semaines ' }).regle?.delai).toBe('b6/b semaines');
    expect(validerRegle('coins', { delai: 'x'.repeat(41) }).erreur).toBeTruthy();
  });

  it('tolère une valeur corrompue en base', async () => {
    const { svc } = build({ delais_production: '{pas du json' });
    expect(await svc.get()).toEqual(DELAIS_DEFAUT);
  });
});
