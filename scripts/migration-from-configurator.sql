-- ============================================================================
-- Ajoute la colonne `fromConfigurator` a la table `orders`.
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
-- `DEFAULT FALSE` les met toutes a `false`, ce qui est le comportement voulu :
-- elles ne viennent pas du configurateur. Aucune reprise de donnees n'est
-- necessaire, et la synchro periodique ne les rejouera pas (elle borne sa
-- fenetre a la derniere commande connue).
--
-- UTILISATION (sur le VPS, avant de redemarrer le backend)
--   mysql -u customizer -p customizer < scripts/migration-from-configurator.sql
--
-- Idempotent : `IF NOT EXISTS` permet de relancer sans erreur.
-- ============================================================================

ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `fromConfigurator` TINYINT(1) NOT NULL DEFAULT 0;

-- Index : `getOrders()` filtre sur cette colonne a chaque affichage du
-- dashboard, et `getStatus()` y fait deux COUNT.
ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `IDX_orders_fromConfigurator` (`fromConfigurator`);

-- Verification : doit renvoyer 0 commande du configurateur sur l'historique.
SELECT
  COUNT(*)                                   AS total,
  SUM(`fromConfigurator` = 1)                AS du_configurateur,
  SUM(`fromConfigurator` = 0)                AS boutique
FROM `orders`;
