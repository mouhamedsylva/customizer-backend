-- GRILLE DES PATCHS — tarif officiel HT (septembre 2026).
--
--   1-10 → 20 € · 11-29 → 12,50 € · 30-49 → 9 € · 50-99 → 5 € · 100 → 3,50 € HT
--   Au-delà de 100 : sur demande (devis).
--
-- Les prix des patchs sont AFFICHÉS HT dans le configurateur, sans TVA
-- ajoutée ; la fenêtre de chiffrage les traite comme HT (PRIX_HT_KEYS).
--
-- POURQUOI CE FICHIER : une grille enregistrée depuis le panneau « Prix » du
-- dashboard (table `settings`) REMPLACE les valeurs par défaut du code. Si
-- l'ancienne grille y figure (2e palier à 20 pièces), le correctif du code
-- resterait sans effet. Ce fichier pose la grille officielle — même résultat
-- que la saisir à la main dans le panneau « Prix ».
--
-- Rejouable sans risque. Sur le VPS :
--   docker compose exec -T db mysql -u<user> -p<pass> <base> < ce_fichier.sql

INSERT INTO `settings` (`key`, `value`, `updatedAt`)
VALUES ('price_patches', '20', NOW(6))
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updatedAt` = NOW(6);

INSERT INTO `settings` (`key`, `value`, `updatedAt`)
VALUES ('tiers_patches',
        '[{"min":100,"price":3.5},{"min":50,"price":5},{"min":30,"price":9},{"min":11,"price":12.5},{"min":10,"price":20}]',
        NOW(6))
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`), `updatedAt` = NOW(6);

-- Contrôle : les deux lignes ci-dessous doivent afficher la grille officielle.
SELECT `key`, `value` FROM `settings` WHERE `key` IN ('price_patches', 'tiers_patches');
