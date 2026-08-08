/**
 * Pont vers l'API Admin via `shopify store execute` (GraphQL).
 *
 * Pourquoi ce module existe
 * -------------------------
 * Les scripts de ce dossier appellent l'API REST avec un token
 * `SHOPIFY_ACCESS_TOKEN` lu dans `.env`. Ce token est lié à UNE boutique : sur
 * `38cca3.myshopify.com` il renvoie **HTTP 401** (mesuré).
 *
 * `shopify store auth` autorise le CLI sur une autre boutique, mais **il ne
 * révèle pas son token** : il le range dans le trousseau du système. Impossible
 * donc de le réutiliser en REST. La seule voie est de passer par le CLI
 * lui-même — d'où ce pont.
 *
 * Conséquence : GraphQL uniquement. Le CLI n'expose pas l'API REST.
 *
 * Sécurité
 * --------
 * `execute()` refuse par défaut toute mutation. Il faut passer
 * `{ mutation: true }` explicitement, ce qui ajoute `--allow-mutations` à la
 * commande. Une écriture accidentelle est donc impossible : elle exige deux
 * décisions séparées (le drapeau du CLI et celui de cette fonction).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const execFileP = promisify(execFile);

/* Suffixe unique par appel : deux requêtes concurrentes ne doivent pas écrire
   dans le même fichier temporaire. */
let compteur = 0;

/** Boutique cible, sans schéma ni slash. Doit être le domaine .myshopify.com : */
/*  l'API Admin ne répond PAS sur un domaine personnalisé (mesuré : 301 sur
    massacre-officiel.com). */
export function boutique() {
  const b = process.env.SHOPIFY_STORE_URL || '';
  return b.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Exécute une requête GraphQL Admin via le CLI.
 *
 * @param {string} requete       la requête ou mutation GraphQL
 * @param {object} [opts]
 * @param {boolean} [opts.mutation]  true pour autoriser une ÉCRITURE
 * @param {object}  [opts.variables] variables GraphQL
 * @param {number}  [opts.timeout]   ms (défaut 120 000)
 * @returns {Promise<object>} le champ `data` de la réponse
 */
export async function execute(requete, opts = {}) {
  const store = boutique();
  if (!store) {
    throw new Error('SHOPIFY_STORE_URL non défini : impossible de savoir quelle '
      + 'boutique viser. Exportez-le avant de lancer le script.');
  }

  const estMutation = /^\s*mutation\b/.test(requete);
  if (estMutation && !opts.mutation) {
    throw new Error('Cette requête est une MUTATION (écriture) mais `mutation: true` '
      + 'n\'a pas été passé. Refus par sécurité — une écriture doit être demandée '
      + 'explicitement.');
  }

  /* La requête passe par un FICHIER, pas par `-q`.

     Raison : sous Windows, `shopify` est un `.cmd`, donc `execFile` exige
     `shell: true` — et le shell découpe alors la requête sur ses espaces
     (« Unexpected arguments: {, {, shop, name … »). Échapper les accolades et
     les guillemets d'une requête GraphQL pour cmd.exe est fragile ;
     `--query-file` supprime le problème à la racine. */
  const fichier = path.join(
    os.tmpdir(),
    `gql-${process.pid}-${compteur++}.graphql`,
  );
  fs.writeFileSync(fichier, requete, 'utf8');

  const args = ['store', 'execute', '-s', store, '-j', '--query-file', fichier];
  if (opts.mutation) args.push('--allow-mutations');
  if (opts.variables) {
    const fv = fichier.replace(/\.graphql$/, '.vars.json');
    fs.writeFileSync(fv, JSON.stringify(opts.variables), 'utf8');
    args.push('--variable-file', fv);
  }

  let sortie;
  try {
    const r = await execFileP('shopify', args, {
      timeout: opts.timeout || 120000,
      maxBuffer: 32 * 1024 * 1024,   // les inventaires peuvent être volumineux
      shell: true,                   // `shopify` est un .cmd sous Windows
    });
    sortie = r.stdout;
  } catch (e) {
    /* Le CLI écrit ses erreurs sur stdout ET stderr ; on remonte les deux, sinon
       le diagnostic est impossible. */
    const detail = [e.stdout, e.stderr].filter(Boolean).join('\n').slice(0, 600);
    throw new Error(`shopify store execute a échoué : ${e.message}\n${detail}`);
  } finally {
    /* Nettoyer même en cas d'échec : une requête peut contenir des données. */
    try { fs.unlinkSync(fichier); } catch { /* déjà absent */ }
    try { fs.unlinkSync(fichier.replace(/\.graphql$/, '.vars.json')); } catch { /* idem */ }
  }

  /* Le CLI préfixe sa sortie de lignes de progression (« Loading stored store
     auth … ») avant le JSON. On ne garde qu'à partir de la première accolade. */
  const i = sortie.indexOf('{');
  if (i === -1) throw new Error(`réponse sans JSON : ${sortie.slice(0, 300)}`);

  let json;
  try {
    json = JSON.parse(sortie.slice(i));
  } catch (e) {
    throw new Error(`réponse illisible : ${e.message}\n${sortie.slice(i, i + 300)}`);
  }

  if (json.errors) {
    throw new Error('erreurs GraphQL : ' + JSON.stringify(json.errors).slice(0, 400));
  }
  /* Le CLI renvoie parfois `data` à la racine, parfois son contenu directement. */
  return json.data || json;
}

/** Vérifie que l'accès fonctionne et renvoie l'identité de la boutique. */
export async function verifierAcces() {
  const d = await execute('query { shop { name myshopifyDomain } }');
  return d.shop;
}

/**
 * Cherche un produit par son `handle`.
 * @returns {Promise<object|null>} le produit, ou null s'il n'existe pas
 */
export async function produitParHandle(handle) {
  /* `productByIdentifier` est la voie propre ; on interroge aussi les variants
     et médias, car c'est ce qui détermine si un produit est « vierge ». */
  const d = await execute(`query {
    productByIdentifier(identifier: { handle: "${handle}" }) {
      id
      handle
      title
      status
      options { name optionValues { name } }
      variantsCount { count }
      media(first: 250) { nodes { id } }
    }
  }`);
  return d.productByIdentifier || null;
}
