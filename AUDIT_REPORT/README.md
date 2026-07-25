# Audit Prim'O avant mise en production

Ce dossier rassemble l'audit du projet, les correctifs appliqués, et ce qui reste à traiter
avant d'ouvrir l'application à de vrais utilisateurs.

**Dernière mise à jour : 26/07/2026. Branche `featmateo`.**

---

## Par où commencer

| Si tu veux... | Ouvre |
|---|---|
| Savoir ce qui a été corrigé et pourquoi | [`1_CORRECTIFS_APPLIQUES.md`](1_CORRECTIFS_APPLIQUES.md) |
| Savoir ce qui reste à faire avant de déployer | [`2_BUGS_A_CORRIGER.md`](2_BUGS_A_CORRIGER.md) |
| Voir l'état d'avancement d'un bug précis | [`3_SUIVI.md`](3_SUIVI.md) |

Trois fichiers suffisent. Le reste n'est là que pour le détail.

---

## L'état en une page

**Dix bugs corrigés**, tous vérifiés en exécutant le code, pas seulement en le relisant.

Les trois plus graves :

- Cinq clics simultanés sur « distribuer » transformaient une enveloppe de 100 tokens en
  500. De la monnaie fabriquée à partir de rien, convertible immédiatement en vrais codes
  promo.
- Supprimer un manager qui détenait une enveloppe non distribuée **détruisait ses tokens**.
  Ils avaient quitté le pool à l'allocation, et le seul autre moyen d'en remettre est d'en
  racheter par carte.
- Un patron rétrogradé gardait pendant quinze minutes un jeton qui le disait toujours
  patron, et pouvait continuer à se servir dans le pool de l'entreprise.

**Trois bugs bloquent encore la mise en ligne :**

1. Le rate limit est global à toute l'application : dix connexions par quart d'heure pour
   l'ensemble des utilisateurs, à cause d'un `trust proxy` mal réglé derrière deux proxies.
2. Redéployer la vitrine la remplacerait par l'application, les deux projets Vercel se
   marchant dessus.
3. `requireAuth` ne relit jamais la base, donc une révocation reste sans effet pendant
   quinze minutes, et un code d'invitation généré pendant ce laps de temps reste valide
   vingt-quatre heures.

Le détail, l'impact et le correctif de chacun sont dans
[`2_BUGS_A_CORRIGER.md`](2_BUGS_A_CORRIGER.md).

---

## Comment ces bugs ont été trouvés

Trois méthodes, complémentaires.

**Une chasse automatisée, en deux passes.** Neuf agents au total, chacun sur un domaine
précis : intégrité comptable des tokens, transitions d'état, base de données, gestion des
erreurs, performance, autorisations, validation des entrées, injections, préparation au
déploiement. La seconde passe recevait la liste de ce qui était déjà traité, pour chercher
ailleurs plutôt que de reproduire les mêmes constats.

**Une vérification systématique de chaque remontée.** C'est le point le plus important :
**trois remontées classées « critiques » se sont révélées fausses**, et les corriger aurait
cassé la production. L'une d'elles aurait supprimé l'authentification en ligne. Elles sont
documentées dans [`1_CORRECTIFS_APPLIQUES.md`](1_CORRECTIFS_APPLIQUES.md), section « Faux
positifs », précisément pour que personne ne les « corrige » de bonne foi.

Aucune correction n'a été écrite sur la seule foi d'un rapport. Chaque bug a d'abord été
retrouvé dans le code.

**L'usage réel de l'application.** Deux bugs de production ont été découverts simplement en
s'inscrivant sur l'application déployée, pas en lisant du code. Ils ont leur propre dossier,
[`incidents/`](incidents/), parce que la méthode de diagnostic vaut autant que la trouvaille.

---

## Comment les correctifs ont été validés

Chaque correctif a été exercé, et quand c'était possible **en contre-épreuve** : remettre la
version d'avant et vérifier que le test échoue bien. Un test qui passe dans les deux cas ne
prouve rien.

Quelques exemples de ce que ça a donné :

| Correctif | Preuve |
|---|---|
| Course sur la distribution | 5 tentatives concurrentes : **500 tokens avant, 100 après** |
| Arrêt propre du serveur | code de sortie **143 avant, 0 après** |
| Timeout d'envoi d'email | test rouge par dépassement de délai sur la version d'avant |
| Blocage de l'auto-allocation | 403 prouvé venir de la nouvelle barrière, marqueur temporaire à l'appui |

Deux bugs ont été trouvés **en relisant nos propres correctifs**, dont une régression
introduite la veille. C'est le principal enseignement de cet audit : relire ce qu'on vient
d'écrire rapporte autant que chercher ailleurs.

---

## Les incidents rencontrés en production

Deux pannes réelles, diagnostiquées de bout en bout.

[**`incidents/urls-publiques-production.md`**](incidents/urls-publiques-production.md)
Une variable d'environnement vide faisait pointer tous les liens de vérification vers
`localhost`. Personne ne pouvait valider son inscription en ligne. Le document explique
aussi pourquoi ce bug est **invisible pour un développeur** dont le backend local tourne :
sa propre machine répond au lien cassé et masque la panne.

[**`incidents/brevo-blocage-emails.md`**](incidents/brevo-blocage-emails.md)
Un utilisateur qui clique une fois sur « se désabonner » ne peut plus jamais recevoir de
lien de vérification ni de réinitialisation de mot de passe, et **notre code croit les avoir
envoyés**. Contient les six fausses pistes écartées et les commandes que le support peut
utiliser pour vérifier ou lever un blocage.

---

## Les rapports détaillés

Dans [`rapports-detailles/`](rapports-detailles/), 25 rapports bruts issus des agents. On n'y
va que pour chercher un détail précis. Les principaux :

| Fichier | Contenu |
|---|---|
| `base-de-donnees.md` | schéma, contraintes, **17 index manquants**, requêtes N+1 |
| `transitions-etat.md` | cycles de vie des entreprises, comptes et enveloppes |
| `securite-authentification.md` | jetons, sessions, rotation, détection de vol |
| `validation-zod.md` et `validation-details.md` | couverture de la validation des entrées |
| `securite-*.md` | injections SQL et commandes, XSS, path traversal, encodage, upload |
| `performance.md` | pagination absente, fuites mémoire, prévention du déni de service |
| `gestion-erreurs.md` | erreurs avalées, délais d'attente, observabilité |

Ces rapports datent de la première passe. **Ils n'ont pas été mis à jour depuis les
correctifs**, et certaines de leurs conclusions ont été démenties par la vérification. En cas
de contradiction, ce sont les trois documents de la racine qui font foi.

---

## Ce qui a été vérifié et jugé sain

À ne pas réauditer, c'est du temps déjà dépensé :

- Le cloisonnement entre entreprises tient. Aucune fuite trouvée en passant l'identifiant
  d'une autre entreprise dans une URL ou un corps de requête.
- Aucune route d'administration n'est atteignable par un non-administrateur.
- L'idempotence du webhook Stripe est correcte pour les rejeux, et le montant crédité vient
  de données posées côté serveur, jamais du client.
- La course sur le dernier code promo disponible est correctement gérée.
- Le pool de tokens d'une entreprise ne peut pas devenir négatif.
- Aucun arrondi ne fait apparaître ni disparaître d'unité.
- Aucune expression régulière n'est vulnérable au déni de service.
