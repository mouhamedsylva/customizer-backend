# Système de Modèles de Messages Personnalisables

## Vue d'ensemble

Cette fonctionnalité permet à l'admin de personnaliser les messages envoyés aux clients lors de la facturation et des relances, remplaçant les messages précédemment codés en dur.

## Fonctionnalités

### 1. Interface d'Administration
- Nouveau menu "Messages" dans les paramètres du dashboard admin
- Gestion des modèles par type (factures, relances)
- Éditeur de modèles avec prévisualisation
- Support des variables de substitution

### 2. Variables Disponibles
- `{nom}` - Nom du client
- `{produit}` - Nom du produit/coin personnalisé
- `{quantite}` - Quantité commandée
- `{total}` - Montant total avec devise
- `{entreprise}` - Nom de l'entreprise du client

### 3. Types de Messages
- **Factures** (`invoice`) - Messages envoyés lors de l'envoi d'une facture
- **Relances** (`reminder`) - Messages envoyés pour les relances automatiques et manuelles

## Architecture

### Entités
- `MessageTemplate` - Stocke les modèles de messages avec métadonnées

### Services
- `MessageTemplateService` - Gestion CRUD des modèles et génération de messages
- Intégration dans `AdminController`, `RemindersService`

### API Endpoints
- `GET /api/admin/message-templates` - Liste tous les modèles
- `GET /api/admin/message-templates/:type` - Modèles par type
- `POST /api/admin/message-templates` - Créer/modifier un modèle
- `POST /api/admin/message-templates/:id/delete` - Supprimer un modèle
- `GET /api/admin/message-templates/preview/:type` - Prévisualiser avec données d'exemple

## Migration et Compatibilité

### Rétrocompatibilité
- Les anciens messages codés en dur sont utilisés comme fallback
- Migration automatique vers les modèles par défaut au démarrage
- Aucune interruption de service

### Migration Base de Données
```sql
-- Nouvelle table pour les modèles de messages
CREATE TABLE message_templates (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  type VARCHAR(50) NOT NULL,
  name VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  isActive TINYINT(1) DEFAULT 1,
  isDefault TINYINT(1) DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type_default (type, isDefault),
  INDEX idx_type_active (type, isActive)
);
```

### Modèles par Défaut
Lors du premier démarrage, le système crée automatiquement :

**Facture standard** (type: `invoice`)
```
Bonjour {nom},

Voici votre devis pour {produit}. Vous pouvez le régler directement via le lien ci-dessous.

Merci de votre confiance.
L'équipe Custom Textile
```

**Relance standard** (type: `reminder`)
```
Bonjour {nom},

Nous revenons vers vous au sujet de votre devis pour {produit}, qui reste en attente de règlement.

Vous pouvez le régler directement via le lien ci-dessous. N'hésitez pas à nous écrire si vous avez la moindre question.

Bien cordialement,
L'équipe Custom Textile
```

## Utilisation

### Interface Admin
1. Aller dans Paramètres > Messages
2. Choisir le type de message (Factures/Relances)
3. Créer un nouveau modèle ou modifier un existant
4. Utiliser les variables `{nom}`, `{produit}`, etc. dans le contenu
5. Marquer comme "par défaut" si souhaité
6. Prévisualiser avant d'enregistrer

### Intégration Automatique
- Les nouveaux modèles sont automatiquement utilisés pour :
  - L'envoi de factures depuis le dashboard
  - Les relances automatiques configurées
  - Les relances manuelles

### Système de Fallback
Si aucun modèle n'est configuré ou en cas d'erreur :
1. Le système utilise les anciens messages codés en dur
2. Aucune interruption de service
3. Log d'avertissement pour l'admin

## Sécurité

### Validation
- Types de messages restreints (`invoice`, `reminder`)
- Validation des champs requis (nom, contenu)
- Échappement HTML dans l'interface

### Variables
- Substitution sécurisée avec valeurs par défaut
- Pas d'exécution de code arbitraire
- Variables prédéfinies uniquement

## Tests

### Tests Unitaires
- Validation des modèles
- Génération de messages
- Substitution de variables
- Gestion des erreurs

### Tests d'Intégration
- API endpoints
- Interface admin
- Intégration avec Shopify
- Fallback en cas d'erreur

## Monitoring

### Logs
- Initialisation des modèles par défaut
- Erreurs de génération de messages
- Utilisation des fallbacks

### Métriques
- Nombre de modèles par type
- Utilisation des modèles vs fallback
- Erreurs de substitution de variables

## Extension Future

### Nouvelles Variables
Pour ajouter une variable :
1. Mettre à jour `replaceVariables()` dans `MessageTemplateService`
2. Ajouter la documentation dans l'interface
3. Mettre à jour les exemples de prévisualisation

### Nouveaux Types
Pour ajouter un type de message :
1. Ajouter le type dans la validation
2. Créer un modèle par défaut
3. Intégrer dans le processus d'envoi correspondant

### Fonctionnalités Avancées
- Modèles conditionnels (selon le produit, montant, etc.)
- Pièces jointes dans les modèles
- Planification d'envoi
- A/B testing des messages