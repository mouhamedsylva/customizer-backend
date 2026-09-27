/**
 * Rattrapage : retrouve la typo du texte des ANCIENNES commandes depuis leur
 * SVG de découpe, et la range dans `orders.typoRetrouvee`.
 *
 *   node dist/scripts/retrouver-typo.js               à blanc : affiche seulement
 *   node dist/scripts/retrouver-typo.js --appliquer   écrit en base
 *   node dist/scripts/retrouver-typo.js --commande 20544   une seule commande
 *
 * Prérequis : la colonne existe (src/database/migrations/
 * 1759000000000-AddTypoRetrouveeToOrders.sql), et le script tourne depuis la
 * racine du backend (il lit assets/fonts).
 *
 * Connexion MINIMALE à la base, sans démarrer l'application : AppModule
 * lancerait aussi les synchros Shopify et les relances périodiques.
 *
 * Idempotent : une ligne qui a déjà des `_Texte*` (commande récente) ou une
 * typo retrouvée est ignorée. Un SVG non identifiable à coup sûr est signalé
 * et laissé vide — jamais de devinette.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { TypoSvgService, TypoRetrouvee } from '../shared/typo-svg.service';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

/** « _Texte face (SVG) » → zone ; mêmes libellés que collectTextAssets (thème). */
const ZONES: Record<string, string> = {
  'texte face': 'f',
  'texte poitrine droite': 'fr',
  'texte dos': 'b',
};

/** Seul l'hébergeur des fichiers de découpe est interrogé. */
const HOTES = ['res.cloudinary.com'];

function zoneDe(nom: string): string | null {
  const m = /^_?(.+?)\s*\(SVG\)$/i.exec(String(nom || '').trim());
  return m ? ZONES[m[1].toLowerCase()] ?? null : null;
}

async function telecharger(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !HOTES.includes(u.hostname)) return null;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const texte = await r.text();
    return texte.length < 5_000_000 ? texte : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const appliquer = process.argv.includes('--appliquer');
  const iCommande = process.argv.indexOf('--commande');
  const numero = iCommande > 0 ? String(process.argv[iCommande + 1] || '').replace(/^#/, '') : null;

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MYSQL_URL ou DATABASE_URL manquant.');

  const base = new DataSource({
    type: 'mysql',
    url,
    entities: [Order],
    charset: 'utf8mb4',
    synchronize: false,
  });
  await base.initialize();
  const depot = base.getRepository(Order);
  const typo = new TypoSvgService();

  const commandes = await depot.find(numero ? { where: { orderNumber: numero } } : {});
  let trouvees = 0, echecs = 0, ignorees = 0;

  for (const o of commandes) {
    const lignes: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
    const resultat: Record<string, Record<string, TypoRetrouvee>> = { ...(o.typoRetrouvee || {}) };
    let modifiee = false;

    for (let i = 0; i < lignes.length; i++) {
      const props: Array<{ name: string; value: string }> = Array.isArray(lignes[i]?.properties)
        ? lignes[i].properties
        : [];
      if (props.some((p) => /^_Texte[A-Z]/.test(String(p.name)))) continue; // commande récente

      for (const p of props) {
        const zone = zoneDe(p.name);
        if (!zone) continue;
        if (resultat[i]?.[zone]) {
          ignorees++;
          continue;
        }
        const svg = await telecharger(String(p.value));
        const r = svg ? await typo.identifier(svg) : null;
        const ref = `#${o.orderNumber ?? o.shopifyOrderId} ligne ${i + 1} ${p.name}`;
        if (!r) {
          echecs++;
          console.log(`  ✗ ${ref} : ${svg ? 'non identifiable' : 'SVG inaccessible'}`);
          continue;
        }
        trouvees++;
        console.log(
          `  ✓ ${ref} : « ${r.texte} » · ${r.police} · ${r.taillePx} px · ${r.couleur}` +
            (r.souligne ? ' · souligné' : ''),
        );
        resultat[i] = { ...(resultat[i] || {}), [zone]: r };
        modifiee = true;
      }
    }

    if (modifiee && appliquer) {
      /* `update` sur la seule colonne : ne touche rien d'autre de la commande. */
      await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: resultat as any });
    }
  }

  console.log(
    `\n  ${trouvees} texte(s) retrouvé(s), ${echecs} non identifiable(s), ${ignorees} déjà fait(s).` +
      (appliquer ? '\n  Écrit en base.\n' : '\n  À BLANC : rien n\'a été écrit. Relancez avec --appliquer.\n'),
  );
  await base.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
