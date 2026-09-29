import * as opentype from 'opentype.js';
import {
  TextOutlineService,
  choisirGraisse,
  enDonneesSvg,
  parseGraisse,
} from '../src/shared/text-outline.service';

/**
 * Vectorisation des textes : le SVG de découpe doit être ce que le client a vu.
 *
 * Chaque cas ci-dessous a été une régression réelle, visible dans le tableau
 * « Martin » (Police × 20–28 px) et dans l'aperçu SVG du dashboard.
 */
const segment = (text: string, fontFamily: string, fontSize = 20, extra = {}) => ({
  text,
  fontFamily,
  fontSize,
  fontWeight: '400',
  color: '#111111',
  ...extra,
});

function service(): TextOutlineService {
  const s = new TextOutlineService();
  (s as any).logger = { log() {}, debug() {}, warn() {}, error() {} };
  return s;
}

describe('enDonneesSvg', () => {
  it("n'écrit jamais NaN, là où opentype.js toPathData le faisait", () => {
    /* 93 + 3e-14 : la décimale infime qui faisait produire « NaN » à
       roundDecimal (« 3e-14e+2 »). Un NaN arrête le dessin du tracé. */
    const p = new opentype.Path();
    p.moveTo(0.1 + 0.2, 93.00000000000003);
    p.quadraticCurveTo(1e-15, 5, 7, -0.000000000001);
    p.close();
    const d = enDonneesSvg(p);
    expect(d).not.toMatch(/NaN|e[-+]/);
    expect(d).toBe('M0.3 93Q0 5 7 0Z');
  });
});

describe('graisse affichée', () => {
  it('suit la sélection CSS parmi les graisses chargées', () => {
    expect(choisirGraisse([700], 400)).toBe(700); // Lora non gras → 700 à l'écran
    expect(choisirGraisse([400], 800)).toBe(400); // Pacifico « gras » → 400
    expect(choisirGraisse([300, 400, 700], 600)).toBe(700);
    expect(choisirGraisse([300, 700], 400)).toBe(300);
    expect(parseGraisse('bold')).toBe(700);
    expect(parseGraisse(undefined)).toBe(400);
  });

  it('trace Lora et Dancing Script en 700, comme la boutique', async () => {
    const s = service();
    for (const police of ['Lora', 'Dancing Script', 'Montserrat']) {
      const chargee = await (s as any).chargerPolice(police, '400');
      expect(chargee.graisse).toBe(700);
    }
    expect((await (s as any).chargerPolice('Pacifico', '800')).graisse).toBe(400);
  });
});

describe('genererSvgVectoriel', () => {
  const cadreDuContour = (svg: string) => {
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.map(Number);
    const b = new opentype.BoundingBox();
    for (const [, d] of svg.matchAll(/<path d="([^"]*)"/g)) {
      const p = new opentype.Path();
      p.fromSVG(d, { flipY: false } as any);
      const bb = p.getBoundingBox();
      b.addPoint(bb.x1, bb.y1);
      b.addPoint(bb.x2, bb.y2);
    }
    return { w, h, b };
  };

  it.each(['Pacifico', 'Bungee', 'Dancing Script', 'Allura', 'Lora'])(
    '%s « Martin » 20–28 px : ni NaN, ni rognage, ni timbre-poste',
    async (police) => {
      const s = service();
      for (const taille of [20, 22, 24, 26, 28]) {
        const svg = (await s.genererSvgVectoriel([segment('Martin', police, taille)], {
          scale: 4,
          padding: 32,
        }))!;
        expect(svg).not.toMatch(/NaN|Infinity/);
        const { w, h, b } = cadreDuContour(svg);
        expect(b.x1).toBeGreaterThanOrEqual(0);
        expect(b.y1).toBeGreaterThanOrEqual(0);
        expect(b.x2).toBeLessThanOrEqual(w);
        expect(b.y2).toBeLessThanOrEqual(h);
        expect(((b.x2 - b.x1) * (b.y2 - b.y1)) / (w * h)).toBeGreaterThan(0.45);
        expect(h).toBeGreaterThanOrEqual(150); // lisible dans le dashboard (≈ 99 avant)
      }
    },
  );

  it("n'explose pas les glyphes composites (é de Merriweather 700)", async () => {
    const svg = (await service().genererSvgVectoriel([segment('Été', 'Merriweather')]))!;
    const { h } = cadreDuContour(svg);
    expect(h).toBeLessThan(400);
  });

  it('tout ou rien : un tracé invalide donne null, jamais une exception', async () => {
    const s = service();
    const errors: string[] = [];
    (s as any).logger.error = (m: string) => errors.push(m);

    // Coordonnée NaN dans le tracé : refusé, PNG seul.
    const casse = new opentype.Path();
    casse.moveTo(0, 0);
    casse.lineTo(NaN, 10);
    casse.lineTo(10, 10);
    (s as any).disposer = () => ({ chemin: casse, avance: 10 });
    await expect(s.genererSvgVectoriel([segment('Martin', 'Bungee')])).resolves.toBeNull();

    // Erreur au tracé des lettres : même issue, sans faire échouer la requête.
    (s as any).disposer = () => {
      throw new Error('glyphe illisible');
    };
    await expect(s.genererSvgVectoriel([segment('Martin', 'Bungee')])).resolves.toBeNull();

    expect(errors.length).toBe(2);
    expect(errors[0]).toContain('« Martin » (Bungee, 20 px)');
  });

  it('non-régression de la revue : aucun NaN sur les polices les plus touchées', async () => {
    const s = service();
    for (const police of ['Pacifico', 'Lora', 'Dancing Script', 'Allura', 'Bungee'])
      for (const texte of ['Martin', 'Team Alpha', 'Léa'])
        for (let taille = 14; taille <= 28; taille += 2) {
          const svg = await s.genererSvgVectoriel([segment(texte, police, taille)], { scale: 4, padding: 32 });
          expect(svg).not.toBeNull();
          expect(svg).not.toMatch(/NaN|Infinity|undefined/);
        }
  });

  it('plafonne la taille de sortie d’un texte énorme (route publique)', async () => {
    const long = 'M'.repeat(100);
    const segs = Array.from({ length: 20 }, () => segment(long, 'Bungee', 300));
    const svg = (await service().genererSvgVectoriel(segs, { scale: 8, padding: 32 }))!;
    const [, w, h] = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)!.map(Number);
    expect(w * h).toBeLessThan(60_000_000); // sous la limite de pixels de sharp
  });

  it('vectorise « Bebas » (retirée du thème) avec Bebas Neue', async () => {
    expect(await service().genererSvgVectoriel([segment('PAUL', 'Bebas')])).not.toBeNull();
  });

  it('renvoie null pour une police absente ou un texte vide', async () => {
    const s = service();
    expect(await s.genererSvgVectoriel([segment('x', 'Comic Sans')])).toBeNull();
    expect(await s.genererSvgVectoriel([segment('   ', 'Lora')])).toBeNull();
  });
});
