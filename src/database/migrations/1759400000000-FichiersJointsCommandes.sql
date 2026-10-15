-- FICHIERS JOINTS AUX COMMANDES (BAT, maquette…) — à lancer AVANT de déployer.
-- Rejouable sans risque : la colonne n'est créée que si elle manque.
--
-- Sans cette colonne, toute lecture de la table `orders` échoue (« Unknown
-- column ») et /api/health répond 503.
--
-- Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql

SET @db = DATABASE();

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `orders` ADD COLUMN `fichiersJoints` JSON NULL',
  'DO 0') FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'fichiersJoints');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Contrôle : la colonne doit apparaître.
SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'fichiersJoints';
