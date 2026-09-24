import {
  CONFIGURATOR_PRODUCT_IDS,
  CONFIGURATOR_PRODUCT_TITLES,
} from '../admin/pricing.service';

/**
 * Reconnaissance des commandes issues du configurateur.
 *
 * Extrait de `WebhooksService.saveOrder`, où cette logique vivait seule, pour
 * que la reprise de l'historique (`AdminService.reevaluerReconnaissance`)
 * applique EXACTEMENT les mêmes critères. Deux copies auraient divergé au
 * premier ajustement, et la reprise aurait alors produit un résultat différent
 * de l'enregistrement courant — le plus déroutant des défauts.
 */

/** Propriété portant l'UUID du devis, posée par quotes.service.ts. */
const RÉF_DEVIS = /^R[ée]f[ée]rence\s+devis/i;

/**
 * Format d'UUID exigé avant d'écrire la valeur en base.
 *
 * La propriété est recopiée depuis Shopify : une valeur inattendue (texte
 * libre, champ vidé) ne doit pas atterrir dans une colonne qui sert de clé de
 * jointure.
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ResultatReconnaissance {
  /** La commande contient au moins un article du configurateur. */
  reconnue: boolean;
  /** UUID du devis d'origine, si une référence exploitable a été trouvée. */
  quoteId: string | null;
}

/**
 * Évalue les lignes d'une commande.
 *
 * TROIS critères, du plus fiable au plus permissif :
 *
 *  1. `productId` — stable, insensible aux renommages.
 *
 *  2. `title` en PRÉFIXE, et non en égalité stricte : un patch demandé en devis
 *     s'intitule « Patch personnalisé (PVC) » ou « (Tissé) », la finition
 *     entrant dans le nom. Une comparaison exacte échouait sur toute finition.
 *
 *  3. La propriété « Référence devis ». Une ligne issue d'un devis est une
 *     ligne LIBRE (`custom: true`) : elle n'a AUCUN productId, et son titre est
 *     arbitraire. Cette référence est alors le seul point d'accroche — et c'est
 *     un marqueur propre au configurateur, qu'aucune vente de la boutique ne
 *     porte.
 *
 * Toutes les lignes sont parcourues, sans arrêt au premier succès : sur une
 * commande mixte, la référence devis peut n'apparaître qu'APRÈS une ligne déjà
 * reconnue par son productId, et elle serait alors perdue.
 */
export function evaluerLignes(
  lignes: Array<Record<string, any>>,
): ResultatReconnaissance {
  let reconnue = false;
  let quoteId: string | null = null;

  for (const li of lignes) {
    if (!li) continue;

    if (li.productId != null && CONFIGURATOR_PRODUCT_IDS.includes(li.productId)) {
      reconnue = true;
    } else if (typeof li.title === 'string') {
      const titre = li.title.toLowerCase();
      if (
        CONFIGURATOR_PRODUCT_TITLES.some((t) => titre.startsWith(t.toLowerCase()))
      ) {
        reconnue = true;
      }
    }

    if (Array.isArray(li.properties)) {
      for (const p of li.properties as Array<Record<string, any>>) {
        if (!RÉF_DEVIS.test(String(p?.name || ''))) continue;
        reconnue = true;
        /* Toutes les lignes d'un même devis portent le même UUID : la première
           valide suffit, il n'y a rien à arbitrer. */
        if (!quoteId) {
          const v = String(p?.value || '').trim();
          if (UUID.test(v)) quoteId = v;
        }
      }
    }

    if (reconnue && quoteId) break;
  }

  return { reconnue, quoteId };
}
