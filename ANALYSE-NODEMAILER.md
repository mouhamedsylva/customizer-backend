# Analyse Nodemailer — vers un envoi 100 % Shopify

**Date :** 2026-08-05
**Objectif exprimé :** ne conserver que les e-mails envoyés par Shopify
**Statut :** analyse seule — **aucune modification de code n'a été effectuée**

---

## 1. Résumé

Nodemailer est utilisé dans **5 fichiers** via un service unique
[src/shared/email.service.ts](src/shared/email.service.ts) exposant **5 méthodes**.

Le point décisif : **ces e-mails ne se valent pas**. Trois doublonnent des fonctions que
Shopify assure déjà (ou sont inertes), mais **deux n'ont aucun équivalent Shopify**. Les
supprimer sans remplacement crée deux trous fonctionnels réels.

Second constat, découvert en vérifiant l'interface : **les réglages de notification ne
sont pilotés par aucune UI**. `POST /api/admin/settings` et `POST /api/admin/settings/test-email`
n'apparaissent nulle part dans les 4 288 lignes de `admin.view.ts`. Les valeurs restent
donc aux défauts (`notifyEmailEnabled: false`), ce qui rend **`sendInternalAlert`
totalement inerte en production**.

---

## 2. Cartographie complète

### 2.1 Le service

| Fichier | Rôle |
|---|---|
| [src/shared/email.service.ts](src/shared/email.service.ts) | 323 lignes — transporteur SMTP + 3 templates HTML |
| [src/shared/shared.module.ts](src/shared/shared.module.ts) | Déclare et exporte `EmailService` (module `@Global`) |

### 2.2 Les consommateurs

| Fichier | Ligne | Méthode appelée | Destinataire |
|---|---|---|---|
| [src/quotes/quotes.service.ts](src/quotes/quotes.service.ts) | 350 | `sendQuoteEmail` | **Équipe** |
| [src/quotes/quotes.service.ts](src/quotes/quotes.service.ts) | 355 | `sendQuoteAck` | **Client** |
| [src/webhooks/webhooks.service.ts](src/webhooks/webhooks.service.ts) | 317 | `sendInternalAlert` | **Équipe** |
| [src/admin/admin.controller.ts](src/admin/admin.controller.ts) | 764 | `verifyConnection` | — (diagnostic) |
| [src/admin/admin.controller.ts](src/admin/admin.controller.ts) | 774 | `sendInternalAlert` | **Équipe** (test) |
| [src/orders/orders.service.ts](src/orders/orders.service.ts) | 96 | `sendOrderConfirmation` | **Client** |

---

## 3. Classement par substituabilité

### ✅ Groupe A — Supprimables sans perte

| Méthode | Pourquoi |
|---|---|
| `sendOrderConfirmation` | Appelée depuis `POST /api/orders`, route **réservée aux admins** que le thème n'appelle jamais (confirmé par le commentaire de `orders.controller.ts`). Shopify envoie déjà sa confirmation native sur toute commande réelle. **Doublon inutile.** |
| `sendInternalAlert` | Gardée par `if (!cfg.notifyEmailEnabled …) return`, et `notifyEmailEnabled` vaut `false` par défaut sans aucune UI pour l'activer. **Code mort en pratique.** |
| `verifyConnection` | Diagnostic SMTP. Sans SMTP, il n'a plus d'objet. |

### ⚠️ Groupe B — Aucun équivalent Shopify

| Méthode | Ce qui serait perdu |
|---|---|
| `sendQuoteEmail` | L'équipe reçoit un e-mail à **chaque nouveau devis**, avec le récapitulatif client et **les aperçus images intégrés**. Shopify crée bien le draft order, mais **ne notifie personne**. Sans cela, l'équipe doit surveiller le dashboard manuellement. |
| `sendQuoteAck` | Le client reçoit un accusé de réception **immédiat**. Shopify n'envoie rien tant que la facture n'est pas chiffrée et envoyée manuellement par l'équipe. Le client resterait donc **sans aucune confirmation** entre sa demande et le chiffrage — un délai potentiellement long. |

**Ces deux e-mails sont les seuls réellement actifs aujourd'hui.**

---

## 4. Ce que Shopify couvre déjà (aucune dépendance à Nodemailer)

| Flux | Mécanisme | Appelé depuis |
|---|---|---|
| Facture de devis au client | `sendDraftOrderInvoice` | [admin.controller.ts:204](src/admin/admin.controller.ts#L204) |
| Relance manuelle | `sendDraftOrderInvoice` | [admin.controller.ts:539](src/admin/admin.controller.ts#L539) |
| Relance automatique | `sendDraftOrderInvoice` | [reminders.service.ts:127](src/quotes/reminders.service.ts#L127) |
| E-mail d'expédition | `fulfillOrder({ notifyCustomer: true })` | [admin.controller.ts:268](src/admin/admin.controller.ts#L268) |
| Confirmation de commande | Natif Shopify (hors code) | — |

> Ces flux **survivent intégralement** à la suppression de Nodemailer.

---

## 5. Les trois scénarios

### Scénario 1 — Suppression totale

**Ce qui est retiré :** dépendance `nodemailer` + `@types/nodemailer`, `email.service.ts`,
les 6 points d'appel, les 6 variables `EMAIL_*`, et les routes `POST /api/admin/settings`
et `settings/test-email`.

**Ce qui est perdu :** les deux e-mails du groupe B.

**Compensation possible :** le dashboard possède déjà un panneau de notifications et des
compteurs « nouveau » alimentés par `GET /api/admin/status`, interrogé périodiquement.
L'équipe verrait donc les nouveaux devis **en consultant le dashboard**, mais sans
notification poussée. Le client, lui, n'aurait aucune compensation.

### Scénario 2 — Ne conserver que `sendQuoteAck`

**Ce qui est retiré :** `sendOrderConfirmation`, `sendInternalAlert`, `sendQuoteEmail`,
`verifyConnection`, la route de test SMTP.

**Ce qui est gardé :** Nodemailer + un seul template (accusé client).

**Bénéfice :** le client garde sa confirmation immédiate — le point de contact le plus
sensible commercialement. L'équipe s'appuie sur le dashboard.

**Coût :** le SMTP reste à maintenir (identifiants, réputation d'envoi, `EMAIL_*`).

### Scénario 3 — Ne retirer que le code inerte

**Ce qui est retiré :** `sendOrderConfirmation` (doublon) et `sendInternalAlert` (déjà
inerte), plus les routes `settings` non câblées.

**Ce qui est gardé :** le flux devis complet (`sendQuoteEmail` + `sendQuoteAck`).

**Bénéfice :** nettoyage sans aucune régression fonctionnelle.

**Coût :** Nodemailer reste dans le projet.

---

## 6. Comparatif

| Critère | Sc. 1 — Total | Sc. 2 — Accusé seul | Sc. 3 — Code mort |
|---|---|---|---|
| Nodemailer supprimé | ✅ | ❌ | ❌ |
| Variables `EMAIL_*` supprimées | ✅ (6) | ⚠️ (partiel) | ❌ |
| Équipe notifiée des devis | ❌ dashboard seul | ❌ dashboard seul | ✅ |
| Client confirmé immédiatement | ❌ | ✅ | ✅ |
| Régression fonctionnelle | **2** | **1** | **0** |
| Surface d'attaque réduite | ✅✅ | ✅ | ~ |

---

## 7. Plan d'exécution détaillé (scénario 1 — le plus complet)

Les scénarios 2 et 3 sont des sous-ensembles : il suffit d'omettre les étapes concernées.

### Étape 1 — `src/quotes/quotes.service.ts`

- Retirer l'import `EmailService, QuoteEmailData` (ligne 10)
- Retirer le paramètre `private readonly email: EmailService` du constructeur (ligne 24)
- Supprimer la méthode `sendEmailsBestEffort` (lignes 345-359)
- Supprimer la construction de `emailData` dans `create()` (lignes 122-133)
- Dans `processQuoteBestEffort`, retirer l'appel ligne 185 et le paramètre `emailData`

> ⚠️ `create()` retourne toujours `{ success, quoteId }` — **la signature publique ne
> change pas**, le thème n'est pas impacté.

### Étape 2 — `src/webhooks/webhooks.service.ts`

- Retirer l'import (ligne 13) et l'injection (ligne 59)
- Supprimer la méthode `notifyNewOrder` (lignes 306-331)
- Supprimer l'appel `void this.notifyNewOrder(...)` (lignes 274-276)

> ⚠️ **Interaction avec le correctif 2.1 de l'audit v2** (race du double e-mail) : si
> `notifyNewOrder` disparaît, ce correctif devient **sans objet**. Ne pas appliquer les
> deux. Trancher Nodemailer **avant** d'implémenter `notifiedAt`.

### Étape 3 — `src/orders/orders.service.ts`

- Retirer l'import (ligne 6) et l'injection (ligne 16)
- Supprimer `sendConfirmationBestEffort` (lignes 91-100) et son appel (lignes 71-85)

### Étape 4 — `src/admin/admin.controller.ts`

- Retirer l'import (ligne 25) et l'injection (ligne 47)
- Supprimer la route `POST settings/test-email` (lignes 747-792)
- **Décision à prendre** sur `POST settings` (lignes 709-740) : elle pilote aussi
  `reminderEnabled`, utilisé par les relances **Shopify**. La conserver en retirant
  seulement `notifyEmail*`, ou la supprimer si l'absence d'UI la rend inutile.

### Étape 5 — `src/admin/settings.service.ts`

- Retirer `notifyEmailEnabled` et `notifyEmail` de l'interface, des `DEFAULTS`, de `get()`
  et de `save()`
- **Conserver** `reminderEnabled` et `reminderDays` — ils pilotent les relances Shopify

### Étape 6 — Suppression et nettoyage

- Supprimer `src/shared/email.service.ts`
- Retirer `EmailService` de `shared.module.ts` (providers + exports)
- `npm uninstall nodemailer @types/nodemailer`
- Retirer les 6 variables de `.env`, `.env.example` et `.env.production.example` :
  `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASSWORD`,
  `EMAIL_FROM`, `EMAIL_TEAM`

### Étape 7 — Vérification

```bash
npm install          # node_modules local est incomplet (cf. audit v2)
npx tsc --noEmit -p tsconfig.build.json
grep -rn "nodemailer\|EmailService\|EMAIL_" src/    # doit ne rien retourner
```

Puis test fonctionnel : créer un devis via `POST /api/quotes` et confirmer que le draft
order Shopify est bien créé (le flux métier ne doit pas régresser).

---

## 8. Effets de bord bénéfiques

Supprimer Nodemailer résout au passage plusieurs points de l'audit v2 :

| Point | Effet |
|---|---|
| Correctif **2.1** (double e-mail) | Devient **sans objet** — plus d'e-mail à dédoublonner |
| Empreinte RAM | Un transporteur SMTP en moins sur un VPS 2 Go (cf. vague 0) |
| Surface d'attaque | 6 secrets de moins dans `.env` ; plus de risque de réputation SMTP |
| Point 5.6 de l'audit v1 | Le spam de devis n'entraîne plus 2 e-mails par requête — **mais le draft order Shopify reste créé**, donc le `@Throttle` recommandé reste nécessaire |

> ⚠️ Le dernier point est important : supprimer les e-mails **ne supprime pas** le besoin
> de limiter `POST /api/quotes`. Chaque appel crée toujours un draft order Shopify et
> consomme le quota API.

---

## 9. Ma recommandation

**Le scénario 2** me paraît le meilleur compromis, pour une raison précise : l'accusé de
réception est le seul e-mail que le **client** attend, et il n'existe aucune fenêtre où
Shopify le remplace. Entre la demande de devis et le chiffrage manuel par l'équipe, le
client n'a strictement aucun signal — ce silence est un risque commercial concret.

À l'inverse, l'alerte équipe (`sendQuoteEmail`) est bien compensable : le dashboard
affiche déjà les compteurs « nouveau » et un panneau de notifications rafraîchi
périodiquement.

**Si votre priorité est de supprimer Nodemailer intégralement**, le scénario 1 reste
parfaitement viable — à condition d'accepter ce délai de silence côté client, ou de le
compenser autrement (message de confirmation à l'écran, SMS, etc.).

---

## 10. Questions ouvertes

1. **L'équipe utilise-t-elle réellement l'e-mail « nouveau devis » aujourd'hui**, ou
   consulte-t-elle déjà le dashboard ? Cela tranche entre les scénarios 1 et 3.
2. **Un délai de silence côté client est-il acceptable** entre la demande de devis et
   l'envoi de la facture ? Cela tranche entre les scénarios 1 et 2.
3. **`POST /api/admin/settings` doit-elle être conservée ?** Elle n'est appelée par aucune
   UI, mais pilote `reminderEnabled` (relances Shopify). Si vous voulez pouvoir activer
   les relances un jour, il faut soit la garder, soit prévoir l'UI correspondante.
4. **Les relances automatiques sont-elles censées être actives ?** Elles sont à `false`
   par défaut et aucune UI ne les active : le `RemindersService` tourne toutes les heures
   pour ne rien faire. C'est indépendant de Nodemailer (les relances passent par Shopify),
   mais le constat mérite votre attention.
