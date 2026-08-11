-- ============================================================================
-- Ajoute la colonne `fromConfigurator` a la table `orders`.   [MySQL 8.4]
--
-- POURQUOI
-- Le dashboard de l'atelier affichait les 300 ventes courantes de la boutique
-- (chaussettes, jeux de societe...) alors qu'aucune n'a de flocage a produire.
-- Cette colonne marque les commandes issues du CONFIGURATEUR ; getOrders() et
-- getStatus() ne retiennent plus que celles-la.
--
-- POURQUOI UN SCRIPT MANUEL
-- `DB_SYNCHRONIZE=false` en production (et c'est voulu : TypeORM en mode
-- synchronise peut supprimer des colonnes lors d'un changement d'entite). Le
-- projet n'a pas de systeme de migration. Sans ce ALTER TABLE, le backend
-- demarre mais toute lecture de `orders` echoue : la colonne existe dans
-- l'entite, pas en base.
--
-- LES 300 COMMANDES EXISTANTES RESTENT MASQUEES
-- `DEFAULT 0` les met toutes a faux, ce qui est le comportement voulu : elles ne
-- viennent pas du configurateur. Aucune reprise de donnees n'est necessaire, et
-- la synchro periodique ne les rejouera pas (elle borne sa fenetre a la derniere
-- commande connue).
--
-- POURQUOI CES BLOCS PREPARE/EXECUTE
-- MySQL 8.4 n'accepte PAS `ADD COLUMN IF NOT EXISTS` ni `ADD INDEX IF NOT
-- EXISTS` : c'est une extension MariaDB. Relancer un simple ALTER TABLE
-- echouerait donc sur une base deja migree (« Duplicate column name »).
-- On interroge `information_schema` puis on n'execute l'ALTER que si necessaire,
-- ce qui rend le script rejouable sans erreur.
--
-- UTILISATION (sur le VPS, avant de redemarrer le backend)
--   mysql -u customizer -p customizer < scripts/migration-from-configurator.sql
--   docker compose exec -T db mysql -u customizer -p customizer < scripts/migration-from-configurator.sql
-- ============================================================================

-- ── 1) La colonne ───────────────────────────────────────────────────────────
SET @colonne_absente := (
  SELECT COUNT(*) = 0
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'orders'
    AND COLUMN_NAME  = 'fromConfigurator'
);

SET @sql := IF(
  @colonne_absente,
  'ALTER TABLE `orders` ADD COLUMN `fromConfigurator` TINYINT(1) NOT NULL DEFAULT 0',
  'DO 0'   -- deja presente : instruction neutre
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 2) L'index ──────────────────────────────────────────────────────────────
-- `getOrders()` filtre sur cette colonne a chaque affichage du dashboard, et
-- `getStatus()` y fait deux COUNT.
SET @index_absent := (
  SELECT COUNT(*) = 0
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME   = 'orders'
    AND INDEX_NAME   = 'IDX_orders_fromConfigurator'
);

SET @sql := IF(
  @index_absent,
  'ALTER TABLE `orders` ADD INDEX `IDX_orders_fromConfigurator` (`fromConfigurator`)',
  'DO 0'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ── 3) Verification ─────────────────────────────────────────────────────────
-- Attendu sur l'historique : du_configurateur = 0, boutique = total.
SELECT
  COUNT(*)                     AS total,
  SUM(`fromConfigurator` = 1)  AS du_configurateur,
  SUM(`fromConfigurator` = 0)  AS boutique
FROM `orders`;
