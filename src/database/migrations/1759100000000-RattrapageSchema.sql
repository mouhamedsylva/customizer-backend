-- RATTRAPAGE DU SCHÉMA — à lancer une fois, puis à chaque doute.
--
-- Crée ce qui MANQUE, et seulement cela. Rejouable sans risque : chaque ajout
-- est précédé d'une vérification dans information_schema (MySQL 8.4 n'accepte
-- ni `ADD COLUMN IF NOT EXISTS` ni `ADD INDEX IF NOT EXISTS`).
--
-- POURQUOI : les migrations TypeScript du dossier ne sont jamais exécutées
-- (pas de DataSource ni de `migration:run`), et plusieurs tables ou colonnes
-- n'avaient AUCUN fichier .sql. Une colonne manquante fait échouer toutes les
-- requêtes sur sa table (« Unknown column … », incident du 28/09/2026 sur
-- `orders.typoRetrouvee`) ; une table manquante empêche l'application de
-- démarrer. Au démarrage, le backend liste désormais ce qui manque
-- (SchemaCheckService) et /api/health répond 503 tant qu'il en manque.
--
-- Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql

SET @db = DATABASE();

-- ── quotes.tempAttachments (pièces jointes de facture) ──────────────────────
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `quotes` ADD COLUMN `tempAttachments` JSON NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'quotes' AND COLUMN_NAME = 'tempAttachments');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── orders.quoteId + index (rattachement commande ↔ devis) ──────────────────
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `orders` ADD COLUMN `quoteId` CHAR(36) NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'quoteId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'CREATE INDEX `IDX_orders_quoteId` ON `orders` (`quoteId`)',
  'DO 0') FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'orders' AND INDEX_NAME = 'IDX_orders_quoteId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── orders.typoRetrouvee (typo des anciennes commandes) ─────────────────────
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `orders` ADD COLUMN `typoRetrouvee` JSON NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'typoRetrouvee');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── admins : colonnes ajoutées sans migration ───────────────────────────────
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `admins` ADD COLUMN `shopifyCustomerId` BIGINT NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'shopifyCustomerId');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `admins` ADD COLUMN `lastLoginAt` DATETIME NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'lastLoginAt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `admins` ADD COLUMN `passwordChangedAt` DATETIME NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'admins' AND COLUMN_NAME = 'passwordChangedAt');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ── message_templates (modèles de facture et de relance) ────────────────────
-- `type` NON unique : plusieurs modèles par type (un seul `isDefault`).
CREATE TABLE IF NOT EXISTS `message_templates` (
  `id` VARCHAR(36) NOT NULL,
  `type` VARCHAR(50) NOT NULL COMMENT 'Type de message : invoice, reminder, etc.',
  `name` VARCHAR(200) NOT NULL COMMENT 'Nom descriptif du modèle',
  `content` TEXT NOT NULL COMMENT 'Contenu du message avec variables {nom}, {produit}, etc.',
  `isActive` TINYINT NOT NULL DEFAULT 1,
  `isDefault` TINYINT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `IDX_MESSAGE_TEMPLATES_TYPE_DEFAULT` (`type`, `isDefault`),
  KEY `IDX_MESSAGE_TEMPLATES_TYPE_ACTIVE` (`type`, `isActive`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contrôle : ce qui suit doit lister les 6 colonnes et la table.
SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = @db AND (
   (TABLE_NAME = 'quotes' AND COLUMN_NAME = 'tempAttachments') OR
   (TABLE_NAME = 'orders' AND COLUMN_NAME IN ('quoteId', 'typoRetrouvee')) OR
   (TABLE_NAME = 'admins' AND COLUMN_NAME IN ('shopifyCustomerId', 'lastLoginAt', 'passwordChangedAt')));
SHOW TABLES LIKE 'message_templates';
