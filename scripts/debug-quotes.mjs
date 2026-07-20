#!/usr/bin/env node
/**
 * Script de diagnostic : affiche tous les quotes en base
 * pour vérifier si les commandes de groupe sont bien enregistrées.
 * 
 * Usage : node scripts/debug-quotes.mjs
 */

import 'dotenv/config';
import mysql from 'mysql2/promise';

async function main() {
  const dbUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  
  if (!dbUrl) {
    console.error('❌ Variable MYSQL_URL ou DATABASE_URL non définie');
    process.exit(1);
  }

  console.log('🔍 Connexion à la base de données...\n');
  
  const connection = await mysql.createConnection(dbUrl);

  try {
    // Récupérer tous les quotes
    const [quotes] = await connection.execute(
      'SELECT id, draftOrderId, draftStatus, totalPrice, createdAt, seen FROM quotes ORDER BY createdAt DESC'
    );

    if (!quotes || quotes.length === 0) {
      console.log('📭 Aucun devis trouvé dans la base de données.\n');
      process.exit(0);
    }

    console.log(`📊 ${quotes.length} devis trouvé(s) :\n`);
    console.log('─'.repeat(100));

    for (const quote of quotes) {
      // Récupérer les données détaillées
      const [details] = await connection.execute(
        'SELECT quoteData FROM quotes WHERE id = ?',
        [quote.id]
      );

      const quoteData = details[0]?.quoteData || {};
      const customer = quoteData.customer || {};
      const coin = quoteData.coin || {};
      const group = quoteData.group || null;

      console.log(`\n📝 Devis #${quote.id.substring(0, 8)}...`);
      console.log(`   Client      : ${customer.nom || 'N/A'} (${customer.email || 'N/A'})`);
      console.log(`   Produit     : ${coin.name || 'N/A'}`);
      console.log(`   Quantité    : ${coin.qty || 0}`);
      console.log(`   Statut      : ${quote.draftStatus || 'open'}`);
      console.log(`   Prix total  : ${quote.totalPrice || 'non chiffré'}`);
      console.log(`   Draft Order : ${quote.draftOrderId || 'N/A'}`);
      console.log(`   Créé le     : ${new Date(quote.createdAt).toLocaleString('fr-FR')}`);
      console.log(`   Vu          : ${quote.seen ? 'Oui ✓' : 'Non (nouveau)'}`);
      
      if (group) {
        console.log(`   🎯 COMMANDE DE GROUPE :`);
        console.log(`      - Type produit  : ${group.productType || 'N/A'}`);
        console.log(`      - Libellé       : ${group.productLabel || 'N/A'}`);
        console.log(`      - Total pièces  : ${group.pieces || 0}`);
        console.log(`      - Avec flocage  : ${group.hasFlock ? 'Oui' : 'Non'}`);
        console.log(`      - Lignes        : ${group.rows?.length || 0}`);
        
        if (group.rows && group.rows.length > 0) {
          console.log(`      - Exemple ligne :`);
          const firstRow = group.rows[0];
          console.log(`        * Nom     : ${firstRow.name || 'N/A'}`);
          console.log(`        * Taille  : ${firstRow.size || 'N/A'}`);
          console.log(`        * Couleur : ${firstRow.color || 'N/A'}`);
          console.log(`        * Flocage : ${firstRow.flock || '—'}`);
          console.log(`        * Qté     : ${firstRow.qty || 1}`);
        }
      } else {
        console.log(`   📦 Devis standard (coins/patches)`);
      }
      
      console.log('─'.repeat(100));
    }

    // Statistiques
    const groupQuotes = quotes.filter(q => {
      const [details] = connection.execute('SELECT quoteData FROM quotes WHERE id = ?', [q.id]);
      return details[0]?.quoteData?.group !== null;
    });
    
    console.log(`\n📈 STATISTIQUES :`);
    console.log(`   Total devis              : ${quotes.length}`);
    console.log(`   Devis ouverts            : ${quotes.filter(q => q.draftStatus === 'open' || !q.draftStatus).length}`);
    console.log(`   Factures envoyées        : ${quotes.filter(q => q.draftStatus === 'invoice_sent').length}`);
    console.log(`   Payés                    : ${quotes.filter(q => q.draftStatus === 'completed').length}`);
    console.log(`   Nouveaux (non vus)       : ${quotes.filter(q => !q.seen).length}`);
    console.log(`\n✅ Diagnostic terminé.\n`);

  } finally {
    await connection.end();
  }
}

main().catch(err => {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
});
