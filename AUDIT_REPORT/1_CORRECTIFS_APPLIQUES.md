# Correctifs appliqués avant déploiement

Document destiné à l'équipe. Il récapitule ce qui a été corrigé, pourquoi ça comptait,
comment chaque correctif a été vérifié, et ce qui reste ouvert.

Branche : `featmateo`. Tout est commité, rien n'est en attente dans l'arbre de travail.

---

## Résumé en dix lignes

Un audit a été mené sur l'ensemble du projet et a produit environ 80 remontées, classées
dans ce dossier. **Douze bugs ont été corrigés**, tous vérifiés en exécutant le code et pas
seulement en le relisant. Deux remontées se sont révélées être des faux positifs, et les
corriger aurait cassé la production : elles sont documentées plus bas pour que personne ne
les « corrige » par erreur.

Deux d'entre eux fabriquaient des tokens à partir de rien : cinq clics simultanés sur un
même bouton transformaient une enveloppe de 100 en 500. Un autre les faisait disparaître,
sans trace et sans moyen de les récupérer autrement qu'en les rachetant par carte.

Un dernier point, honnête : **deux de ces dix correctifs réparent des bugs introduits
pendant cet audit**, l'un dans un correctif de la veille, l'autre dans une erreur de
diagnostic. Ils sont signalés comme tels. Le fait qu'ils aient été trouvés vient d'une seule
habitude : relire ses propres correctifs et les tester en contre-épreuve, c'est-à-dire
vérifier que le test échoue bien sur la version d'avant.

---

## Les correctifs

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

### 7. Cinq clics simultanés transformaient une enveloppe de 100 en 500 tokens

**Fichier :** `backend/src/services/attribution.service.ts`, `distributeEnvelope`
**Commit :** `7d1fad0`

Le statut de l'enveloppe était vérifié par une simple lecture, puis réécrit en `DISTRIBUEE`
avec une clause `where` portant sur le seul identifiant. Deux requêtes lancées en même temps
passaient donc toutes les deux le contrôle, et créditaient toutes les deux. Un double clic
suffisait, ou un rejeu du navigateur après un délai d'attente.

Le correctif réserve l'enveloppe par un `updateMany` gardé sur le statut **avant** de
créditer qui que ce soit, et abandonne si aucune ligne ne correspond. C'est exactement le
motif que ce fichier appliquait déjà correctement au pool de l'entreprise, il n'avait
simplement pas été appliqué ici.

**Vérifié en :** lançant cinq distributions concurrentes sur une même enveloppe de 100.
Avant correction : **5 succès et 500 tokens distribués**. Après : 1 succès, 100 tokens.

### 8. Le remboursement d'enveloppe pouvait payer deux fois

**Fichier :** `backend/src/services/attribution.service.ts`, `refundPendingEnvelopes`
**Commit :** `7d1fad0`. **Régression introduite par le correctif n° 6, la veille.**

Même défaut, dans le correctif écrit la veille. La fonction lisait les enveloppes en attente,
recréditait le pool, puis les annulait sans revérifier le statut. Un manager qui validait sa
répartition pendant qu'un admin supprimait son compte était payé **et** remboursé : une
enveloppe de 200 produisait 400 tokens.

La fenêtre s'ouvre toute seule, sans intervention humaine : le job d'anonymisation des
comptes inactifs appelle ce chemin toutes les 24 heures.

Le correctif annule d'abord, avec la garde sur le statut, et ne rembourse que ce que son
annulation a réellement pris.

**À retenir :** le test d'idempotence écrit la veille passait, parce qu'il rejouait le
remboursement **séquentiellement**. Seul un test concurrent a révélé le trou.

### 9. Une variable d'environnement oubliée ne faisait aucun bruit

**Fichier :** `backend/src/config.ts`
**Commit :** `a7b69d7`

Une URL publique absente du tableau de bord de l'hébergeur retombait en silence sur son
défaut `localhost`. Le service passait son health check et se déclarait en bonne santé,
pendant qu'un parcours utilisateur entier était mort. Pire : une case **présente mais vide**
n'était même pas remplacée par le défaut, `z.string()` acceptant la chaîne vide.

Les deux trous sont fermés. `.url()` rejette la chaîne vide, et un `refine` fait échouer le
démarrage en production si les URL sont restées sur localhost.

**Vérifié dans quatre situations :** production sans les variables échoue avec le message,
production avec les deux démarre, développement local inchangé, production avec des cases
vides échoue sur `Invalid URL`.

**Attention à l'ordre de déploiement :** ce garde-fou fait volontairement échouer le
démarrage, donc les variables doivent être renseignées **avant** de déployer ce commit.

### 10. Les URL publiques sont désormais versionnées

**Fichier :** `render.yaml`
**Commit :** `967baca`

`API_URL` n'avait aucune valeur dans le tableau de bord Render, donc le lien de vérification
envoyé à chaque inscrit en production pointait vers sa propre machine. Personne ne pouvait
valider son compte. `CLIENT_URL`, elle, était renseignée mais sur une URL de prévisualisation
de branche Git, qui disparaît si la branche ou le projet est renommé.

Ces deux adresses sont publiques, pas secrètes. Leur place est dans le versionnement plutôt
que dans une case que quelqu'un doit penser à remplir. Le cas complet, y compris pourquoi ce
bug reste invisible pour un développeur dont le backend local tourne, est dans
`incidents/urls-publiques-production.md`.

**Réserve :** ceci ne prend effet que si le service Render est rattaché au Blueprint. S'il a
été créé à la main, `render.yaml` n'est jamais lu et les variables doivent être saisies dans
le tableau de bord. Le garde-fou du correctif 9 rend la réponse observable : si le
déploiement démarre, le Blueprint est lu ; s'il échoue en réclamant les deux URL, il ne
l'est pas.

### 11. Dix connexions par quart d'heure pour l'application entière

**Pourquoi il fallait le corriger :** à trois personnes qui testent une démo, plus personne
ne peut se connecter pendant quinze minutes. Pas trois personnes chacune limitée à dix
tentatives : **trois personnes qui épuisent ensemble le même quota de dix**, valable pour
tous les utilisateurs de Prim'O. Le compteur des rafraîchissements de session, lui, tombe
encore plus vite, puisque chaque chargement de page en consomme un.

**Fichiers :** `backend/src/app.ts`, `backend/src/lib/rateLimit.ts`
**Commit :** `3f5e978`

Deux proxies se trouvent devant Express en production, la redirection Vercel puis celui de
Render, mais `trust proxy` valait 1. Express lisait donc la mauvaise entrée de
`X-Forwarded-For` et voyait tous les visiteurs sous une seule et même adresse, celle de
sortie de Vercel. Tous les limiteurs partageaient un unique compteur.

Le limiteur de connexion compte désormais **par compte** et non par adresse. Une attaque par
force brute vise un compte depuis de nombreuses adresses, l'adresse était donc la mauvaise
chose à compter. Ça ferme au passage un trou lié au fait de faire confiance à deux
intermédiaires : quiconque appelle Render en direct, sans passer par Vercel, écrit lui-même
son `X-Forwarded-For` et peut changer d'adresse à volonté. Il ne peut pas changer le compte
qu'il essaie de forcer.

**Vérifié en :** rejouant la chaîne d'en-têtes de production. Avec 1, `req.ip` est le proxy ;
avec 2, c'est le vrai visiteur. Puis sur l'application : la onzième tentative sur un compte
est refusée, **tandis qu'un autre compte depuis la même machine passe toujours**.

### 12. Un patron licencié pouvait revenir dans l'entreprise

**Pourquoi il fallait le corriger :** supprimer un compte ne le mettait pas dehors. Pendant
quinze minutes, la personne gardait un accès complet. Et ce n'était pas une fenêtre de
quinze minutes, mais de vingt-quatre heures : le temps d'appeler
`POST /api/invites/generate` et de repartir avec un code d'invitation valide une journée et
cent usages. Elle recrée un compte, l'utilise, et se retrouve à l'intérieur de l'entreprise
qui vient de l'exclure. Un manager licencié disposait de la même fenêtre sur
`DELETE /api/employees/:id`, qui anonymise des collègues de façon irréversible.

**Fichier :** `backend/src/middleware/auth.middleware.ts`
**Commit :** `a651fef`

`requireAuth` construisait l'identité de l'appelant à partir du seul jeton. Or le rôle et
l'entreprise y sont figés au moment où il est émis, et il vit quinze minutes. Révoquer le
jeton de rafraîchissement, ce que le code faisait déjà, n'a aucun effet sur un jeton d'accès
déjà entre les mains de quelqu'un.

C'est maintenant la base qui décide. Une lecture sur clé primaire par requête authentifiée,
exactement ce que `requireAdmin` faisait déjà, généralisé à toutes les routes.

**Vérifié en :** supprimant un compte puis en rejouant le même jeton. Sur la version
d'avant : `POST /api/invites/generate` répondait **201**, le compte supprimé repartait bien
avec son code d'invitation. Après : 401 sur toutes les routes, immédiatement.

Un détail trouvé en testant : un identifiant non conforme dans le jeton faisait désormais
échouer Prisma et sortait en 500. C'est un mauvais jeton, pas une panne serveur, donc il
répond 401. Les autres erreurs continuent volontairement de sortir en 500 : répondre 401
pendant une panne de base déconnecterait tout le monde pour rien.

---

## Documenté mais pas corrigé : le conflit entre les deux projets Vercel

**Pourquoi ça compte :** la commande de redéploiement de la vitrine, `cd frontend && npx
vercel deploy --prod`, **publierait l'application par-dessus la vitrine**, sur l'URL
publique. Le dossier `frontend/` est lié au projet `prim-o-landing`, alors que le
`vercel.json` qu'il contient construit l'application.

Ce cas ne se corrige pas en une ligne, et c'est pour ça qu'il reste ouvert. Les deux sites
se construisent depuis le même dossier, la vitrine n'a pas son propre `package.json`, et un
dossier ne peut porter qu'un seul `vercel.json`, lequel a priorité sur les réglages du
tableau de bord. Deux projets Vercel enracinés au même endroit sont donc condamnés à
partager la même configuration de build.

La procédure, le piège et les trois issues possibles sont dans
[`DEPLOIEMENT.md`](../DEPLOIEMENT.md), à la racine du dépôt. Le choix entre les trois
appartient à l'équipe.

En attendant, **la commande générique est à considérer comme dangereuse**. Le fichier
`frontend/.vercel/project.json` est ignoré par Git, donc le piège peut être armé sur une
machine et pas sur une autre.

---

## Faux positifs et classement corrigé

L'audit a remonté ces trois points comme critiques. Vérification faite, aucun n'en est un,
et les corriger casserait la production. Documenté en détail dans `3_SUIVI.md`.

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
`incidents/urls-publiques-production.md`.

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
| 17 index manquants | `schema.prisma` | Performance, voir `rapports-detailles/base-de-donnees.md` |
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
