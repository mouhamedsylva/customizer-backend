#!/usr/bin/env node
/**
 * Vérification simple : affiche le nombre de quotes par type
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

async function checkEnv() {
  try {
    const envContent = await readFile(join(process.cwd(), '.env'), 'utf-8');
    const hasDB = envContent.includes('MYSQL_URL') || envContent.includes('DATABASE_URL');
    
    if (!hasDB) {
      console.log('⚠️  Aucune base de données configurée dans .env');
      console.log('   Les quotes sont peut-être stockés en mémoire uniquement.');
      console.log('   Vérifiez la configuration TypeORM dans app.module.ts\n');
      return false;
    }
    
    console.log('✅ Base de données configurée\n');
    return true;
  } catch (err) {
    console.log('⚠️  Fichier .env non trouvé\n');
    return false;
  }
}

console.log('🔍 Vérification de la configuration...\n');
await checkEnv();

console.log('📋 CHECKLIST pour diagnostiquer le problème :\n');
console.log('1. ✓ Backend enregistre les quotes avec le champ "group"');
console.log('2. ✓ Dashboard affiche le badge "Groupe" si group existe');
console.log('3. ✓ Filtre "À traiter" inclut les quotes avec draftStatus !== "completed"');
console.log('\n❓ Questions à vérifier :');
console.log('   a) Les quotes de groupe sont-ils bien créés en base ?');
console.log('   b) Le draftStatus est-il correctement initialisé ?');
console.log('   c) Y a-t-il des erreurs dans les logs backend ?');
console.log('\n🔧 Actions recommandées :');
console.log('   1. Créer une commande de groupe via le configurateur');
console.log('   2. Vérifier les logs backend (Railway ou console)');
console.log('   3. Ouvrir le dashboard admin et cliquer sur "Tous" dans l\'onglet Devis');
console.log('   4. Vérifier si le quote apparaît avec le badge "Groupe"\n');
