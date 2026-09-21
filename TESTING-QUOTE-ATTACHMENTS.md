# 🧪 Guide de Test - Pièces Jointes Devis

Ce guide détaille comment tester la nouvelle fonctionnalité de pièces jointes dans les devis.

## 🎯 Scénarios de Test

### **1. Test d'Upload Basique**

```bash
# 1. Se connecter à l'admin
curl -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'

# 2. Capturer le cookie de session dans la réponse
export ADMIN_COOKIE="admin-session=abc123..."

# 3. Tester l'upload d'un fichier
curl -X POST http://localhost:3000/api/uploads/quote-attachment \
  -H "Cookie: $ADMIN_COOKIE" \
  -F "file=@test.pdf"

# Réponse attendue:
{
  "url": "https://res.cloudinary.com/...",
  "publicId": "customizer/temp-attachments/test_1703...",
  "name": "test.pdf",
  "type": "application/pdf",
  "size": 12345
}
```

### **2. Test de Facturation avec Pièces Jointes**

```javascript
// Dans la console du navigateur sur l'admin
const testAttachments = [
  {
    name: "cahier_charges.pdf",
    url: "https://res.cloudinary.com/test/cahier_charges_123.pdf",
    type: "application/pdf",
    size: "2048000"
  },
  {
    name: "mockup.jpg", 
    url: "https://res.cloudinary.com/test/mockup_456.jpg",
    type: "image/jpeg",
    size: "1024000"
  }
];

// Simuler l'envoi de facture avec pièces jointes
fetch('/api/admin/quotes/test-quote-id/invoice', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    unitPrice: 29.99,
    message: "Voici votre devis avec documents techniques",
    attachments: testAttachments
  })
}).then(r => r.json()).then(console.log);
```

### **3. Test de l'Interface Utilisateur**

#### **Étapes manuelles :**
1. **Connexion Admin** : Se connecter au dashboard admin
2. **Ouvrir un devis** : Cliquer sur un devis en statut "open"
3. **Modal de facturation** : Cliquer "Chiffrer et envoyer la facture"
4. **Upload drag & drop** :
   - Glisser un fichier PDF dans la zone
   - Vérifier l'apparition dans la liste
   - Tester la suppression avec le bouton "×"
5. **Upload par clic** :
   - Cliquer dans la zone
   - Sélectionner plusieurs fichiers
   - Vérifier la progression d'upload
6. **Validation des erreurs** :
   - Tester avec un fichier > 10 MB
   - Tester avec un type non supporté (.exe)
   - Tester avec plus de 5 fichiers
7. **Envoi de facture** :
   - Saisir prix et message
   - Vérifier que les pièces jointes sont listées
   - Envoyer la facture
8. **Vérification Shopify** :
   - Ouvrir l'admin Shopify
   - Aller dans le draft order concerné
   - Vérifier les propriétés `_PièceJointe_*`

### **4. Test du Nettoyage Automatique**

```typescript
// Test en environnement de développement
import { CleanupService } from './src/shared/cleanup.service';

// Créer des pièces jointes expirées manuellement
const quote = await quotesRepo.findOne({ where: { id: 'test-quote' } });
quote.tempAttachments = [
  {
    name: 'old-file.pdf',
    url: 'https://res.cloudinary.com/test/old-file.pdf',
    type: 'application/pdf',
    uploadedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString() // 3 jours
  }
];
await quotesRepo.save(quote);

// Exécuter le nettoyage
const cleanup = app.get(CleanupService);
const result = await cleanup.forceCleanup();
console.log('Nettoyage:', result); // { cleaned: 1, errors: 0 }
```

## 🔍 Points de Vérification

### **Backend**

- [ ] **Upload endpoint** : `POST /api/uploads/quote-attachment` fonctionne
- [ ] **Validation types** : Rejette les types non autorisés
- [ ] **Validation taille** : Rejette les fichiers > 10 MB
- [ ] **Authentification** : Seuls les admins peuvent uploader
- [ ] **Stockage Cloudinary** : Fichiers stockés dans le bon dossier
- [ ] **Propriétés Shopify** : Ajoutées correctement au draft order
- [ ] **Nettoyage auto** : Supprime les fichiers expirés
- [ ] **Gestion erreurs** : Messages d'erreur appropriés

### **Frontend**

- [ ] **Interface drag & drop** : Fonctionne intuitivement
- [ ] **Progress upload** : Barre de progression visible
- [ ] **Liste fichiers** : Affichage nom, taille, type, statut
- [ ] **Suppression fichier** : Bouton × fonctionnel
- [ ] **Validation client** : Messages d'erreur appropriés
- [ ] **Limite 5 fichiers** : Avertissement affiché
- [ ] **Types MIME** : Validation côté client
- [ ] **Responsive** : Interface adaptée mobile
- [ ] **Intégration modal** : S'intègre bien au workflow existant

### **Intégration**

- [ ] **Email Shopify** : Facture envoyée avec succès
- [ ] **Propriétés visibles** : Dans l'admin Shopify
- [ ] **Workflow complet** : De l'upload à l'email
- [ ] **Performance** : Upload rapide même avec 5 fichiers
- [ ] **Nettoyage BDD** : Pas d'accumulation d'anciennes pièces jointes

## 🐛 Tests de Régression

### **Fonctionnalités Existantes**
Vérifier que l'ajout des pièces jointes n'affecte pas :

- [ ] **Envoi facture sans PJ** : Fonctionne comme avant
- [ ] **Devis existants** : Pas d'erreur sur anciens devis
- [ ] **Autres uploads** : Logo, preview, piece-jointe restent OK
- [ ] **Performance dashboard** : Pas de ralentissement
- [ ] **Mobile responsiveness** : Toujours fonctionnel

## 📊 Métriques à Surveiller

```sql
-- Nombre de devis avec pièces jointes
SELECT COUNT(*) FROM quotes 
WHERE tempAttachments IS NOT NULL 
  AND JSON_LENGTH(tempAttachments) > 0;

-- Taille moyenne des pièces jointes par devis
SELECT AVG(
  JSON_LENGTH(tempAttachments)
) FROM quotes 
WHERE tempAttachments IS NOT NULL;

-- Devis avec pièces jointes anciennes (à nettoyer)
SELECT id, createdAt, JSON_LENGTH(tempAttachments) as nb_fichiers
FROM quotes 
WHERE tempAttachments IS NOT NULL 
  AND draftStatus = 'open'
  AND createdAt < DATE_SUB(NOW(), INTERVAL 48 HOUR);
```

## 🔧 Dépannage

### **Erreurs Communes**

```bash
# Erreur 401 - Non authentifié
# Solution : Vérifier le cookie de session admin
curl -v -H "Cookie: admin-session=valid-token" ...

# Erreur 413 - Fichier trop volumineux  
# Solution : Vérifier la limite Nginx/serveur
client_max_body_size 25M;

# Erreur Cloudinary - Credentials
# Solution : Vérifier les variables d'environnement
echo $CLOUDINARY_CLOUD_NAME
echo $CLOUDINARY_API_KEY
```

### **Reset Complet**
```sql
-- Nettoyer toutes les pièces jointes temporaires
UPDATE quotes SET tempAttachments = NULL 
WHERE tempAttachments IS NOT NULL;
```

---

## ✅ Checklist de Mise en Production

Avant le déploiement :

- [ ] Tous les tests passent
- [ ] Documentation à jour
- [ ] Variables d'environnement configurées
- [ ] Migration de base de données appliquée
- [ ] Limites Nginx/serveur ajustées
- [ ] Monitoring configuré
- [ ] Plan de rollback prêt