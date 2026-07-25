# La réinitialisation de mot de passe est morte en production

**Gravité : bloquant. Actif en production au moment où ces lignes sont écrites.**
**Statut : constaté en conditions réelles le 25/07/2026 sur l'application déployée.**
**Cause : la variable `CLIENT_URL` n'a pas de valeur dans le tableau de bord Render.**

---

## Comment ça s'est vu

Inscription faite depuis l'application déployée. L'email de vérification est bien arrivé.
Un clic sur « Vérifier mon adresse email » a redirigé le navigateur vers :

```
http://localhost:5180/auth
```

Autrement dit, vers la machine de l'utilisateur. Pour un utilisateur qui n'a rien
d'installé, c'est une page d'erreur de connexion.

Le journal Brevo confirme que la chaîne d'envoi, elle, fonctionne parfaitement :

```
23:42:37  requests     (adresse de test)
23:42:38  delivered    (adresse de test)     <- une seconde plus tard
23:42:45  clicks       (adresse de test)
```

---

## La cause

`backend/src/config.ts` déclare :

```ts
CLIENT_URL: z.string().default('http://localhost:5180'),
```

Et `render.yaml` la déclare en `sync: false`, ce qui signifie que sa valeur doit être saisie
à la main dans le tableau de bord Render. Elle ne l'a pas été. Le défaut prévu pour le
développement local s'est donc appliqué en production, **sans le moindre avertissement au
démarrage**. Le service passe son health check et se déclare en bonne santé.

Deux déductions utiles tirées du même test :

- **`API_URL` est correctement configurée.** Si elle ne l'était pas, le lien contenu dans
  l'email aurait pointé vers `localhost:4000` et le clic n'aurait jamais atteint le serveur.
  Or il l'a atteint, puisqu'il a produit une redirection.
- **`BREVO_API_KEY` est correctement configurée.** L'email est parti et a été livré.

Seule `CLIENT_URL` manque.

---

## Les trois conséquences, de la moins grave à la pire

**1. La redirection après vérification d'email.** C'est le symptôme visible, et c'est le
moins grave : le contrôleur consomme le jeton **avant** de rediriger, donc la vérification a
bel et bien lieu. L'utilisateur atterrit sur une page morte, mais son compte est actif. S'il
retourne sur le site de lui-même, il peut se connecter. Encore faut-il qu'il y pense.

**2. Le retour après paiement Stripe.** `success_url` est construit avec `CLIENT_URL`, donc
un client qui vient de payer atterrit sur `localhost`. Le paiement est encaissé, le webhook
crédite bien le pool, mais le client ne voit qu'une page d'erreur après avoir donné sa carte.

**3. La réinitialisation de mot de passe, totalement inopérante.** C'est le cas le plus
grave, parce que contrairement à la vérification, **c'est le lien lui-même qui est
construit avec `CLIENT_URL`** :

```ts
const link = `${config.CLIENT_URL}/?reset-token=${encodeURIComponent(rawToken)}`;
```

L'email reçu par l'utilisateur contient donc un lien vers `http://localhost:5180`. Il n'y a
aucun rattrapage possible de son côté : le jeton n'est nulle part ailleurs. **Aucun
utilisateur ne peut récupérer son mot de passe en production aujourd'hui.**

---

## Le correctif immédiat

Dans Render, onglet Environment :

```
CLIENT_URL = https://prim-o-j4nm.vercel.app
```

puis redéployer.

Précaution : deux URL Vercel répondent, `prim-o.vercel.app` et `prim-o-j4nm.vercel.app`.
Vérifier laquelle est celle que voient réellement les utilisateurs avant de saisir la
valeur, une erreur ici recasserait tout.

---

## Le correctif de fond, pour que ça ne se reproduise pas

Le vrai défaut n'est pas la case oubliée, c'est qu'une case oubliée ne fasse aucun bruit.
Deux trous dans le schéma actuel :

- **variable absente** : le défaut `localhost` s'applique en silence ;
- **variable présente mais vide**, ce qui arrive facilement en laissant une case blanche :
  `.default()` ne s'applique même pas, `z.string()` accepte la chaîne vide, et les liens
  deviennent relatifs, donc invalides d'une autre manière.

Correctif proposé dans `backend/src/config.ts` :

```ts
const envSchema = z.object({
  // ...
  CLIENT_URL: z.string().url().default('http://localhost:5180'),
  API_URL: z.string().url().default('http://localhost:4000'),
  // ...
}).refine(
  (c) => c.NODE_ENV !== 'production'
      || (!c.CLIENT_URL.includes('localhost') && !c.API_URL.includes('localhost')),
  { message: 'CLIENT_URL et API_URL doivent être renseignées en production.' },
);
```

`.url()` ferme le cas de la chaîne vide. Le `.refine` transforme une mauvaise configuration
en **échec de déploiement visible** au lieu d'une panne silencieuse qui se découvre trois
semaines plus tard par un utilisateur qui n'arrive pas à se connecter.

---

## À vérifier dans la foulée

Toutes les variables déclarées `sync: false` dans `render.yaml` sont exposées au même
risque, puisqu'aucune n'est vérifiée au démarrage. Faire le tour du tableau de bord et
confirmer que chacune a bien une valeur :

`DATABASE_URL`, `CLIENT_URL`, `API_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

Trois d'entre elles sont désormais confirmées bonnes par l'observation : `API_URL`,
`BREVO_API_KEY` et `DATABASE_URL`, sans quoi rien de ce qui a été testé n'aurait fonctionné.

---

## À retenir

Un service peut répondre 200 sur son health check, se déclarer en bonne santé, et avoir
deux parcours utilisateurs entièrement morts. Le health check actuel ne vérifie que le fait
que le processus répond. Il ne vérifie ni la base, ni la configuration, ni les services
externes.
