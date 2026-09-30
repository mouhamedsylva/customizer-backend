import { nomFichierUtf8 } from './type-fichier';

describe('nomFichierUtf8', () => {
  /** Ce que busboy produit : les octets UTF-8 lus un à un en latin1. */
  const commeBusboy = (s: string) => Buffer.from(s, 'utf8').toString('latin1');

  it('répare un nom UTF-8 décodé en latin1', () => {
    const vrai = 'Synthèse du projet — Chaternetycam (tchatternity).pdf';
    expect(commeBusboy(vrai)).toBe('SynthÃ¨se du projet â\u0080\u0094 Chaternetycam (tchatternity).pdf');
    expect(nomFichierUtf8(commeBusboy(vrai))).toBe(vrai);
    expect(nomFichierUtf8(commeBusboy('Été 2026 – devis ñ.xlsx'))).toBe('Été 2026 – devis ñ.xlsx');
  });

  it('laisse un nom ASCII inchangé', () => {
    expect(nomFichierUtf8('devis-2026_v2.pdf')).toBe('devis-2026_v2.pdf');
  });

  it('laisse un nom déjà correct inchangé (idempotent)', () => {
    expect(nomFichierUtf8('Synthèse du projet — X.pdf')).toBe('Synthèse du projet — X.pdf');
    const une = nomFichierUtf8(commeBusboy('Café.pdf'));
    expect(nomFichierUtf8(une)).toBe('Café.pdf');
  });

  it('laisse un vrai nom latin1 inchangé', () => {
    expect(nomFichierUtf8('é.pdf')).toBe('é.pdf');
  });

  it('tolère une valeur vide', () => {
    expect(nomFichierUtf8('')).toBe('');
    expect(nomFichierUtf8(undefined as unknown as string)).toBe('');
  });
});
