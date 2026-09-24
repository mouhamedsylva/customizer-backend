-- Rattachement d'une commande à son devis d'origine.
--
-- À APPLIQUER AVANT DE DÉPLOYER le code : sans cette colonne, tout
-- enregistrement de commande échoue (« Unknown column 'quoteId' »), et comme
-- c'est le seul chemin d'entrée des commandes, plus aucune n'arriverait dans
-- le dashboard.
--
-- Les migrations TypeScript du dossier ne sont jamais exécutées : le projet
-- n'a ni DataSource ni script `migration:run`. Ce fichier SQL est donc le
-- chemin réel. La version TypeScript existe pour la cohérence du dossier.
--
-- Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql
--
-- Rejouable sans risque : les deux instructions échouent proprement si la
-- colonne ou l'index existe déjà (MySQL n'a pas de IF NOT EXISTS sur ADD
-- COLUMN avant la 8.0.29 ; l'erreur est alors sans conséquence).

ALTER TABLE `orders`
  ADD COLUMN `quoteId` CHAR(36) NULL
  COMMENT 'Devis d''origine (UUID), null pour une vente directe';

CREATE INDEX `IDX_orders_quoteId` ON `orders` (`quoteId`);

-- ── Reprise de l'historique (FACULTATIF) ────────────────────────────────────
--
-- Renseigne `quoteId` pour les commandes DÉJÀ en base, en relisant la
-- propriété « Référence devis » stockée dans la colonne JSON `lineItems`.
-- Nécessite MySQL 5.7+ (JSON_TABLE exige 8.0 ; on reste ici sur une extraction
-- simple par recherche de chemin).
--
-- À exécuter une fois, APRÈS les deux instructions ci-dessus. Vérifiez le
-- résultat du SELECT avant de lancer l'UPDATE.
--
-- SELECT o.shopifyOrderId, o.orderNumber, q.id
--   FROM orders o
--   JOIN quotes q ON q.paidOrderId = o.shopifyOrderId
--  WHERE o.quoteId IS NULL;
--
-- UPDATE orders o
--   JOIN quotes q ON q.paidOrderId = o.shopifyOrderId
--    SET o.quoteId = q.id
--  WHERE o.quoteId IS NULL;
--
-- Cette reprise s'appuie sur `Quote.paidOrderId`, déjà renseigné par la
-- synchro périodique : elle récupère donc tous les devis payés déjà détectés.
