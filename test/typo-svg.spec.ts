import { TypoSvgService } from '../src/shared/typo-svg.service';
import { AncienTextOutlineService } from './fixtures/ancien-text-outline';

/**
 * Retrouver la typo des anciennes commandes depuis leur SVG de découpe.
 *
 * Les SVG sont produits par l'ANCIEN service (copie figée dans fixtures/) :
 * exactement les fichiers des commandes passées avant la correction, NaN
 * compris.
 */
const ancien = new AncienTextOutlineService();
(ancien as any).logger = { log() {}, debug() {}, warn() {}, error() {} };
const typo = new TypoSvgService();
(typo as any).logger = { log() {}, debug() {}, warn() {}, error() {} };

const seg = (text: string, fontFamily: string, fontSize: number, extra = {}) => ({
  text,
  fontFamily,
  fontSize,
  fontWeight: '400',
  color: '#1a1a1a',
  ...extra,
});

const ancienSvg = async (segments: any[]) =>
  (await ancien.genererSvgVectoriel(segments, { scale: 1, padding: 32 }))!;

jest.setTimeout(120000);

describe('TypoSvgService.identifier', () => {
  it.each([
    ['Pacifico', 'Martin'],
    ['Bungee', 'MARTIN'],
    ['Dancing Script', 'Martin'],
    ['Allura', 'Martin'],
    ['Lora', 'Martin'], // repli glyphe par glyphe de l'ancien code
    ['Oswald', 'Welsh'],
    ['Anton', 'Été 2026'],
  ])('%s « %s » : police, taille, texte, couleur', async (police, texte) => {
    for (const taille of [8, 19.2, 20, 24, 28, 40]) {
      const svg = await ancienSvg([seg(texte, police, taille)]);
      const r = await typo.identifier(svg);
      expect(r).not.toBeNull();
      expect(r!.police.replace(/\s/g, '').toLowerCase()).toBe(police.replace(/\s/g, '').toLowerCase());
      expect(r!.taillePx).toBeCloseTo(taille, 0);
      expect(r!.texte).toBe(texte);
      expect(r!.couleur).toBe('#1a1a1a');
      expect(r!.souligne).toBe(false);
    }
  });

  it('plusieurs segments et soulignement', async () => {
    const svg = await ancienSvg([
      seg('Martin ', 'Pacifico', 20, { color: '#ff0000' }),
      seg('& Co', 'Lora', 14, { underline: true }),
    ]);
    const r = (await typo.identifier(svg))!;
    expect(r.texte).toBe('Martin & Co');
    expect(r.segments.map((s) => s.police)).toEqual(['Pacifico', 'Lora']);
    expect(r.segments[0].couleur).toBe('#ff0000');
    expect(r.segments[1].souligne).toBe(true);
    expect(r.segments[0].souligne).toBe(false);
  });

  it("renvoie null plutôt que de deviner", async () => {
    expect(await typo.identifier('<svg><path d="M0 0L10 0L10 10Z" fill="#000"/></svg>')).toBeNull();
    expect(await typo.identifier('<svg></svg>')).toBeNull();
  });
});
