-- INDEX DE LA TABLE `quotes` — à lancer une fois. Rejouable sans risque.
--
-- La table n'avait AUCUN index hors clé primaire. Les tâches périodiques
-- (synchro des devis, devis orphelins, relances) trient des lignes COMPLÈTES
-- — colonne `quoteData` et ses aperçus de plusieurs Mo — sans index : MySQL
-- trie alors en mémoire, jusqu'à « Out of sort memory », déjà rencontré en
-- production (voir admin.service.ts). La tâche journalise un avertissement et
-- s'arrête : paiements non constatés, relances non envoyées, sans alerte.
-- Avec ces index, ORDER BY … LIMIT parcourt l'index sans tri.
--
-- Mêmes noms que les @Index de quote.entity.ts.
--
-- Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql

SET @db = DATABASE();

-- Listes du dashboard, synchro, orphelins, export : tri par date de création.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX `IDX_quotes_createdAt` ON `quotes` (`createdAt`)',
  'DO 0') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND INDEX_NAME = 'IDX_quotes_createdAt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Relances : draftStatus = 'invoice_sent' trié par invoiceSentAt.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX `IDX_quotes_status_invoiceSentAt` ON `quotes` (`draftStatus`, `invoiceSentAt`)',
  'DO 0') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND INDEX_NAME = 'IDX_quotes_status_invoiceSentAt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Synchro et orphelins : filtre sur la présence d'un brouillon Shopify.
SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX `IDX_quotes_draftOrderId` ON `quotes` (`draftOrderId`)',
  'DO 0') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND INDEX_NAME = 'IDX_quotes_draftOrderId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Compteur « nouveaux devis » du dashboard (interrogé toutes les 30 s).
SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX `IDX_quotes_seen` ON `quotes` (`seen`)',
  'DO 0') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND INDEX_NAME = 'IDX_quotes_seen');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Contrôle : les quatre index doivent apparaître.
SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS colonnes
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND INDEX_NAME LIKE 'IDX_quotes_%'
GROUP BY INDEX_NAME;
