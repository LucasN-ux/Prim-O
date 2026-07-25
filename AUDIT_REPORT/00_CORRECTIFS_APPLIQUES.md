# Correctifs appliqués avant déploiement

Document destiné à l'équipe. Il récapitule ce qui a été corrigé, pourquoi ça comptait,
comment chaque correctif a été vérifié, et ce qui reste ouvert.

Branche : `featmateo`. Tout est commité, rien n'est en attente dans l'arbre de travail.

---

## Résumé en dix lignes

Un audit a été mené sur l'ensemble du projet et a produit environ 80 remontées, classées
dans ce dossier. Six bugs ont été corrigés, tous vérifiés en exécutant le code et pas
seulement en le relisant. Trois remontées se sont révélées être des faux positifs, et
les corriger aurait cassé la production : elles sont documentées plus bas pour que
personne ne les "corrige" par erreur.

Le plus grave de ce qui a été corrigé faisait disparaître des tokens achetés en euros,
sans trace et sans moyen de les récupérer autrement qu'en les rachetant.

---

## Les six correctifs

### 1. Les erreurs du webhook Stripe partaient en silence

**Fichier :** `backend/src/controllers/stripeWebhook.controller.ts`
**Commit :** `1f9b75d`

Quand le traitement d'un paiement échouait, le `catch` renvoyait un 500 sans écrire une
seule ligne. Stripe réessayait l'événement en boucle, et personne ne pouvait savoir
quelle session avait échoué ni pourquoi. Un paiement encaissé chez Stripe pouvait ne
jamais créditer l'entreprise, sans que rien ne le signale.

Le correctif logue trois choses : l'identifiant de la session Stripe pour la retrouver
dans leur tableau de bord, la cause, et la pile d'appel.

**Vérifié en :** forgeant un vrai événement Stripe signé avec le secret du `.env`, avec
des métadonnées vides pour faire échouer le traitement sans toucher à la base. Le log a
bien produit la ligne attendue avec l'identifiant de session et `INVALID_SESSION_METADATA`.

---

### 2. Un envoi d'email pouvait suspendre le serveur indéfiniment

**Fichier :** `backend/src/lib/mail.ts`
**Commit :** `1f9b75d`

L'appel à l'API Brevo se faisait sans délai maximum. Si Brevo ralentissait ou ne
répondait plus, la requête restait suspendue sans limite. Comme l'envoi est attendu
pendant l'inscription et pendant la demande de mot de passe oublié, ces deux parcours
se bloquaient avec elle.

Le correctif ajoute un `AbortController` à 10 secondes, avec un `clearTimeout` dans un
`finally` pour ne pas laisser traîner de minuteur quand l'envoi réussit.

**Vérifié en :** écrivant un test qui simule un Brevo muet. Contre-épreuve faite : en
remettant la version d'avant le correctif, le test échoue par dépassement de délai,
exactement comme le serveur restait suspendu.

---

### 3. Une promesse rejetée tuait le processus

**Fichier :** `backend/src/server.ts`
**Commit :** `1f9b75d`

Aucun `process.on('unhandledRejection')` n'était enregistré. Depuis Node 15, une promesse
rejetée qui n'est attrapée nulle part termine le processus. N'importe quel rejet oublié
dans un coin du code faisait donc tomber tout le serveur, sans explication dans les logs.

**Vérifié en :** déclenchant volontairement un rejet non attrapé sur une instance à part.
Le handler a écrit la cause et le processus a survécu.

---

### 4. Aucun arrêt propre, donc des requêtes coupées à chaque déploiement

**Fichier :** `backend/src/server.ts`
**Commit :** `1f9b75d`

Sans handler `SIGTERM`, l'hébergeur tue le processus net à chaque redéploiement. Une
requête en cours est interrompue au milieu. Le cas qui fait mal : une session de paiement
Stripe créée mais dont l'URL n'est jamais renvoyée au client.

Le correctif ferme le serveur, laisse les requêtes en cours se terminer, ferme la
connexion Prisma, puis sort. Sortie forcée au bout de 30 secondes si quelque chose bloque.

**Vérifié en :** envoyant un `SIGTERM` au build de production. Code de sortie 0 au lieu
de 143, et les deux lignes d'arrêt propre présentes dans le log.

Piège rencontré pendant ce test, à connaître : il faut viser le processus node lui-même.
Si on lance via `npx` ou `nodemon` et qu'on tue le wrapper, le vrai serveur devient
orphelin, continue d'écouter sur le port, et fausse complètement le résultat.

---

### 5. Un patron rétrogradé pouvait encore se servir dans le pool

**Fichiers :** `backend/src/services/attribution.service.ts`,
`backend/src/controllers/attribution.controller.ts`
**Commits :** `1f9b75d`, `509b06c`

La route `POST /api/attributions/allocate` ponctionne le pool de l'entreprise pour créer
une enveloppe. Elle est réservée au patron. Mais le contrôle lisait le rôle **dans le
jeton JWT**, jamais en base. Or un jeton d'accès vit 15 minutes : un patron rétrogradé
en manager gardait donc pendant un quart d'heure un jeton qui annonçait toujours OWNER,
et pouvait s'ouvrir des enveloppes à lui-même, avec le mode de rétribution de son choix.

Le correctif relit le rôle du créateur en base avant l'allocation. C'est la convention
déjà appliquée ailleurs dans le projet, le commentaire de `token.ts` la formule
explicitement : toute opération sensible doit revérifier la base.

Un second défaut a été trouvé en relisant ce correctif : l'erreur `UNAUTHORIZED` n'était
pas dans la table de correspondance du contrôleur, donc elle sortait en 500 au lieu de
403. Corrigé dans `509b06c`.

**Vérifié en :** fabriquant un jeton signé qui annonce OWNER pour un utilisateur qui est
MANAGER en base, puis en tentant l'allocation. Réponse 403. Comme les deux barrières
renvoient le même message, un marqueur temporaire a été posé pour prouver que le 403
venait bien de la nouvelle barrière et pas de l'ancienne.

Précision utile pour l'équipe : ce correctif **ne change pas** le fait qu'un manager
touche des tokens pour lui-même. Sa rétribution lui est créditée normalement au moment
où il distribue son enveloppe, cette logique n'a pas été touchée. Ce qui est bloqué,
c'est la création de l'enveloppe elle-même, qui reste une décision du patron.

---

### 6. Les tokens d'un manager qui part étaient détruits

**Fichiers :** `backend/src/services/attribution.service.ts`,
`backend/src/services/privacy.service.ts`, `backend/src/services/admin.service.ts`,
migration `20260725165317_add_annulee_allocation_status`
**Commit :** `452e1ef`

C'est le plus grave des six.

Allouer une enveloppe débite le pool de l'entreprise immédiatement, et seul le manager
propriétaire peut la distribuer. Donc dès que ce manager disparaît, l'enveloppe ne peut
plus jamais bouger. Les tokens sont perdus, et le seul autre moyen d'en remettre dans un
pool est d'en racheter par carte.

Quatre chemins mènent à la disparition d'un compte, et deux ne peuvent pas être bloqués :

| Chemin | Blocable |
|---|---|
| Un admin supprime le compte | oui |
| L'employeur retire un membre | oui |
| L'utilisateur exerce son droit à l'effacement RGPD | non, obligation légale |
| Le job d'anonymisation des comptes inactifs, toutes les 24 h | non, automatique |

Le dernier est le plus insidieux : personne ne le déclenche. Un manager en congé longue
durée, le job passe, et l'argent disparaît sans qu'une ligne n'apparaisse nulle part.

Refuser la suppression n'étant donc pas possible, le correctif rembourse. Un helper
`refundPendingEnvelopes` recrédite le pool de l'entreprise et passe l'enveloppe en
`ANNULEE`. La ligne est conservée plutôt que supprimée, c'est un registre comptable.
Il est branché sur `anonymizeUser`, qui couvre à lui seul trois des quatre chemins, et
sur `softDeleteUser` pour le quatrième. Tout se passe dans la transaction de l'appelant,
donc un remboursement ne peut pas survivre à une suppression qui échoue.

**Règle métier retenue, validée par l'équipe :** l'enveloppe non distribuée retourne au
pool, mais le **solde personnel est mis à zéro sans revenir à l'employeur**. Ce qui a été
gagné meurt avec le compte. Ce choix a une conséquence voulue : retirer un employé ne
rapporte jamais rien à l'entreprise, ce qui évite d'en faire une opération rentable.

**Vérifié en :** créant un jeu de données dédié puis en le supprimant. Huit assertions,
toutes vertes : pool débité correctement à l'allocation, recrédité sur le chemin admin
comme sur le chemin RGPD, enveloppes marquées `ANNULEE`, soldes personnels remis à zéro.
La huitième vérifie l'idempotence, c'est-à-dire que rejouer le remboursement ne recrédite
pas une deuxième fois. Sans cette garde, on aurait fabriqué le bug inverse : de la
création de tokens à partir de rien.

---

## Trois faux positifs, à ne surtout pas "corriger"

L'audit a remonté ces trois points comme critiques. Vérification faite, aucun n'en est un,
et les corriger casserait la production. Documenté en détail dans `38_BUG_TRACKER.md`.

**`VITE_API_URL` absent d'un `.env.production`.** L'URL relative `/api` est voulue :
le proxy Vite s'en occupe en développement, le rewrite Vercel en production. Pointer
`VITE_API_URL` directement vers Render rendrait les appels cross-site, et comme le cookie
de refresh est en `sameSite: 'strict'`, il ne serait plus envoyé du tout. L'authentification
tomberait en production.

**`API_URL` et `CLIENT_URL` en `sync: false` dans `render.yaml`.** ⚠️ **Ce classement était
faux, corrigé le 25/07.** J'avais supposé que la valeur était saisie dans le tableau de bord
Render. Vérification faite : la case `API_URL` était **vide**, la variable retombait donc sur
son défaut `http://localhost:4000`, et le lien de vérification envoyé à chaque inscrit en
production pointait vers sa propre machine. Les deux URL sont désormais écrites directement
dans `render.yaml` : ce ne sont pas des secrets, leur place est dans le versionnement plutôt
que dans une case que quelqu'un doit penser à remplir. Détail complet dans
`00_BUG_URLS_PUBLIQUES_PRODUCTION.md`.

**L'URL du backend en dur dans `vercel.json`.** Le suffixe `-3arx` dans
`primo-backend-3arx.onrender.com` n'est pas une coquille : Render l'ajoute quand le nom de
service demandé est déjà pris. Les commits `c9af082` et `77db535` l'ont mis là exprès.
Le "simplifier" en `primo-backend.onrender.com` pointe vers une URL qui n'existe pas.

Un quatrième point mérite d'être noté parce qu'il a fait perdre du temps : un compte créé
en local dont le lien de vérification ne fonctionnait pas. Ce n'était pas un bug. Le lien
pointe vers `localhost:4000`, et il avait été ouvert depuis un téléphone, qui a donc
cherché un serveur sur son propre port 4000. Pour tester ce parcours en local, ouvrir le
lien depuis la machine, ou vider `BREVO_API_KEY` du `.env` pour que le lien s'affiche
directement dans les logs au lieu d'être envoyé.

---

## Reste ouvert

Par ordre d'importance pour une mise en production.

| Sujet | Où | Pourquoi ça compte |
|---|---|---|
| Pagination absente sur 7 endpoints de liste | `attribution.service.ts`, `employee.service.ts`, `offer.service.ts` | Une entreprise avec beaucoup d'historique fait charger toutes les lignes en mémoire |
| Export RGPD sans limite | `privacy.service.ts` | Même problème, sur une route accessible à tout utilisateur |
| Rejoindre une entreprise REJECTED | `auth.service.ts`, `joinCompany` | À vérifier, l'audit l'annonce mais ce n'est pas confirmé |
| Codes d'invitation non révoqués au rejet d'une entreprise | `admin.service.ts` | Idem, à vérifier |
| Enveloppes orphelines à la suppression d'une entreprise | `admin.service.ts` | Même famille que le correctif 6, non vérifié |
| Un admin peut baisser le coût d'une offre après émission des codes | `offer.schemas.ts` | Incohérence entre ce qui a été payé et ce qui est facturé |
| 17 index manquants | `schema.prisma` | Performance, voir `08_DATABASE_AUDIT_COMPLET.md` |
| Pas de rate limit sur `allocate` et `distribute` | `rateLimit.ts` | Un manager peut marteler la base |
| Pas de jeton CSRF sur les mutations | ensemble du frontend | Atténué par `sameSite: 'strict'`, mais pas fermé |

**Point d'exploitation, pas de code :** vérifier dans le tableau de bord Render que
`API_URL` et `CLIENT_URL` ont bien une valeur. Sans elles, `API_URL` retombe sur son
défaut `http://localhost:4000` et tous les liens de vérification d'email envoyés en
production sont morts.

---

## Méthode employée, pour reproduire

Chaque correctif a été vérifié en exécutant le code, jamais en se contentant de le relire.
Et quand c'était possible, en contre-épreuve : remettre la version d'avant et vérifier que
le test échoue bien. Un test qui passe dans les deux cas ne prouve rien.

Deux corrections ont d'ailleurs été trouvées **en relisant nos propres correctifs** : le
`UNAUTHORIZED` qui sortait en 500, et la garde d'idempotence sur le remboursement. Ça vaut
la peine de relire ce qu'on vient d'écrire.

Pour rejouer la vérification de l'arrêt propre :

```bash
cd backend && npm run build
PORT=4004 node dist/server.js > /tmp/verif.log 2>&1 &
PID=$!
curl -s --retry 30 --retry-delay 1 --retry-all-errors http://localhost:4004/health
kill -TERM $PID
wait $PID
echo "code de sortie : $?"   # 0 attendu, 143 signalerait un correctif absent
cat /tmp/verif.log
```
