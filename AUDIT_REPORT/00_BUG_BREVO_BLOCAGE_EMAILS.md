# Un utilisateur désabonné ne peut plus jamais récupérer son compte

**Gravité : grave. À traiter avant l'ouverture aux vrais utilisateurs.**
**Statut : confirmé de bout en bout le 25/07/2026, rencontré en conditions réelles.**
**Fichier concerné : `backend/src/lib/mail.ts`**

---

## En une phrase

Un utilisateur qui clique une seule fois sur « se désabonner » ne recevra plus jamais ni
lien de vérification, ni réinitialisation de mot de passe, et **notre code croira les avoir
envoyés**.

---

## Le symptôme

Un compte est créé, le serveur répond `201 Created`, l'écran affiche « vérifie ton email ».
L'email n'arrive jamais. L'utilisateur ne peut pas se connecter, puisque la vérification est
obligatoire, et il ne peut pas non plus se réinscrire : l'adresse est déjà prise.

Vu du serveur, tout s'est bien passé. Aucune erreur, aucun log, rien.

---

## Ce que ce n'était pas

Cette enquête a duré une heure, presque entièrement passée sur de fausses pistes. Elles sont
listées ici pour que personne ne les refasse.

| Piste | Pourquoi elle était fausse |
|---|---|
| L'email est dans les indésirables | Il n'a jamais quitté Brevo |
| L'expéditeur est une adresse Outlook, donc mal aligné SPF et DKIM | Vrai problème par ailleurs, mais sans rapport : une autre adresse Gmail recevait parfaitement au même moment |
| Le lien est trop long et se fait tronquer par le client mail | Le jeton reçu faisait bien 64 caractères et son empreinte SHA-256 correspondait exactement à celle stockée en base |
| Brevo est lent, il faut attendre | Le blocage est instantané, à la seconde près |
| La clé API est invalide | Elle est valide, l'appel `GET /v3/account` répond correctement |
| L'expéditeur n'est pas validé chez Brevo | Il l'est, `active: true` |

Le point commun de toutes ces hypothèses : elles portaient sur la **livraison**. Or il n'y a
jamais eu de tentative de livraison.

---

## La cause

Brevo tient une liste de blocage propre aux emails transactionnels. Une adresse y entre dès
que son propriétaire manifeste qu'il ne veut plus rien recevoir. Cela se produit de trois
façons, dont deux presque involontaires :

- un clic sur un lien de désabonnement dans le corps du message,
- un clic sur le bouton « Se désabonner » que **Gmail affiche lui-même en haut de chaque
  message**, sans qu'on ait besoin d'ouvrir l'email,
- un signalement en indésirable, qui déclenche parfois le même signal.

Une fois l'adresse sur cette liste, **Brevo refuse tout envoi vers elle, emails
transactionnels compris**. Vérification d'adresse et réinitialisation de mot de passe sont
traitées exactement comme une newsletter.

Dans le cas rencontré, l'adresse y était depuis dix jours :

```
email  : (adresse de test)
raison : unsubscribedViaEmail
depuis : 2026-07-15T11:47:41.610Z
```

---

## Le vrai problème, celui qui nous concerne

Brevo **accepte l'appel API, répond succès, puis bloque en interne**. Voici les deux moitiés
de la même seconde :

```
POST /api/auth/register 201        <- notre serveur : inscription réussie
18:15:53  blocked                  <- Brevo, la même seconde : jamais envoyé
```

`sendEmail` reçoit un `res.ok` et ne lève rien. **Notre code est donc structurellement
incapable de distinguer un email parti d'un email refusé.** Ce n'est pas un oubli de gestion
d'erreur de notre part : il n'y a aucune erreur à gérer.

Conséquence : ni l'utilisateur, ni le support, ni les logs ne disposent du moindre signal. Le
seul symptôme est « je ne reçois pas le mail », et il n'existe aucun moyen de diagnostic
depuis l'application. C'est précisément ce qui a coûté une heure ici, sur un projet qu'on
connaît, avec un accès complet à la base et à l'API.

---

## La preuve

Quatre tentatives d'inscription, quatre blocages instantanés, quatre `201` côté serveur.
Pendant ce temps, une autre adresse Gmail, non bloquée, recevait normalement :

```
17:56:57  delivered   autre-adresse@gmail.com     <- puis opened, puis clicks
18:15:53  blocked     adresse-bloquee@gmail.com
18:18:54  blocked     adresse-bloquee@gmail.com
18:26:03  blocked     adresse-bloquee@gmail.com
18:51:39  blocked     adresse-bloquee@gmail.com
```

Deux adresses chez le même fournisseur, même expéditeur, même application, deux résultats
opposés. La seule différence : l'une figurait sur la liste de blocage.

**Contre-épreuve faite** : après retrait de l'adresse de la liste, sans aucune modification
du code ni de la configuration, l'email est arrivé. La cause est donc établie, pas supposée.

---

## Ce qu'il faut corriger

Par ordre d'urgence.

**1. Retirer le lien de désabonnement des emails transactionnels.** Une vérification
d'adresse et une réinitialisation de mot de passe ne sont pas du marketing. Elles ne
devraient pas proposer ce choix, ni dépendre de cette liste. C'est le correctif de fond :
sans lui, les deux autres ne font que limiter les dégâts.

**2. Détecter le blocage plutôt que répondre un faux succès.** L'API expose
`GET /v3/smtp/blockedContacts/{email}`, qui répond 404 si l'adresse est libre. Un appel
avant l'envoi, ou une vérification après, permet de renvoyer un message utile à
l'utilisateur au lieu de le laisser attendre un email qui ne partira jamais.

**3. Donner au support un moyen de voir et de lever un blocage.** Sans ça, chaque cas
demandera un accès au tableau de bord Brevo et la connaissance de l'endroit où cette liste
est rangée.

---

## Procédure de support, en attendant

**Lister toutes les adresses bloquées**, à faire tourner de temps en temps : chaque adresse
présente ici est un utilisateur qui ne peut plus récupérer son compte et qui n'en sait rien.

```bash
cd backend
KEY=$(grep '^BREVO_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
curl -s -H "api-key: $KEY" 'https://api.brevo.com/v3/smtp/blockedContacts?limit=100' \
  | python3 -c "
import sys, json
c = json.load(sys.stdin).get('contacts', [])
print('aucune adresse bloquee' if not c else f'{len(c)} adresse(s) bloquee(s) :')
for x in c:
    print(f\"  {x.get('email')}  |  {x.get('reason',{}).get('code','?')}  |  depuis {x.get('blockedAt','?')[:10]}\")
"
```

Attention à ne pas confondre avec la liste des **contacts marketing blacklistés**, qui est
une autre liste, indépendante, et qui n'a aucun effet sur les emails transactionnels. C'est
celle qu'on trouve en premier dans l'interface, et chercher là ne donne rien. Pour la
consulter malgré tout : `GET /v3/contacts`, champ `emailBlacklisted`.

**Vérifier si une adresse est bloquée :**

```bash
cd backend
KEY=$(grep '^BREVO_API_KEY=' .env | cut -d= -f2- | tr -d '"'"'"' \r')
curl -s -H "api-key: $KEY" \
  "https://api.brevo.com/v3/smtp/blockedContacts/adresse@exemple.fr" -w "\nHTTP %{http_code}\n"
```

`200` avec un motif signifie bloquée, `404` signifie libre.

**Lever le blocage :**

```bash
curl -s -X DELETE -H "api-key: $KEY" \
  "https://api.brevo.com/v3/smtp/blockedContacts/adresse@exemple.fr" -w "HTTP %{http_code}\n"
```

`204` signifie que c'est fait. L'adresse peut de nouveau recevoir, et elle retournera sur la
liste si son propriétaire se désabonne à nouveau.

**Voir l'historique complet d'une adresse**, ce qui répond en une requête à « est-ce que
l'email est parti ? » :

```bash
curl -s -H "api-key: $KEY" \
  "https://api.brevo.com/v3/smtp/statistics/events?limit=30&email=adresse%40exemple.fr"
```

Les événements à lire : `requests` signifie que nous avons demandé l'envoi, `delivered` que
le destinataire l'a reçu, `blocked` que Brevo a refusé, `soft_bounce` et `hard_bounce` que le
serveur destinataire a refusé.

---

## À retenir pour la suite

Le réflexe qui aurait fait gagner une heure : **interroger l'historique de l'API avant de
formuler la moindre hypothèse**. Le code et la base s'arrêtent à « Brevo a accepté ». Seul
Brevo sait ce qu'il a fait ensuite, et il le dit très précisément si on le lui demande.

C'est vrai de tout service externe où l'on délègue une action sans en observer le résultat :
tant qu'on n'a pas regardé son journal, on ne fait que deviner.
