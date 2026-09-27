-- Typo du texte retrouvée depuis le SVG de découpe (anciennes commandes).
--
-- À APPLIQUER AVANT DE DÉPLOYER le code : l'entité Order déclare cette
-- colonne, et sans elle toute lecture ou écriture de commande échoue
-- (« Unknown column 'typoRetrouvee' ») — le dashboard entier tomberait.
--
-- Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql
--
-- Rejouable : échoue proprement si la colonne existe déjà.
--
-- Ensuite, pour remplir la colonne (voir scripts/retrouver-typo) :
--   node dist/scripts/retrouver-typo.js              (à blanc : affiche seulement)
--   node dist/scripts/retrouver-typo.js --appliquer  (écrit)

ALTER TABLE `orders`
  ADD COLUMN `typoRetrouvee` JSON NULL
  COMMENT 'Typo du texte retrouvée depuis le SVG (anciennes commandes)';
