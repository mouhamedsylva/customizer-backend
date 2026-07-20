#!/usr/bin/env node
/**
 * Migration ponctuelle d'un devis d'une instance backend vers une autre.
 *
 * Contexte : deux backends Railway ont coexisté (4c83 et 6ed2) avec deux bases
 * distinctes. 6ed2 est retiré ; son devis impayé doit continuer d'être relancé
 * depuis 4c83.
 *
 * Pourquoi une insertion SQL directe plutôt que POST /api/quotes :
 *   - POST /api/quotes crée un NOUVEAU draft order Shopify (doublon) ;
 *   - il envoie un accusé de réception au client (Salomé a déjà reçu sa facture) ;
 *   - il ne permet pas de fixer draftStatus / invoiceSentAt / totalPrice, qui
 *     sont précisément ce qui déclenche les relances (voir reminders.service.ts:55).
 *
 * Le draftOrderId d'origine est conservé : la facture Shopify déjà envoyée
 * reste la référence, aucun doublon n'est créé côté Shopify.
 *
 * Usage :
 *   MYSQL_URL="mysql://..." node scripts/migrate-quote.mjs [--commit]
 *
 * Sans --commit : simulation (dry-run), rien n'est écrit.
 */

import mysql from 'mysql2/promise';

// SOURCE = 6ed2, l'ancienne instance retirée (c'est là qu'est le devis impayé).
// La CIBLE est 4c83, atteinte via MYSQL_URL — ne pas confondre les deux.
const SOURCE_API = 'https://customizer-backend-production-6ed2.up.railway.app/api';
const QUOTE_ID = 'fb79fdf0-527e-4c87-a730-dd01ce30dd86'; // Salomé Anastase, 1750 €

const COMMIT = process.argv.includes('--commit');
const MYSQL_URL = process.env.MYSQL_URL || process.env.DATABASE_URL;

if (!MYSQL_URL) {
  console.error('❌ MYSQL_URL manquante.');
  console.error('   Récupère-la dans Railway > projet exciting-warmth > MySQL > Variables,');
  console.error('   puis relance :');
  console.error('   MYSQL_URL="mysql://..." node scripts/migrate-quote.mjs');
  process.exit(1);
}

/** Récupère le devis source depuis l'ancienne instance. */
async function fetchSourceQuote() {
  const res = await fetch(`${SOURCE_API}/quotes`);
  if (!res.ok) throw new Error(`GET /quotes -> HTTP ${res.status}`);
  const all = await res.json();
  const q = all.find((x) => x.id === QUOTE_ID);
  if (!q) throw new Error(`Devis ${QUOTE_ID} introuvable sur la source.`);
  return q;
}

/** Formate une date ISO pour MySQL DATETIME, ou null. */
function toMysqlDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 19).replace('T', ' ');
}

const quote = await fetchSourceQuote();
const c = quote.quoteData?.customer || {};

console.log('📋 Devis à migrer');
console.log(`   client       : ${c.nom} <${c.email}>`);
console.log(`   montant      : ${quote.totalPrice} €`);
console.log(`   draftStatus  : ${quote.draftStatus}`);
console.log(`   draftOrderId : ${quote.draftOrderId} (conservé, pas de doublon Shopify)`);
console.log(`   invoiceSentAt: ${quote.invoiceSentAt}`);
console.log(`   relances     : ${quote.remindersSent}`);
console.log('');

const conn = await mysql.createConnection(MYSQL_URL);

try {
  // Idempotence : ne jamais insérer deux fois le même devis.
  const [existing] = await conn.execute('SELECT id FROM quotes WHERE id = ?', [
    quote.id,
  ]);
  if (existing.length) {
    console.log('✅ Ce devis est déjà présent sur la cible. Rien à faire.');
    process.exit(0);
  }

  const [before] = await conn.execute('SELECT COUNT(*) AS n FROM quotes');
  console.log(`   devis actuellement sur la cible : ${before[0].n}`);
  console.log('');

  if (!COMMIT) {
    console.log('🔍 DRY-RUN — aucune écriture effectuée.');
    console.log('   Relance avec --commit pour appliquer la migration.');
    process.exit(0);
  }

  await conn.execute(
    `INSERT INTO quotes
       (id, quoteData, draftOrderId, draftStatus, paidOrderId, totalPrice,
        invoiceSentAt, remindersSent, lastReminderAt, seen, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quote.id,
      JSON.stringify(quote.quoteData),
      quote.draftOrderId,
      quote.draftStatus,
      quote.paidOrderId,
      quote.totalPrice,
      toMysqlDate(quote.invoiceSentAt),
      quote.remindersSent ?? 0,
      toMysqlDate(quote.lastReminderAt),
      // seen = false : le devis réapparaît comme "nouveau" sur le dashboard cible.
      0,
      toMysqlDate(quote.createdAt),
    ],
  );

  const [after] = await conn.execute('SELECT COUNT(*) AS n FROM quotes');
  console.log('✅ Devis migré.');
  console.log(`   devis sur la cible : ${before[0].n} -> ${after[0].n}`);
  console.log('');
  console.log('   Les relances automatiques reprendront depuis 4c83');
  console.log('   (reminders.service.ts filtre sur draftStatus=invoice_sent).');
} finally {
  await conn.end();
}
