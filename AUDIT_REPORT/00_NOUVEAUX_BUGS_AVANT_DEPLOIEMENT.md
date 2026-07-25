# Nouveaux bugs trouvés avant le déploiement

Seconde passe d'audit, menée le 25/07/2026 sur trois axes : intégrité comptable des tokens,
préparation au déploiement Vercel + Render, et matrice des autorisations. Les sujets déjà
traités ou déjà classés faux positifs avaient été exclus de la recherche.

Chaque point porte un niveau de confiance. **CERTAIN** signifie que le code qui le prouve a
été lu et cité. **PROBABLE** signifie que le trou est réel dans le code mais que son
déclenchement dépend d'une condition invérifiable d'ici, typiquement un réglage dans un
tableau de bord externe.

Les deux premiers ont été corrigés et vérifiés pendant l'audit. Tout le reste est ouvert.

---

## Déjà corrigés

### A. Cinq clics simultanés transformaient une enveloppe de 100 en 500 tokens

**CERTAIN. Corrigé, commit `7d1fad0`.**
`backend/src/services/attribution.service.ts`, `distributeEnvelope`

Le statut de l'enveloppe était vérifié par une simple lecture, puis réécrit en `DISTRIBUEE`
avec une clause `where` portant sur le seul `id`. Deux requêtes lancées en même temps
passaient donc toutes les deux le contrôle et créditaient toutes les deux. Un double clic
suffisait, ou un rejeu du navigateur après un délai d'attente.

Mesuré sur la vraie base avant correction : **cinq appels concurrents sur une enveloppe de
100 ont distribué 500 tokens**, alors que le pool n'avait été débité que de 100. Les tokens
créés sont immédiatement convertibles en codes promo réels.

Le correctif réserve l'enveloppe par un `updateMany` gardé sur le statut avant de créditer
qui que ce soit, et abandonne si aucune ligne ne correspond. C'est exactement le motif que
ce fichier applique déjà correctement au pool de l'entreprise.

### B. Le remboursement d'enveloppe pouvait payer deux fois

**CERTAIN. Corrigé, commit `7d1fad0`. Régression introduite par le commit `452e1ef`.**
`backend/src/services/attribution.service.ts`, `refundPendingEnvelopes`

Même défaut, dans le correctif de la veille. La fonction lisait les enveloppes en attente,
recréditait le pool, puis les annulait avec un `where` sur le seul `id`. Un manager qui
validait sa répartition pendant qu'un admin supprimait son compte était payé **et**
remboursé : une enveloppe de 200 produisait 400 tokens.

La fenêtre s'ouvre toute seule : le job d'anonymisation des comptes inactifs appelle ce
chemin sans intervention humaine.

Le correctif annule d'abord, avec la garde sur le statut, et ne rembourse que ce que son
annulation a réellement pris.

À retenir pour l'équipe : le test d'idempotence écrit la veille passait, parce qu'il
rejouait le remboursement **séquentiellement**. Seul un test concurrent a révélé le trou.

---

## Bloquants pour la mise en ligne

### 1. Tous les utilisateurs partagent un seul compteur de rate limit

**CERTAIN.** `backend/src/app.ts:37`

`app.set('trust proxy', 1)` alors qu'il y a **deux** proxies en production : le rewrite
Vercel, puis celui de Render. Express remonte donc à l'IP de sortie de Vercel, identique
pour tout le monde, et `express-rate-limit` s'en sert comme clé.

Conséquence directe : `loginLimiter` autorise 10 connexions par quart d'heure **pour
l'application entière**, pas par utilisateur. Trois personnes qui testent une démo épuisent
le quota en deux minutes et tout le monde passe en 429. Le limiteur de refresh, à 20 par
minute globalement, tombe encore plus vite puisque chaque chargement de page en consomme un.

Correctif : `app.set('trust proxy', 2)` en production. Dans la foulée, faire porter le
limiteur de connexion sur l'email plutôt que sur l'IP, une protection anti-force brute doit
de toute façon être par compte.

### 2. Redéployer la vitrine la remplacerait par l'application

**CERTAIN.** `frontend/.vercel/project.json` contre `frontend/vercel.json`

Le dossier `frontend/` est lié au projet Vercel **prim-o-landing**, mais le `vercel.json`
qu'il contient construit désormais l'application. Le commit `00a6223` a écrasé la
configuration de la vitrine sans en créer une seconde ; il n'existe qu'un seul `vercel.json`
dans tout le dépôt.

Donc la commande de redéploiement de la vitrine, `cd frontend && npx vercel deploy --prod`,
publierait l'application sur `prim-o-landing.vercel.app`. Le piège ne se déclenche qu'au
moment où quelqu'un redéploie, c'est-à-dire probablement cette semaine, et sur l'URL la plus
visible du projet.

Correctif : séparer les deux projets Vercel avant tout redéploiement, et écrire quelque part
la bonne commande pour chacun.

### 3. Un patron licencié peut revenir dans l'entreprise

**CERTAIN.** `backend/src/middleware/auth.middleware.ts:7`

`requireAuth` ne relit jamais la base. Ni la suppression du compte, ni un changement de
rôle, ni la suppression de l'entreprise ne sont visibles avant l'expiration du jeton, soit
15 minutes. Révoquer les jetons de rafraîchissement, ce que fait déjà le code, ne change
rien : le jeton d'accès est un JWT sans état.

La conséquence n'est pas limitée à ce quart d'heure. Dans cette fenêtre, l'intéressé appelle
`POST /api/invites/generate` et obtient un code d'invitation **valide 24 heures et 100
usages**. Il crée un compte neuf, l'utilise, et redevient membre de l'entreprise dont il
vient d'être exclu. Le code survit 96 fois plus longtemps que le jeton qui l'a produit.

Même fenêtre, dégât irréversible : un manager licencié peut appeler
`DELETE /api/employees/:id` et anonymiser ses collègues, ce qui vide leur solde sans retour
possible.

Correctif : généraliser dans `requireAuth` ce que `requireAdmin` fait déjà, c'est-à-dire
charger l'utilisateur et faire autorité sur la base. Une requête de plus par appel, sur clé
primaire. Et révoquer les codes d'invitation créés par un compte supprimé ou rétrogradé.

---

## Graves, à traiter avant d'ouvrir aux vrais utilisateurs

### 4. Les photos d'offres disparaissent à chaque mise en veille

**CERTAIN.** `backend/src/lib/upload.ts:8`, `render.yaml`

Les fichiers sont écrits sur le disque local du conteneur Render, qui est éphémère sur le
plan gratuit et repart de zéro à chaque redéploiement **et à chaque réveil après les 15
minutes d'inactivité**. La base garde le chemin, le fichier n'existe plus.

Un admin met une photo le lundi, mardi matin le catalogue affiche des images cassées. Il n'y
a pas de contournement dans le code : le plan gratuit n'offre aucun disque persistant. Soit
un stockage objet externe, soit stocker l'image en base, soit retirer la fonctionnalité de
la démo.

### 5. Un paiement SEPA est encaissé sans jamais créditer le pool

**CERTAIN sur le code. PROBABLE sur le déclenchement**, il dépend des moyens de paiement
activés dans le tableau de bord Stripe.
`backend/src/controllers/stripeWebhook.controller.ts:23`

Le service documente explicitement que la capture d'un paiement asynchrone arrive plus tard
via `checkout.session.async_payment_succeeded`, et sort sans créditer tant que le paiement
n'est pas `paid`. Mais le contrôleur ne s'abonne qu'à `checkout.session.completed` et
répond 200 à tout le reste. La moitié du contrat décrit en commentaire n'a jamais été
écrite.

L'entreprise est débitée, son solde reste à zéro, Stripe considère l'événement livré et
n'insiste pas. Aucune trace côté serveur.

À vérifier en priorité : si seule la carte est activée sur le compte Stripe, le risque est
nul aujourd'hui. Mais activer un moyen asynchrone se fait en deux clics, sans toucher au
code. Correctif : traiter les deux types d'événements, la fonction est déjà idempotente.

### 6. Une entreprise peut perdre son patron définitivement

**CERTAIN.** `backend/src/services/admin.service.ts:207`

Le dernier ADMIN est protégé, le dernier OWNER ne l'est pas. Or le rôle OWNER n'est attribué
qu'à un seul endroit du backend, à la création de l'entreprise, et uniquement à un
utilisateur sans entreprise. Les codes d'invitation ne proposent que EMPLOYEE et MANAGER.

**Aucun chemin de code ne peut recréer un patron pour une entreprise existante.** Un admin
qui rétrograde ou supprime le patron condamne l'entreprise : plus d'allocation, plus de
recharge Stripe, plus de statistiques, et les tokens déjà dans le pool deviennent
inatteignables. Le patron peut aussi se l'infliger lui-même via la suppression RGPD.

Correctif : une garde `LAST_OWNER` symétrique de celle sur l'admin, et une route de
transfert de propriété, sans laquelle la garde bloquerait une entreprise dont le patron est
réellement parti.

### 7. Une enveloppe à rétribution totale est indistribuable à vie

**CERTAIN.** `backend/src/schemas/attribution.schemas.ts:20`, `backend/src/lib/retribution.ts:15`

Deux cas produisent une rétribution égale au montant total, donc un budget à distribuer nul :
un pourcentage à 100, que le schéma autorise, et le mode part égale dans une entreprise sans
aucun employé actif.

Le schéma de distribution exige au moins une ligne d'un montant strictement positif, donc le
total ne peut jamais valoir zéro et le contrôle échoue systématiquement. Les tokens ont
quitté le pool à l'allocation et ne peuvent plus jamais en ressortir : il n'existe aucune
route d'annulation d'enveloppe. La seule échappatoire connue est de supprimer le compte du
manager, ce qui détruit au passage son solde personnel.

Correctif immédiat, une ligne : plafonner le pourcentage à 99. Correctif de fond : une route
qui permet au patron d'annuler une enveloppe non distribuée, ce qui donnerait aussi une
sortie propre à tous les autres cas de blocage.

### 8. Une inscription réussie peut répondre 500

**CERTAIN.** `backend/src/services/auth.service.ts:54`

Le compte et son jeton sont créés dans une transaction validée, puis l'email est envoyé hors
transaction sans `catch`. Le commentaire annonce qu'un envoi raté ne doit pas annuler
l'inscription, mais le code ne le met pas en œuvre : l'exception remonte et l'utilisateur
reçoit une erreur interne alors que son compte existe.

Il recommence, obtient cette fois « email déjà utilisé », et conclut que l'inscription est
impossible. Les déclencheurs sont tous propres à la production : expéditeur Brevo non
vérifié, clé absente, ou simplement le délai de 10 secondes atteint sur le premier appel
sortant d'un conteneur qui vient de démarrer.

### 9. Une variable d'environnement vide passe inaperçue

**CERTAIN. Constaté en production, et le garde-fou a été posé depuis.**
`backend/src/config.ts:7`

Ce risque s'est réalisé pendant l'audit : `API_URL` n'est pas renseignée dans le tableau de
bord Render, donc le lien de vérification envoyé à chaque nouvel inscrit pointe vers
`http://localhost:4000`, c'est-à-dire vers sa propre machine. **Personne ne peut valider son
inscription en production.** Le cas complet a son propre document :
**`00_BUG_URLS_PUBLIQUES_PRODUCTION.md`**, qui explique aussi pourquoi ce bug est invisible
pour un développeur dont le backend local tourne. Le correctif de code décrit ci-dessous est
en place, il reste à renseigner la variable côté hébergeur.

`z.string().default(...)` a deux trous. Variable absente : le défaut `localhost` s'applique
en silence. Variable **présente mais vide**, cas très réaliste avec une case laissée blanche
dans le tableau de bord Render : le défaut ne s'applique pas, la chaîne vide est acceptée,
et les liens deviennent relatifs. Le lien de vérification d'email et l'URL de retour Stripe
sont alors invalides.

Dans les deux cas le service démarre, passe son health check, et les parcours email et
paiement sont morts. Correctif : `.url()` pour fermer le cas de la chaîne vide, et un
`refine` qui fait échouer bruyamment un déploiement de production pointant sur localhost.

### 10. Un utilisateur qui se désabonne une fois est enfermé dehors pour toujours

**CERTAIN. Observé en conditions réelles pendant l'audit, pas déduit du code.**
`backend/src/lib/mail.ts`

Brevo tient une liste de blocage transactionnelle. Une adresse y entre dès que son
propriétaire clique sur un lien de désabonnement, ou simplement sur le bouton « Se
désabonner » que Gmail affiche en haut de chaque message. Un signalement en indésirable
suffit parfois. Ensuite, Brevo **refuse tout envoi vers cette adresse**, y compris les
emails transactionnels.

Le piège n'est pas là : il est dans ce que notre code observe.

```
POST /api/auth/register 201        <- notre serveur : inscription réussie
18:15:53  blocked                  <- Brevo, la même seconde : jamais envoyé
```

**Brevo répond succès à l'appel API puis bloque en interne.** `sendEmail` voit un `res.ok`
et ne lève rien. Notre code est donc structurellement incapable de distinguer un email parti
d'un email refusé.

Conséquence pour un vrai utilisateur : après un seul clic sur « se désabonner », il ne peut
plus jamais recevoir ni lien de vérification, ni réinitialisation de mot de passe. Son
compte devient définitivement inaccessible, et personne n'est prévenu, ni lui, ni le
support. Le seul symptôme visible est « je ne reçois pas le mail », sans aucun moyen de
diagnostic depuis l'application.

Constaté pendant cet audit : une adresse de test bloquée depuis dix jours, quatre tentatives
d'inscription, quatre blocages instantanés, et quatre réponses `201` côté serveur. Une heure
perdue à chercher du côté du spam et de la configuration de l'expéditeur avant d'interroger
l'API de Brevo, qui a donné la réponse en une requête.

**Confirmé de bout en bout** : après retrait de l'adresse de la liste, sans toucher au code
ni à la configuration, l'email est arrivé.

Ce point a son propre document, parce qu'il vaut autant pour la méthode de diagnostic que
pour le bug lui-même : **`00_BUG_BREVO_BLOCAGE_EMAILS.md`**. On y trouve les six fausses
pistes écartées, les correctifs classés par urgence, et les commandes que le support peut
utiliser pour vérifier ou lever un blocage.

---

## À traiter ensuite

| # | Sujet | Où | Confiance |
|---|---|---|---|
| 11 | Un manager voit l'email et le solde de tous les autres managers, alors qu'aucun écran manager n'en a besoin | `attribution.controller.ts:186`, garde trop large | CERTAIN |
| 12 | Un manager voit le pool de tokens de l'entreprise, alors que son écran n'en affiche que le nom | `company.controller.ts:13` | CERTAIN |
| 13 | Les migrations sont rejouées à chaque réveil du conteneur, et un hoquet de base empêche le démarrage au lieu de réessayer | `package.json:9`, `start:render` | PROBABLE |
| 14 | Les jobs annoncés toutes les 24 h ne se déclenchent jamais : le processus meurt avant. Seule l'exécution au démarrage tourne, donc au pire moment, pendant le réveil | `jobs/*.ts`, `server.ts:41` | PROBABLE |
| 15 | Après paiement, l'écran annonce le succès et recharge le solde au bout de 1,5 s, alors que le webhook peut réveiller un conteneur endormi pendant 30 à 60 s. Aucune route de rattrapage n'existe | `OwnerDashboard.tsx:114` | PROBABLE |
| 16 | L'invariant comptable écrit dans le schéma est faux pour tout manager : sa rétribution crédite son solde sans créer de ligne au registre | `schema.prisma:192` | CERTAIN |
| 17 | Des contraintes SQL sont annoncées en commentaire alors qu'aucune migration ne les crée. Un commentaire qui promet un filet inexistant est pire que pas de commentaire | `schema.prisma:240` | CERTAIN |
| 18 | `/api/test/verify-email` valide l'email de n'importe quel compte sans authentification, et n'est fermée que par `NODE_ENV`, dont le défaut est `development` | `app.ts:95` | CERTAIN |
| 19 | Sur une offre très demandée, plusieurs acheteurs simultanés visent le même code promo et certains reçoivent « plus de stock » alors qu'il en reste | `redemption.service.ts:19` | CERTAIN |

---

## Ce qui a été vérifié et jugé sain

Pour éviter que quelqu'un refasse le travail :

- **Le cloisonnement entre entreprises tient.** Tous les chemins vérifient l'appartenance
  avant d'agir, y compris les statistiques où l'identifiant fourni est croisé avec
  l'entreprise de l'appelant. Aucune fuite trouvée en passant un identifiant d'une autre
  entreprise dans une URL ou un corps de requête.
- **Aucune route admin n'est atteignable par un non-admin**, et `requireAdmin` relit bien la
  base.
- **L'idempotence du webhook Stripe est correcte** pour les rejeux, et le montant crédité
  vient de métadonnées posées côté serveur, jamais du client.
- **La course sur le dernier code promo est correctement gérée** : réservation gardée, débit
  gardé, contrainte d'unicité, libération en cas d'échec.
- **Le pool ne peut pas devenir négatif**, garde applicative doublée d'une contrainte SQL.
- **Aucun arrondi ne fait apparaître ni disparaître d'unité** : tout est entier, l'arrondi
  se fait toujours vers le bas et le reste retombe dans le budget des employés.
- **Le cookie de rafraîchissement est correctement configuré** pour le montage actuel, et le
  `sameSite: 'strict'` ne pose pas de problème sur les retours d'email et de Stripe.
- **Les deux builds passent** avec les commandes déclarées dans `render.yaml` et
  `vercel.json`.

---

## Ordre suggéré

Avant d'ouvrir l'application à qui que ce soit : les points **1**, **2** et **3**. Le
premier rend l'application inutilisable à trois utilisateurs simultanés, le deuxième peut
détruire la vitrine publique au prochain redéploiement, le troisième laisse rentrer
quelqu'un qu'on vient de mettre dehors.

Ensuite **8**, **9** et **10**, qui touchent tous les trois au premier parcours utilisateur.
Les deux premiers coûtent cinq à dix lignes et transforment une panne silencieuse en échec
visible. Le dixième est le seul de la liste à avoir été rencontré pour de vrai pendant
l'audit, sur un compte de test : il enferme dehors, définitivement et sans le moindre
signal, tout utilisateur ayant cliqué une fois sur un lien de désabonnement.

Puis **5**, **6**, **7**, qui touchent à de l'argent ou bloquent définitivement des comptes.

Le point **4** demande un arbitrage : soit une demi-journée pour un stockage externe, soit
retirer la photo d'offre de la démo. Il n'y a pas de troisième voie sur le plan gratuit.
