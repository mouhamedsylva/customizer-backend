import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../database/entities/setting.entity';

/**
 * DÉLAIS DE PRODUCTION affichés au client, réglables depuis le dashboard.
 *
 * Ils étaient écrits en dur dans le thème (assets/conf-delais.js) : les changer
 * demandait de modifier le code et de pousser le thème. Ils sont désormais
 * servis avec les prix (GET /api/pricing → `delais`) ; le thème garde son
 * barème comme repli si le backend ne répond pas.
 *
 * Par produit :
 *   - delai   : texte affiché (« 2-3 semaines ») ;
 *   - seuil   : facultatif — À PARTIR de ce nombre de pièces (strictement
 *               supérieur, comme avant : « jusqu'à 10 » inclut 10)…
 *   - grand   : …ce délai s'applique à la place.
 */
export const PRODUITS_DELAIS = [
  'sweatshirt',
  'tshirt',
  'tshirt_polyester',
  'patches',
  'coins',
  'drapeaux',
] as const;
export type ProduitDelai = (typeof PRODUITS_DELAIS)[number];

export const LIBELLES_DELAIS: Record<ProduitDelai, string> = {
  sweatshirt: 'Sweatshirt',
  tshirt: 'T-shirt coton',
  tshirt_polyester: 'T-shirt polyester',
  patches: 'Patchs',
  coins: 'Coins métal',
  drapeaux: 'Drapeaux',
};

export interface RegleDelai {
  delai: string;
  seuil: number | null;
  grand: string | null;
}
export type Delais = Record<ProduitDelai, RegleDelai>;

/** Barème actuel du thème (conf-delais.js) : valeurs par défaut. */
const TEXTILE: RegleDelai = { delai: '2-3 semaines', seuil: 10, grand: '3-4 semaines' };
const ATELIER: RegleDelai = { delai: '5 à 7 semaines', seuil: null, grand: null };
export const DELAIS_DEFAUT: Delais = {
  sweatshirt: { ...TEXTILE },
  tshirt: { ...TEXTILE },
  tshirt_polyester: { ...TEXTILE },
  patches: { ...ATELIER },
  coins: { ...ATELIER },
  drapeaux: { ...ATELIER },
};

const CLE = 'delais_production';
const LONGUEUR_MAX = 40;

/** Texte affichable : 1 à 40 caractères, sans balise. */
function texte(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  return t && t.length <= LONGUEUR_MAX ? t : null;
}

/**
 * Valide UNE règle. Renvoie la règle propre, ou un message d'erreur.
 * `seuil` et `grand` vont ensemble : l'un sans l'autre n'a pas de sens.
 */
export function validerRegle(
  produit: string,
  brut: unknown,
): { regle?: RegleDelai; erreur?: string } {
  const r = (brut && typeof brut === 'object' ? brut : {}) as Record<string, unknown>;
  const nom = LIBELLES_DELAIS[produit as ProduitDelai] || produit;
  const delai = texte(r.delai);
  if (!delai) return { erreur: `${nom} : délai vide ou trop long (${LONGUEUR_MAX} caractères max).` };

  const seuilVide = r.seuil === null || r.seuil === undefined || r.seuil === '';
  const grandVide = r.grand === null || r.grand === undefined || String(r.grand).trim() === '';
  if (seuilVide && grandVide) return { regle: { delai, seuil: null, grand: null } };
  if (seuilVide || grandVide) {
    return { erreur: `${nom} : renseignez à la fois le nombre de pièces et le délai grande quantité, ou aucun des deux.` };
  }
  const seuil = Number(r.seuil);
  if (!Number.isInteger(seuil) || seuil < 1 || seuil > 100000) {
    return { erreur: `${nom} : nombre de pièces invalide.` };
  }
  const grand = texte(r.grand);
  if (!grand) return { erreur: `${nom} : délai grande quantité vide ou trop long.` };
  return { regle: { delai, seuil, grand } };
}

@Injectable()
export class DelaisService {
  constructor(
    @InjectRepository(Setting)
    private readonly repo: Repository<Setting>,
  ) {}

  /** Délais de tous les produits : enregistrés, complétés par les défauts. */
  async get(): Promise<Delais> {
    const out: Delais = JSON.parse(JSON.stringify(DELAIS_DEFAUT));
    const ligne = await this.repo.findOne({ where: { key: CLE } });
    if (!ligne?.value) return out;
    let enBase: Record<string, unknown> = {};
    try {
      enBase = JSON.parse(ligne.value) || {};
    } catch {
      return out; // valeur corrompue : barème par défaut plutôt qu'une panne
    }
    for (const p of PRODUITS_DELAIS) {
      if (!(p in enBase)) continue;
      const { regle } = validerRegle(p, enBase[p]);
      if (regle) out[p] = regle;
    }
    return out;
  }

  /**
   * Enregistre les délais fournis (partiel accepté). TOUT ou RIEN : une seule
   * règle invalide fait refuser l'ensemble, avec son message — l'admin
   * corrige au lieu de découvrir plus tard un barème à moitié appliqué.
   */
  async save(input: Record<string, unknown>): Promise<Delais> {
    const actuels = await this.get();
    const erreurs: string[] = [];
    for (const p of PRODUITS_DELAIS) {
      if (!input || !(p in input)) continue;
      const { regle, erreur } = validerRegle(p, input[p]);
      if (erreur) erreurs.push(erreur);
      else if (regle) actuels[p] = regle;
    }
    if (erreurs.length) throw new BadRequestException(erreurs.join(' '));
    await this.repo.manager.transaction(async (trx) => {
      await trx.getRepository(Setting).save({ key: CLE, value: JSON.stringify(actuels) });
    });
    return this.get();
  }
}
