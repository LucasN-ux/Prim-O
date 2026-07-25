# La vérification d'email est cassée en production

**Gravité : bloquant. Actif en production au moment où ces lignes sont écrites.**
**Statut : constaté et confirmé le 25/07/2026 sur l'application déployée.**
**Cause : la variable `API_URL` n'a pas de valeur dans le tableau de bord Render.**

---

## Le symptôme

Une inscription sur l'application déployée envoie bien un email, et cet email arrive. Mais
le lien « Vérifier mon adresse email » qu'il contient pointe vers :

```text
http://localhost:4000/api/auth/verify-email?token=...
```

C'est-à-dire vers la machine de celui qui clique. Pour un utilisateur normal, c'est une page
d'erreur de connexion, et son compte reste bloqué en « email non vérifié », ce qui interdit
la connexion.

**Aucun utilisateur ne peut valider son inscription en production aujourd'hui.**

---

## Pourquoi ce bug est invisible pour un développeur

C'est ce qui rend ce cas intéressant, et ce qui a fait errer le diagnostic pendant une heure.

Un développeur qui teste garde presque toujours son backend local allumé sur le port 4000.
Quand il clique sur le lien cassé, sa propre machine répond. Le lien **semble** donc marcher :
il obtient une redirection, une page, quelque chose. Il ne voit pas d'erreur.

Sauf que c'est son backend local qui a répondu, avec sa base locale, laquelle ne contient pas
le jeton créé par la production. La vérification échoue donc en silence, et le développeur
est redirigé par sa propre configuration locale, pas par celle de la production.

Le symptôme observé devient alors trompeur : on croit à un problème de redirection alors que
la requête n'a jamais atteint le serveur de production. C'est exactement l'erreur commise
lors de ce diagnostic, deux fois de suite.

**À retenir : pour tester un lien reçu par email, couper son backend local.** Sinon il
intercepte tout ce qui vise `localhost:4000` et masque précisément le bug qu'on cherche.

---

## L'état réel des deux variables

Établi en appelant directement le backend de production avec un vrai jeton, ce que le lien
aurait dû faire :

```text
$ curl -i "https://primo-backend-3arx.onrender.com/api/auth/verify-email?token=..."
HTTP/2 302
location: https://prim-o-j4nm-git-main-holberton-hubs-projects.vercel.app/auth?verified=1
```

| Variable | État | Conséquence |
|---|---|---|
| `API_URL` | **absente**, retombe sur `http://localhost:4000` | le lien de vérification est mort pour tout le monde |
| `CLIENT_URL` | renseignée, mais sur une URL de prévisualisation de branche Git | fonctionne, mais fragile |

Le `verified=1` de la réponse prouve deux choses : la vérification fonctionne parfaitement
côté serveur, et le seul problème est l'adresse inscrite dans l'email.

Sur `CLIENT_URL` : la valeur `prim-o-j4nm-git-main-holberton-hubs-projects.vercel.app` est
une URL générée par Vercel pour la branche `main`. Elle marche aujourd'hui, mais elle dépend
du nom de la branche et du projet, et elle disparaît si l'un des deux change. Mieux vaut y
mettre l'adresse stable de l'application.

---

## Le correctif

Dans Render, onglet Environment du service backend :

```text
API_URL    = https://primo-backend-3arx.onrender.com
CLIENT_URL = https://prim-o-j4nm.vercel.app
```

Sans barre oblique finale : le code écrit `${API_URL}/api/auth/verify-email` et
`${CLIENT_URL}/auth`, une barre en trop produirait un double slash.

Puis sauvegarder, Render redémarre le service seul.

Vérifier au préalable que `prim-o-j4nm.vercel.app` est bien l'adresse que voient les
utilisateurs. Trois URL Vercel répondent aujourd'hui pour ce projet, dont une qui ne
correspond à aucune source du dépôt actuel.

---

## Comment vérifier que c'est réparé

Ne pas se fier au fait que le site réponde, il répondait déjà avant.

1. **Couper son backend local**, sinon le test ne prouve rien
2. S'inscrire avec une adresse jamais utilisée. L'astuce du `+` évite de se bloquer :
   `prenom+test1@gmail.com` arrive dans la même boîte mais compte comme une adresse
   différente
3. Dans l'email reçu, regarder où pointe le lien **avant** de cliquer. Il doit commencer par
   `https://primo-backend-3arx.onrender.com` et non par `http://localhost:4000`
4. Cliquer, et atterrir sur l'application, pas sur une page d'erreur

---

## Le correctif de code, déjà en place

Le vrai défaut n'est pas la case oubliée, c'est qu'une case oubliée ne fasse aucun bruit.
Deux trous étaient ouverts dans `backend/src/config.ts` :

- **variable absente** : le défaut `localhost` s'appliquait en silence ;
- **variable présente mais vide**, ce qui arrive en laissant une case blanche :
  `.default()` ne s'applique alors même pas, et `z.string()` acceptait la chaîne vide.

Les deux sont fermés :

```ts
CLIENT_URL: z.string().url().default('http://localhost:5180'),
API_URL: z.string().url().default('http://localhost:4000'),
// ...
.refine(
  (c) => c.NODE_ENV !== 'production'
      || (!c.CLIENT_URL.includes('localhost') && !c.API_URL.includes('localhost')),
  { message: 'CLIENT_URL et API_URL doivent être renseignées en production.' },
);
```

Vérifié dans quatre situations : production sans les variables échoue avec le message,
production avec les deux démarre, développement local inchangé, et production avec des cases
vides échoue sur `Invalid URL`.

**Attention à l'ordre de déploiement.** Ce garde-fou fait volontairement échouer le
démarrage. Il faut donc renseigner les variables dans Render **avant** de déployer ce
commit, sinon le déploiement sera rejeté. Render conserve la version précédente en ligne
dans ce cas, donc rien ne tombe, mais la mise en ligne ne passe pas.

---

## À vérifier dans la foulée

Toutes les variables déclarées `sync: false` dans `render.yaml` courent le même risque,
puisque aucune n'était vérifiée au démarrage :

`DATABASE_URL`, `CLIENT_URL`, `API_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

Trois sont confirmées bonnes par l'observation : `DATABASE_URL`, `BREVO_API_KEY` et
`CLIENT_URL`, sans quoi rien de ce qui a été testé n'aurait fonctionné. `API_URL` est
confirmée absente. Les trois restantes, toutes liées à Stripe, n'ont pas été vérifiées.

---

## Historique de ce diagnostic, et ce qu'il coûte

Ce cas a été mal diagnostiqué deux fois avant d'être établi :

1. D'abord attribué à `BREVO_API_KEY`, parce que les adresses concernées n'apparaissaient
   pas dans le journal Brevo. Faux : la clé est bien configurée, l'email part et il est
   livré en une seconde.
2. Puis attribué à `CLIENT_URL`, parce que la redirection tombait sur `localhost:5180`.
   Faux également : cette redirection venait du backend local du développeur, qui avait
   intercepté le clic.

Ce qui a tranché, à chaque fois : interroger directement la source plutôt que raisonner sur
les symptômes. Le journal de Brevo pour l'envoi, et un appel direct au backend de production
pour la vérification. Une requête, une réponse, plus de discussion possible.

---

## À retenir

Un service peut répondre 200 sur son health check, se déclarer en bonne santé, et avoir un
parcours utilisateur entier mort. Le health check actuel vérifie seulement que le processus
répond. Il ne regarde ni la base, ni la configuration, ni les services externes.
