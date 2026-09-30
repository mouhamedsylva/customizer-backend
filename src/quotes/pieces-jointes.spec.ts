import { avecPiecesJointes, blocPiecesJointes, piecesValides } from './pieces-jointes';

const CLD = 'https://res.cloudinary.com/demo/image/upload/v1/customizer/temp-attachments/devis_1.pdf';

describe('pièces jointes dans l’e-mail de facture', () => {
  it('liste chaque pièce avec son lien', () => {
    expect(blocPiecesJointes([{ name: 'devis.pdf', url: CLD }])).toBe(
      `Pièces jointes :\n- devis.pdf : ${CLD}`,
    );
  });

  it('ajoute le bloc après le message, séparé par une ligne vide', () => {
    expect(avecPiecesJointes('Bonjour,\n\n', [{ name: 'a.pdf', url: CLD }])).toBe(
      `Bonjour,\n\nPièces jointes :\n- a.pdf : ${CLD}`,
    );
  });

  it('laisse le message intact sans pièce jointe', () => {
    expect(avecPiecesJointes('Bonjour', [])).toBe('Bonjour');
    expect(avecPiecesJointes('Bonjour', null)).toBe('Bonjour');
    expect(blocPiecesJointes(undefined)).toBe('');
  });

  it('écarte un lien hors Cloudinary ou non https', () => {
    expect(
      piecesValides([
        { name: 'x', url: 'https://evil.example.com/x.pdf' },
        { name: 'y', url: 'http://res.cloudinary.com/demo/y.pdf' },
        { name: 'z', url: 'javascript:alert(1)' },
        { name: 'w', url: 42 },
      ]),
    ).toEqual([]);
  });

  it('garde 5 pièces au plus', () => {
    const dix = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.pdf`, url: CLD }));
    expect(piecesValides(dix)).toHaveLength(5);
  });

  it('répare un nom enregistré abîmé (lu en latin1)', () => {
    // Tel que busboy le livre (octets UTF-8 lus en latin1) ; s'affiche « SynthÃ¨se … â□□ ».
    const abime = Buffer.from('Synthèse du projet — X.pdf', 'utf8').toString('latin1');
    expect(piecesValides([{ name: abime, url: CLD }])[0].name).toBe(
      'Synthèse du projet — X.pdf',
    );
  });

  it('met le nom sur une seule ligne', () => {
    expect(piecesValides([{ name: 'a\r\nb\tc.pdf', url: CLD }])[0].name).toBe('a b c.pdf');
    expect(piecesValides([{ name: '', url: CLD }])[0].name).toBe('Document');
  });
});
