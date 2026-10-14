/**
 * Rattache le DRAPEAU FR aux commandes où il manque dans les fichiers.
 *
 *   node dist/scripts/rattacher-drapeau-fr.js                    à blanc : liste
 *   node dist/scripts/rattacher-drapeau-fr.js --ecrire           corrige
 *   node dist/scripts/rattacher-drapeau-fr.js --commande 20884 --manche droite --ecrire
 *       commande antérieure au 05/10/2026 (sans repère « (manquant) ») :
 *       manche à indiquer à la main (gauche | droite), ligne 1 par défaut
 *       (--ligne N)
 *
 * POURQUOI : le drapeau est un fichier du THÈME, dont Shopify donne l'adresse
 * sans protocole (« //massacre-officiel.com/cdn/… »). Le configurateur la
 * refusait comme visuel hébergé : le drapeau figurait sur la planche, mais pas
 * dans les fichiers de la commande. Depuis le 05/10/2026, la ligne porte un
 * repère « _Logo manche droite (manquant) » ; avant, rien.
 *
 * Le drapeau étant TOUJOURS le même fichier, on le rattache sans hésitation
 * aux lignes portant ce repère. Rangement : `typoRetrouvee[ligne].__assets`
 * (dashboard, fiche de production, ZIP ; le repère est alors masqué). La
 * commande Shopify n'est PAS modifiée.
 *
 * ⚠ Le repère « (manquant) » signale tout logo de manche non transmis, pas
 * seulement le drapeau : vérifiez sur la planche de chaque commande listée.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Order } from '../database/entities/order.entity';
import { logoManquant } from '../shared/zones-texte';

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('dotenv').config();
} catch {
  /* variables déjà dans l'environnement (docker compose) */
}

const arg = (nom: string): string | null => {
  const i = process.argv.indexOf(nom);
  return i > 0 ? String(process.argv[i + 1] ?? '') : null;
};

async function main(): Promise<void> {
  const ecrire = process.argv.includes('--ecrire');
  const numero = (arg('--commande') || '').replace(/^#/, '');
  const manche = (arg('--manche') || '').toLowerCase();
  const ligneForcee = Math.max(1, parseInt(arg('--ligne') || '1', 10) || 1) - 1;
  const drapeau =
    arg('--url') || 'https://massacre-officiel.com/cdn/shop/t/18/assets/france_flag.png';
  if (!/^https:\/\/(www\.)?massacre-officiel\.com\/cdn\/shop\//.test(drapeau)) {
    throw new Error('--url : adresse https://massacre-officiel.com/cdn/shop/… attendue.');
  }
  if (manche && !['gauche', 'droite'].includes(manche)) throw new Error('--manche : gauche ou droite.');
  if (manche && !numero) throw new Error('--manche s’utilise avec --commande.');

  const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MYSQL_URL ou DATABASE_URL manquant.');
  const base = new DataSource({ type: 'mysql', url, entities: [Order], charset: 'utf8mb4', synchronize: false });
  await base.initialize();
  const depot = base.getRepository(Order);

  const commandes = numero
    ? await depot.find({ where: [{ orderNumber: `#${numero}` }, { orderNumber: numero }, { shopifyOrderId: numero }] })
    : await depot.find({ where: { fromConfigurator: true }, order: { receivedAt: 'DESC' } });
  if (numero && !commandes.length) throw new Error(`Commande ${numero} introuvable.`);

  let aCorriger = 0;
  for (const o of commandes) {
    const lignes: any[] = Array.isArray(o.lineItems) ? o.lineItems : [];
    const t: Record<string, any> = { ...(o.typoRetrouvee || {}) };
    const ajouts: Array<{ ligne: number; label: string }> = [];

    if (manche) {
      if (!lignes[ligneForcee]) throw new Error(`La commande n'a pas de ligne ${ligneForcee + 1}.`);
      ajouts.push({ ligne: ligneForcee, label: `Logo manche ${manche}` });
    } else {
      lignes.forEach((li, i) => {
        for (const p of Array.isArray(li?.properties) ? li.properties : []) {
          const label = logoManquant(p?.name);
          if (label && /^Logo manche/i.test(label)) ajouts.push({ ligne: i, label });
        }
      });
    }

    const nouveaux = ajouts.filter(({ ligne, label }) => {
      const liste: any[] = Array.isArray(t[ligne]?.__assets) ? t[ligne].__assets : [];
      return !liste.some((a) => a?.label === label);
    });
    if (!nouveaux.length) continue;

    aCorriger++;
    for (const { ligne, label } of nouveaux) {
      console.log(`  ${o.orderNumber} ligne ${ligne + 1} : « ${label} » ← drapeau FR`);
      const parLigne = { ...(t[ligne] || {}) };
      parLigne.__assets = [...(Array.isArray(parLigne.__assets) ? parLigne.__assets : []), { label, url: drapeau }];
      t[ligne] = parLigne;
    }
    if (ecrire) {
      // `update` sur la seule colonne : rien d'autre de la commande n'est touché.
      await depot.update({ shopifyOrderId: o.shopifyOrderId }, { typoRetrouvee: t as any });
    }
  }

  console.log(
    `\n  ${aCorriger} commande(s) concernée(s).` +
      (ecrire ? ' Corrigées.' : '\n  À BLANC : rien n’a été écrit. Vérifiez les planches, puis relancez avec --ecrire.'),
  );
  await base.destroy();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
