# Audit Complet du Projet Prim'O

## Résumé
Audit complet du projet suite à la synchronisation avec main et aux changements de déploiement. 
Date: 2026-07-21

---

## 1. BUGS CRITIQUES TROUVÉS

### 1.1 URLs Stripe Retour (CRITIQUE - Impact utilisateur)
**Fichier:** `/home/mateo/prim-o/backend/src/services/stripe.service.ts` (lignes 40-41)
**Problème:** Les URLs de succès/annulation Stripe pointent vers `/?payment=success|cancel` mais le router du frontend n'a pas de gestion pour ce query param sur `/`.
**Détail:**
- Backend génère: `${config.CLIENT_URL}/?payment=success`
- Frontend OwnerDashboard capte ce param mais ne le route pas correctement
- Router a `/billing/return` mais le frontend stripe les redirects vers `/?payment=`
- Incohérence entre la documentation du router et l'implémentation réelle

**Impact:** Après un paiement Stripe, l'utilisateur verra une notice mais ne sera pas redirigé vers `/billing/return` comme prévu.

**Solution requise:** Changer les URLs Stripe pour rediriger vers `/billing/return` plutôt que `/?payment=`:
```
success_url: `${config.CLIENT_URL}/billing/return?payment=success`,
cancel_url: `${config.CLIENT_URL}/billing/return?payment=cancel`,
```

---

### 1.2 Absence de Variable VITE_API_URL pour Production Frontend (CRITIQUE)
**Fichier:** `/home/mateo/prim-o/frontend/src/services/api/client.ts` (ligne 5)
**Problème:** `const API_URL = import.meta.env.VITE_API_URL || '/api';`
- La variable `VITE_API_URL` n'est pas définie dans les fichiers `.env*` du frontend
- Pas de `.env.production` ou `.env` pour la production
- En dev, elle fait fallback à `/api` (proxy Vite), OK
- En production (Vercel), elle fera aussi fallback à `/api` (pas de proxy)
  → Les requêtes frontend iront à `https://prim-o.vercel.app/api/...` au lieu du backend Render

**Impact:** Perte totale de connectivité API en production (Vercel à Render)

**Solution requise:**
1. Créer `.env.production` dans `/frontend`
2. Définir `VITE_API_URL=https://primo-backend-3arx.onrender.com` (ou utiliser une variable Vercel)
3. Ou configurer `vercel.json` pour que toutes les requêtes soient relayées correctement

**Status:** Le vercel.json a un rewrite, mais il ne sera utilisé que si Vercel est le serveur et si la config est correcte.

---

### 1.3 Hardcoded Render Backend URL dans vercel.json (PROBLÈME DE MAINTENANCE)
**Fichier:** `/home/mateo/prim-o/frontend/vercel.json` (ligne 5)
**Problème:** 
```json
{ "source": "/api/(.*)", "destination": "https://primo-backend-3arx.onrender.com/api/$1" }
```
- URL du backend Render est écrite en dur
- Si le backend Render change de URL (redéploiement, changement de service), il faut manuellement mettre à jour le fichier
- Pas de variable d'environnement Vercel utilisée

**Impact:** Fragilité du déploiement, risque de bris après une redéploiement du backend

**Solution requise:**
- Configurer une variable d'environnement Vercel pour le backend URL
- Utiliser une variable d'environnement dans le rewrite (nécessite une config Vercel avancée ou déployer avec script)

---

## 2. PROBLÈMES DE CONFIGURATION

### 2.1 Manque de Variables CLIENT_URL en Render (Incomplet)
**Fichier:** `/home/mateo/prim-o/render.yaml` (ligne 15-16)
**Problème:**
```yaml
- key: CLIENT_URL
  sync: false
```
- `CLIENT_URL` est marquée `sync: false` mais n'a pas de valeur par défaut
- Elle doit être configurée manuellement dans le dashboard Render
- Pas de documentation sur la valeur attendue

**Impact:** Si `CLIENT_URL` n'est pas définie sur Render, les URLs Stripe et les redirections casseront.

**Solution requise:**
- Documenté: La valeur doit être `https://prim-o.vercel.app` (ou le vrai URL Vercel)
- Ajouter un commentaire ou valeur par défaut

---

### 2.2 Absence de Variable API_URL par Défaut en render.yaml (Incomplet)
**Fichier:** `/home/mateo/prim-o/render.yaml` (ligne 17-18)
**Problème:**
```yaml
- key: API_URL
  sync: false
```
- `API_URL` est utilisée dans `stripe.service.ts` pour construire les URLs de retour (indirectement via CLIENT_URL)
- Pas de valeur par défaut
- Pas documentée

**Impact:** Redondant avec CLIENT_URL, mais si elle est utilisée ailleurs, elle manque de config.

---

### 2.3 Frontend `.env.local` contient un Token Vercel (SÉCURITÉ)
**Fichier:** `/home/mateo/prim-o/frontend/.env.local`
**Problème:**
```
VERCEL_OIDC_TOKEN="eyJ..."
```
- Token JWT Vercel OIDC exposé en plaintext dans un fichier localisé `.env.local`
- Ce token est lisible par git si un `.gitignore` malformé l'autorise
- Ce token permet l'authentification aux APIs Vercel

**Impact:** Risque de sécurité si ce token se retrouve sur une branche partagée ou dans git history

**Solution requise:**
- `.env.local` doit être en `.gitignore` (vérifier)
- Ce token ne doit pas être dans git
- Ne doit pas être commité

---

### 2.4 Manque de Variable d'Environnement API_URL en render.yaml pour Email Verification
**Fichier:** `/home/mateo/prim-o/backend/src/config.ts` (ligne 9)
**Problème:**
```ts
API_URL: z.string().default('http://localhost:4000'),
```
- `API_URL` a un default local, mais en production elle doit pointer au backend public URL
- En render.yaml, elle n'est pas configurée, donc sera `http://localhost:4000`
- Quand Brevo envoie un email de vérification avec lien, le lien aura `http://localhost:4000` au lieu du vrai URL

**Impact:** Les liens de vérification email dans les emails seront cassés en production

**Solution requise:**
- Ajouter dans render.yaml:
```yaml
- key: API_URL
  value: "https://primo-backend-3arx.onrender.com"
```

---

## 3. PROBLÈMES DE CONFIGURATION STRIPE

### 3.1 Clés Stripe Hardcoded en .env (Sécurité)
**Fichier:** `/home/mateo/prim-o/backend/.env`
**Problème:**
- Les clés Stripe secrètes sont en plaintext dans le git (même si .env est théoriquement .gitignore)
```
STRIPE_SECRET_KEY=sk_test_[CLE_MASQUEE]...
STRIPE_WEBHOOK_SECRET=whsec_[CLE_MASQUEE]...
```

**Impact:** 
- Si .env est commité, ces clés de test sont visibles
- Production utilisera différentes clés (heureusement) via Render vars
- Mais idéalement les clés test ne devraient pas être dans git non plus

**Solution requise:**
- Vérifier que `.env` est bien en `.gitignore`
- En production, les clés sont gérées par Render → OK
- En dev local, garder `.env` ignoré → OK

---

### 3.2 Clé BREVO_API_KEY Exposée dans `.env`
**Fichier:** `/home/mateo/prim-o/backend/.env` (ligne 24)
**Problème:**
```
BREVO_API_KEY=xkeysib-[CLE_MASQUEE]
```
- Clé API Brevo exposée en plaintext
- Même problème que Stripe (dépend de .gitignore)

**Impact:** Faible (clé de test), mais même principe de sécurité

---

## 4. PROBLÈMES DE CONFIGURATION CORS/DÉPLOIEMENT

### 4.1 CORS Configuré Strictement sur CLIENT_URL (Dépend de Config Correcte)
**Fichier:** `/home/mateo/prim-o/backend/src/app.ts` (ligne 42)
**Problème:**
```ts
app.use(cors({origin: config.CLIENT_URL, credentials: true}));
```
- CORS n'accepte que `CLIENT_URL` exactement
- Si CLIENT_URL est mal configurée en Render, le CORS échouera
- Dépend entièrement de la config Render

**Impact:** 
- En dev: OK (CLIENT_URL=http://localhost:5180)
- En prod: OK seulement si CLIENT_URL est exact (doit être https://prim-o.vercel.app)

**Pré-requis:** `CLIENT_URL` doit être correctement définie en Render

---

### 4.2 Health Check Endpoint Existe
**Fichier:** `/home/mateo/prim-o/backend/src/app.ts` (lignes 72-74)
**Status:** OK
```ts
app.get('/health', (req, res) => {
  res.json({ status: 'ok', env: config.NODE_ENV });
});
```
- Render.yaml configure le health check (ligne 9): `healthCheckPath: /health` ✓
- Endpoint répond avec status "ok" ✓

---

## 5. PROBLÈMES D'ARCHITECTURE/FRONTEND

### 5.1 Absence de .env.production pour Frontend
**Fichier:** N/A (fichier manquant)
**Problème:**
- Pas de fichier `.env.production` pour configurer l'API URL en production
- Seul `.env.local` existe (contenant seulement le token Vercel)

**Impact:** 
- Frontend ne peut pas customiser API_URL pour la production
- Dépend du rewrite vercel.json (qui peut échouer)

**Solution requise:**
- Créer `.env.production` ou configurer les variables Vercel directement

---

### 5.2 PWA Configuration Incomplète (Mineur)
**Fichier:** `/home/mateo/prim-o/frontend/vite.config.js` (lignes 12-31)
**Observations:**
- PWA configurée correctement
- Icons listés dans le manifest
- DevOptions disabled en dev (OK, évite les confused caches)
- Status: OK ✓ (pas de problème)

---

### 5.3 Frontend Build Command sans Landing Page
**Fichier:** `/home/mateo/prim-o/frontend/package.json` (ligne 9)
**Observations:**
```json
"build": "tsc -b && vite build",
```
- Lance `tsc -b` qui compile le project root (tsconfig.json)
- Root tsconfig inclut "landing" (ligne 16): `"include": ["src", "landing"]`
- La landing a sa propre vite.config.js (landing/vite.config.js)
- Status: OK ✓ (build root qui inclut src et landing)

**Note:** Mais landing est compilée deux fois:
1. `tsc -b` compile root (inclut landing)
2. `vite build` compile src (pas landing)
- Landing a besoin de `npm run build:landing` séparé

---

## 6. DÉPLOIEMENT - État du Build

### 6.1 Build Backend Fonctionne
**Fichier:** `/home/mateo/prim-o/backend/package.json` (ligne 8)
**Observations:**
- `npm run build` → `tsc` compile le TypeScript en `dist/` ✓
- Tests: `npm test` et `npm run test:int` existent ✓
- start:render: `prisma migrate deploy && node dist/server.js` ✓

**Status:** OK

---

### 6.2 Build Frontend Fonctionne
**Fichier:** `/home/mateo/prim-o/frontend/package.json` (line 9)
**Observations:**
- `npm run build` → compile et crée `dist/` ✓
- Vercel configure buildCommand correctement (vercel.json)

**Status:** OK

---

## 7. PROBLÈMES DE LOGIQUE MÉTIER

### 7.1 Stripe Success/Cancel URLs Mismatch (Déjà mentionné)
**Détail supplémentaire:**
- Backend génère: `/?payment=success`
- Router attend: `/billing/return?payment=success` (selon le code)
- OwnerDashboard capture `?payment=` sur `/` (par side effect)
- Marche accidentellement en dev, mais le design est confus

---

### 7.2 Email Verification Link Cassé en Production (Déjà mentionné)
**Details:**
- Backend construit le lien avec `API_URL`
- API_URL défaut = `http://localhost:4000` 
- En Render sans config → email aura lien local invalide

---

## 8. VARIABLES D'ENVIRONNEMENT CRITIQUES

### Render.yaml Summary:
```yaml
VARIABLES CONFIGURÉES (avec valeur ou default):
✓ NODE_ENV = production
✓ JWT_SECRET = generateValue: true (Render génère)
✓ TOKEN_PRICE_CENTS = 100
✓ BREVO_SENDER_NAME = "Prim'O"

VARIABLES NON CONFIGURÉES (sync: false, pas de default):
✗ DATABASE_URL - CRITIQUE (nécessite config Render)
✗ CLIENT_URL - CRITIQUE (nécessite config Render) 
✗ API_URL - MANQUANT (n'existe pas dans render.yaml, devrait être là)
✗ STRIPE_SECRET_KEY - nécessaire
✗ STRIPE_WEBHOOK_SECRET - nécessaire
✗ BREVO_API_KEY - optionnel
✗ BREVO_SENDER_EMAIL - optionnel
```

---

## 9. RÉSUMÉ DES PROBLÈMES PAR SÉVÉRITÉ

### CRITIQUES (Bloquent production):
1. **Stripe return URLs mismatch** → Paiements cassés
2. **Frontend API_URL manquant** → API inaccessible en production
3. **API_URL non configurée en render.yaml** → Email links cassés

### IMPORTANTS (Doivent être fixés):
4. **Hardcoded backend URL dans vercel.json** → Fragilité
5. **CLIENT_URL non documentée en render.yaml** → CORS pourrait casser

### MINEURS (À améliorer):
6. **Secrets dans .env** → Dépend de .gitignore
7. **Frontend .env.local non documenté** → Confus

### OK (Pas de problème):
- Build scripts fonctionnent
- Health check configuré
- PWA config OK
- Migration Prisma OK

---

## 10. CHECKLIST DÉPLOIEMENT PRODUCTION

Pour déployer en production, vérifier:

- [ ] DATABASE_URL configurée en Render (PostgreSQL)
- [ ] CLIENT_URL = `https://prim-o.vercel.app` en Render
- [ ] API_URL = `https://primo-backend-3arx.onrender.com` en Render (NEW)
- [ ] STRIPE_SECRET_KEY configurée en Render (clé live)
- [ ] STRIPE_WEBHOOK_SECRET configurée en Render (clé live)
- [ ] BREVO_API_KEY configurée en Render (ou omise pour dev mode)
- [ ] BREVO_SENDER_EMAIL = email vérifié en Brevo
- [ ] JWT_SECRET générée en Render (auto)
- [ ] Vercel rewrite pointe à bon backend URL
- [ ] Frontend .env.production a VITE_API_URL (ou Vercel env vars)
- [ ] Stripe URLs de return pointent à `/billing/return` (pas `/?payment=`)
- [ ] Email templates utilisent le bon API_URL pour les links

---

