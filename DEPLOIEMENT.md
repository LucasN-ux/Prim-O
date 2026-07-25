# Déploiement

Trois choses sont déployées séparément : l'application, la vitrine, et le backend.

---

## ⚠️ Le piège à connaître avant de toucher à Vercel

**Ne lancez pas `npx vercel deploy --prod` depuis `frontend/` sans avoir vérifié à quel
projet le dossier est lié.**

Le dossier `frontend/` sert à construire **deux sites différents** :

| Site | Commande | Sortie |
|---|---|---|
| L'application | `npm run build` | `frontend/dist` |
| La vitrine | `npm run build:landing` | `frontend/landing/dist` |

Mais `frontend/vercel.json` ne décrit qu'un seul des deux, l'application. Et ce fichier a
priorité sur les réglages du tableau de bord Vercel.

Conséquence : si le dossier est lié au projet de la vitrine, la commande générique
**publie l'application par-dessus la vitrine**, sur l'URL publique. C'était le cas au
26/07/2026, `frontend/.vercel/project.json` pointait sur `prim-o-landing` pendant que
`vercel.json` construisait l'application.

Pour savoir à quoi votre dossier est lié :

```bash
cat frontend/.vercel/project.json
```

Ce fichier est ignoré par Git, donc **il diffère d'une machine à l'autre**. Le piège peut
être armé chez une personne et pas chez une autre.

---

## Ce qu'il faudrait faire pour que ça ne puisse plus arriver

Le fond du problème : deux projets Vercel enracinés sur le même dossier ne peuvent pas avoir
de configurations de build différentes, puisqu'ils partagent le même `vercel.json`.

Trois issues possibles, à arbitrer en équipe :

1. **Donner à la vitrine son propre `package.json` et son propre `vercel.json`** dans
   `frontend/landing/`, et enraciner le projet Vercel de la vitrine sur ce sous-dossier.
   C'est la solution propre. Elle demande d'activer l'option Vercel qui autorise l'accès aux
   fichiers hors du dossier racine, puisque la vitrine importe du code depuis `../src`.
2. **Sortir la vitrine dans son propre dépôt.** Le plus simple à raisonner, le plus coûteux
   à mettre en place.
3. **Ne déployer la vitrine que manuellement**, avec les options passées en ligne de
   commande plutôt que par `vercel.json`. Fonctionne, mais repose entièrement sur le fait
   que personne ne se trompe de commande.

Tant que rien n'est décidé, considérez la commande générique comme dangereuse.

---

## Backend, sur Render

Service `primo-backend`, `https://primo-backend-3arx.onrender.com`.

Le suffixe `-3arx` fait partie de l'adresse. Render l'ajoute quand le nom demandé est déjà
pris. Ne pas le « simplifier » en `primo-backend.onrender.com`, cette adresse n'existe pas.

### Variables d'environnement

Déclarées dans `render.yaml`. Deux catégories :

**Écrites dans le dépôt** parce que ce sont des adresses publiques, pas des secrets :

```yaml
CLIENT_URL = https://prim-o-j4nm.vercel.app
API_URL    = https://primo-backend-3arx.onrender.com
```

**À saisir dans le tableau de bord** parce que ce sont des secrets : `DATABASE_URL`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`.

### Le démarrage échoue en réclamant CLIENT_URL et API_URL ?

C'est voulu. Ces deux variables ont un défaut `localhost` prévu pour le développement, et
laisser ce défaut s'appliquer en production casse silencieusement deux parcours : le lien de
vérification d'email et le lien de réinitialisation de mot de passe pointent alors vers la
machine de l'utilisateur.

Le service refuse donc de démarrer plutôt que de mentir sur son état de santé. Si ça arrive,
c'est que le Blueprint `render.yaml` n'est pas lu par le service, ce qui se produit quand il
a été créé à la main depuis le tableau de bord. Dans ce cas, saisissez les deux valeurs dans
l'onglet Environment.

Render conserve la version précédente en ligne quand un déploiement échoue, donc rien ne
tombe entre-temps.

### Mise en veille

Le plan gratuit endort le service après 15 minutes sans trafic. Le réveil prend **30 à 60
secondes**, mesuré. Deux conséquences à garder en tête :

- le premier appel après une période creuse semble planté, il ne l'est pas ;
- un webhook Stripe peut arriver pendant ce réveil. Le traitement est idempotent, donc rien
  n'est perdu, mais le crédit peut apparaître avec plusieurs minutes de retard.

---

## Vérifier qu'un déploiement a réellement fonctionné

Un service qui répond 200 sur `/health` ne prouve presque rien : il ne vérifie ni la base,
ni la configuration, ni les services externes. Deux parcours ont déjà été morts en
production pendant que le health check était au vert.

Le test qui prouve quelque chose, à faire après chaque déploiement touchant à la
configuration :

1. **Couper son backend local.** Sinon il répond aux liens pointant vers `localhost` et
   masque exactement la panne qu'on cherche.
2. S'inscrire avec une adresse jamais utilisée. L'astuce du `+` évite de bloquer une vraie
   adresse : `prenom+test1@gmail.com` arrive dans la même boîte et compte comme différente.
3. Dans l'email reçu, **regarder où pointe le lien avant de cliquer**. Il doit commencer par
   `https://primo-backend-3arx.onrender.com`, jamais par `http://localhost:4000`.
4. Cliquer, atterrir sur l'application, se connecter.
5. Demander une réinitialisation de mot de passe et vérifier le lien de la même façon.

Si un email n'arrive pas, le journal Brevo répond en une requête. La procédure est dans
`AUDIT_REPORT/incidents/brevo-blocage-emails.md`.
