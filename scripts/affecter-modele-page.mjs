/**
 * Affecte un MODÈLE (templateSuffix) à une page Shopify.
 *
 * Pourquoi ce script existe
 * -------------------------
 * Le sélecteur « Modèle » de l'admin ne liste que les templates du thème
 * ACTIF. Les templates du configurateur (`page.configurateur.json`,
 * `page.recapitulatif.json`) vivent dans le thème BROUILLON `t/18` : ils sont
 * donc impossibles à choisir depuis l'interface tant que le brouillon n'est pas
 * publié — ce que le commerçant ne veut pas faire.
 *
 * L'API Admin, elle, accepte n'importe quel suffixe : elle ne vérifie pas que
 * le template existe dans le thème actif. C'est la seule voie pour préparer les
 * pages avant la bascule.
 *
 * Usage
 * -----
 *   node scripts/affecter-modele-page.mjs <handle> <suffixe>
 *   node scripts/affecter-modele-page.mjs recapitulatif recapitulatif
 *
 * Sans argument `--ecrire`, le script ne fait que LIRE et montrer ce qu'il
 * changerait (marche à blanc).
 */
import { execute, boutique } from './pont-cli.mjs';

const [handleVoulu, suffixeVoulu] = process.argv.slice(2);
const ECRIRE = process.argv.includes('--ecrire');

if (!handleVoulu || !suffixeVoulu) {
  console.error('Usage : node scripts/affecter-modele-page.mjs <handle> <suffixe> [--ecrire]');
  process.exit(1);
}

/** Retrouve une page par son handle. `pages` n'a pas de filtre `handle:` en
 *  GraphQL Admin — on liste et on filtre côté client. Une boutique a peu de
 *  pages (12 ici), la première page de 50 résultats suffit. */
async function pageParHandle(handle) {
  const r = await execute(
    `query {
       pages(first: 50) {
         edges {
           node { id title handle templateSuffix isPublished }
         }
       }
     }`,
  );
  // execute() renvoie DÉJÀ le champ `data` de la réponse (pont-cli.mjs:124) :
  // pas de `r.data` supplémentaire ici.
  const noeuds = (r?.pages?.edges || []).map((e) => e.node);
  return { trouvee: noeuds.find((n) => n.handle === handle), toutes: noeuds };
}

async function principal() {
  console.log(`Boutique : ${boutique()}`);
  console.log('');

  const { trouvee, toutes } = await pageParHandle(handleVoulu);

  if (!trouvee) {
    console.error(`Page « ${handleVoulu} » INTROUVABLE.`);
    console.error('');
    console.error('Pages existantes :');
    for (const p of toutes) {
      console.error(
        `  ${p.handle.padEnd(24)} modele=${p.templateSuffix || '(defaut)'}`,
      );
    }
    process.exit(1);
  }

  console.log('Page trouvée :');
  console.log(`  titre          : ${trouvee.title}`);
  console.log(`  handle         : ${trouvee.handle}`);
  console.log(`  id             : ${trouvee.id}`);
  console.log(`  modele ACTUEL  : ${trouvee.templateSuffix || '(defaut)'}`);
  console.log(`  publiee        : ${trouvee.isPublished}`);
  console.log('');

  if (trouvee.templateSuffix === suffixeVoulu) {
    console.log(`Le modèle est déjà « ${suffixeVoulu} » — rien à faire.`);
    return;
  }

  if (!ECRIRE) {
    console.log(`MARCHE À BLANC : poserait templateSuffix = « ${suffixeVoulu} »`);
    console.log('Relancer avec --ecrire pour appliquer.');
    return;
  }

  const r = await execute(
    `mutation Affecter($page: PageUpdateInput!, $id: ID!) {
       pageUpdate(id: $id, page: $page) {
         page { id handle templateSuffix isPublished }
         userErrors { field message }
       }
     }`,
    {
      mutation: true,
      variables: { id: trouvee.id, page: { templateSuffix: suffixeVoulu } },
    },
  );

  const erreurs = r?.pageUpdate?.userErrors || [];
  if (erreurs.length) {
    console.error('ÉCHEC :');
    for (const e of erreurs) {
      console.error(`  ${(e.field || []).join('.')} ${e.message}`);
    }
    process.exit(1);
  }

  const apres = r?.pageUpdate?.page;
  console.log('Appliqué :');
  console.log(`  modele         : ${apres?.templateSuffix}`);
  console.log(`  publiee        : ${apres?.isPublished}`);
  console.log('');
  if (!apres?.isPublished) {
    console.log(
      'ATTENTION : la page est MASQUÉE. Shopify renvoie 404 sur une page non',
    );
    console.log(
      'publiée, y compris en prévisualisation de thème — la rendre Visible.',
    );
  }
}

principal().catch((e) => {
  console.error('Erreur :', e.message);
  process.exit(1);
});
