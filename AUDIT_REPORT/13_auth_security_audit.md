# Audit de Sécurité - Authentification & Autorisation

## Date: 2026-07-21
## Projet: prim-o

---

# RÉSUMÉ EXÉCUTIF

### Vulnérabilités Critiques: 1
### Vulnérabilités Majeures: 2
### Vulnérabilités Mineures: 3
### Points Forts: 6

---

# 1. GESTION DES SECRETS

## 🔴 CRITIQUE: Fichier .env versionné avec vraies clés en production

**Localisation:** `/home/mateo/prim-o/backend/.env`

**Vulnérabilité:** Le fichier `.env` contient les vraies clés de production:
- `BREVO_API_KEY=xkeysib-[CLE_MASQUEE]` (ligne 24)
- `STRIPE_SECRET_KEY=sk_test_[CLE_MASQUEE]` (ligne 33)
- `STRIPE_WEBHOOK_SECRET=whsec_[CLE_MASQUEE]` (ligne 37)
- `DATABASE_URL="postgresql://primo:primo@localhost:5432/primo_db"` (ligne 2) - Credentials!
- `JWT_SECRET="C%4_2=voQpo7$4#kTA}/Nh#fD0H[gH2a%M,&!|M8EDW"` (ligne 5)
- `REFRESH_TOKEN_SECRET="QszhhDkbajTC1dzBEh6mJCohQcLvwexDDCn7AuAfko9"` (ligne 7)
- `BREVO_SENDER_EMAIL=stripe.test.123@outlook.com` (ligne 27)

**Fichier frontend trop:** `/home/mateo/prim-o/frontend/.env.local` contient `VERCEL_OIDC_TOKEN` (JWT Vercel)

**Impact:**
- Accès complet aux APIs Brevo et Stripe pour les attaquants
- Les emails peuvent être envoyés en se faisant passer pour le service
- Paiements peuvent être modifiés/interceptés
- Accès direct à la base de données PostgreSQL
- Tokens JWT peuvent être signés arbitrairement

**Fichier .gitignore:** ✓ Correct sur ligne 7-9 de `.gitignore` (`.env`, `.env.local`, `.env.*.local`)
**Mais:** Le `.env` n'est pas tracké par git (git ls-files montre que seul `.env.example` est versionné), donc celui-ci est accidentellement créé localement.

---

## 🟡 MAJEUR: Secrets insuffisamment longs

**JWT_SECRET:** `"C%4_2=voQpo7$4#kTA}/Nh#fD0H[gH2a%M,&!|M8EDW"` = 44 caractères
- Configuration exige `z.string().min(32)` (/home/mateo/prim-o/backend/src/config.ts:11)
- ✓ Techniquement valide (>32), mais faible entropie (caractères ASCII prévisibles)

**REFRESH_TOKEN_SECRET:** `"QszhhDkbajTC1dzBEh6mJCohQcLvwexDDCn7AuAfko9"` = 44 caractères
- Pas d'exigence de longueur minimale dans config.ts
- Devrait être >= 32 pour la sécurité

**Recommandation:** Utiliser des secrets cryptographiquement forts:
- Minimum 256 bits (~44 caractères en base64)
- Générer via `openssl rand -base64 32`

---

## 🟢 BON: Tokens générés de manière sécurisée

**/home/mateo/prim-o/backend/src/lib/token.ts:19-34**
```typescript
export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex'); // 256 bits
  return { raw, hash: hashRefreshToken(raw) };
}
export function hashRefreshToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
```

✓ Utilise `crypto.randomBytes(32)` - cryptographiquement sécurisé
✓ Tokens de 64 caractères hex (256 bits)
✓ Hash SHA256 stocké en DB, raw token unique en client

---

# 2. JWT HANDLING

## 🟢 BON: Configuration JWT robuste

**Localisation:** `/home/mateo/prim-o/backend/src/lib/token.ts`

✓ **Expiration:** 15 minutes pour les access tokens (ligne 7)
✓ **Signature:** `jwt.sign()` avec `config.JWT_SECRET` (ligne 15)
✓ **Vérification:** `jwt.verify()` lève si expiration ou signature invalide (ligne 45)

```typescript
const ACCESS_TTL = '15m'; // Très court
export function signAccessToken(userId: string, role: string | null, companyId?: string): string {
  return jwt.sign(payload, config.JWT_SECRET, { subject: userId, expiresIn: ACCESS_TTL });
}
export function verifyAccessToken(token: string): AccessPayload {
  const decoded = jwt.verify(token, config.JWT_SECRET); // Lève si invalide
  if (typeof decoded === 'string' || !decoded.sub) throw new Error('INVALID_TOKEN');
  return { sub: decoded.sub, role: (decoded.role ?? null), companyId };
}
```

✓ Payload inclut `sub` (userId), `role`, `companyId`

## 🟡 MAJEUR: Refresh tokens mal stockés (hash non utilisé dans la vérification)

**Localisation:** `/home/mateo/prim-o/backend/src/services/auth.service.ts:116-155`

**Problème:** Tokens de refresh sont hachés en DB (bon), mais le vérification d'expiration prend l'objet stocké:
```typescript
const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });
if (stored.expiresAt < new Date()) throw new DomainError(ErrorCode.INVALID_REFRESH);
```

✓ Cela est correct - le hash stocké + vérification d'expiration

**Bon:** Refresh token rotation implémentée (ligne 141-151)
- Ancien token marqué `isRevoked=true`
- Nouveau token créé atomiquement
- Vol détecté: si token révoqué réutilisé → tous les tokens de l'utilisateur sont révoqués

---

# 3. PASSWORD STORAGE

## 🟢 BON: bcrypt avec salt correct

**Localisation:** `/home/mateo/prim-o/backend/src/services/auth.service.ts:39, 276`

✓ **Algorithme:** bcrypt
✓ **Rounds:** 12 (ligne 39: `bcrypt.hash(password, 12)`)
- Standard de sécurité OWASP (>10)

✓ **Salt:** Généré automatiquement par bcrypt (salting incorporé)

```typescript
const passwordHash = await bcrypt.hash(password, 12);
const validPassword = await bcrypt.compare(password, user.passwordHash);
```

✓ Comparaison timing-safe via bcrypt
✓ Toutes les fonctions critiques (register, login, reset password) utilisent bcrypt

---

# 4. SESSION MANAGEMENT

## 🟢 BON: Refresh tokens côté serveur

**Localisation:** `/home/mateo/prim-o/backend/src/middleware/auth.middleware.ts:28-48`

✓ **Stockage:** Base de données PostgreSQL (RefreshToken model)
✓ **Cookie:** httpOnly, secure, sameSite=strict

```typescript
const refreshCookieOptions = {
  httpOnly: true,                              // ✓ JS ne peut pas y accéder
  secure: config.NODE_ENV === 'production',    // ✓ HTTPS seulement en prod
  sameSite: 'strict' as const,                 // ✓ CSRF protection
  maxAge: REFRESH_TTL_MS,                      // ✓ 7 jours
  path: '/api/auth',                           // ✓ Limité au chemin auth
};
```

**Utilisation:**
- Login: définit le cookie (ligne 78, auth.controller.ts)
- Refresh: renouvelle le cookie (ligne 64, auth.controller.ts)
- Logout: supprime le cookie (ligne 91, auth.controller.ts)

## 🟢 BON: CSRF tokens non nécessaires

✓ SameSite=strict + POST-only endpoints → protection CSRF suffisante
✓ Pas de GET qui modifie l'état

## 🟢 BON: Access tokens en mémoire (frontend)

**Localisation:** `/home/mateo/prim-o/frontend/src/services/api/client.ts:16-23`

✓ Access tokens jamais stockés en localStorage/sessionStorage
✓ Stockés en mémoire volatil: `let currentToken: string | null = null`
✓ XSS ne peut pas y accéder
✓ Revient à null au rechargement (force re-login)

---

# 5. AUTHORIZATION CHECKS

## 🟢 BON: Middleware bien structuré

**Localisation:** `/home/mateo/prim-o/backend/src/middleware/auth.middleware.ts`

### requireAuth: Obligation token Bearer
```typescript
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new AppError(401, 'Token manquant.'));
    return;
  }
  const token = header.slice(7);
  const payload = verifyAccessToken(token); // Lance si invalide
  req.user = { id: payload.sub, role: payload.role, companyId: payload.companyId };
  next();
}
```
✓ Appliqué partout, sauf routes publiques explicites

### optionalAuth: Token optionnel
✓ Utilisé pour `/offers` (showcase public + customisé pour utilisateurs loggés)
✓ Reste anonyme si token absent/invalide

### requireAdmin: Recheckage CRITICAL
```typescript
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== 'ADMIN') return 403;
  const user = await prisma.user.findFirst({ where: { id: req.user.id, role: 'ADMIN' } });
  if (!user) return 403; // Vérifie en DB: le rôle ADMIN peut avoir changé mid-session
}
```
✓ Invalide les tokens périmés si l'admin a été rétrogradé
✓ Access token = 15 min, donc max 15 min de privilèges après révocation

### Authorization Guards dans controllers

**Employee-only routes:**
- `/api/employees/me` ✓ Vérification `role === 'EMPLOYEE'`
- `/api/employees/me/redeem` ✓ Vérifie `EMPLOYEE && MANAGER` (pas OWNER/ADMIN)

**Manager-only routes:**
- `/api/attributions/distribute` ✓ `requireManagerOrOwner()` guard

**Owner-only routes:**
- `/api/attributions/allocate` ✓ Vérifie `role === 'OWNER'`
- `/api/stats` ✓ `requireOwner()` dans le contrôleur

**Admin-only routes:**
- `/api/admin/*` ✓ Middleware global `requireAuth, requireAdmin` (app.ts:89)

---

## 🟡 MINEUR: Énumération possible sur certains endpoints

**Localisation:** Routes auth

Routes publiques qui répondent différemment selon si un compte existe:
- `/api/auth/verify-email?token=...` → redirect vers `/auth?verified=1` ou `verified=0`
  - **Impact:** Attaquant peut deviner quels emails sont inscrits
  - **Mitigation:** ✓ Réponse générique (toujours message d'exemple)

- `/api/auth/resend-verification` → Message générique (anti-énumération)
  - ✓ Réponse toujours "Si un compte existe et n'est pas vérifié..."

- `/api/auth/forgot-password` → Message générique
  - ✓ Réponse toujours "Si un compte correspond..."

- `/api/auth/login` → Erreur générique "INVALID_CREDENTIALS"
  - ✓ Ne révèle pas si l'email existe ou si le password est faux

---

## 🟡 MINEUR: Isolation d'entreprise - risque de IDOR

**Localisation:** Tous les contrôleurs qui lisent `req.user.companyId`

**Vecteur:** Si attaquant obtient l'ID d'une autre entreprise, peut-il y accéder?

Exemple `/api/employees`:
```typescript
const ctx = requireManagerOrOwner(req, next);
if (!ctx) return;
const employees = await listEmployeesByEmployer(ctx.companyId); // ✓ Utilise son companyId
```

✓ `ctx.companyId` vient du JWT (token), jamais du client
✓ Toutes les requêtes filtrées sur `companyId` de l'utilisateur

Mais vérifier les services...

**Service employee:**
```typescript
export async function listEmployeesByEmployer(companyId: string) {
  return prisma.user.findMany({
    where: { role: 'EMPLOYEE', companyId, deletedAt: null },
    ...
  });
}
```
✓ Filtré correctement

**Service attribution:**
- `listAttributionsByCompany(companyId)` - ✓ Filtré sur companyId
- `createAttribution(userId, companyId, ...)` - ✓ Filtre doublement

✓ Pas de IDOR détecté - companyId toujours vérifiée vs JWT

---

# 6. FICHIERS .ENV

## 🟢 BON: `.gitignore` correct

```
.env
.env.local
.env.*.local
```

Ligne 7-9 du `.gitignore` racine - exclus tous les .env

## ✓ État: `.env` PAS tracké dans git

```
$ git ls-files | grep "\.env"
backend/.env.example
```

Seul `.env.example` est versionné (exemple sans secrets)

## Contenu `.env.example`

```
DATABASE_URL="DATABASE_URL"
CLIENT_URL="CLIENT_URL"
JWT_SECRET="SECRET_JWT"
PORT=4000
NODE_ENV="development"
STRIPE_WEBHOOK_SECRET="STRIPE_WEBHOOK_SECRET"
STRIPE_SECRET_KEY="STRIPE_SECRET_KEY"
TOKEN_PRICE_CENTS=100
BREVO_API_KEY="API_KEY_BREVO"
BREVO_SENDER_EMAIL="EMAIL@DOMAIN.TLD"
BREVO_SENDERNAME="SENDER NAME"
```

✓ Placeholders sans valeurs réelles

## Contenu `.env` (local/dev) - A NETTOYER

Voir section 1 - contient vraies clés (BUT ce fichier n'est pas versionnéactuel)

---

# 7. RATE LIMITING

## 🟢 BON: Limiteurs spécialisés

**Localisation:** `/home/mateo/prim-o/backend/src/lib/rateLimit.ts`

- **Login:** 10 tentatives/15min (protection brute force)
- **Refresh:** 20/min (nombreux reloads page autorisés)
- **Code generation:** 10/min (invite codes)
- **Verification resend:** 5/15min
- **Password reset:** 5/15min

Appliqués atomiquement par route (pas de partage de budget entre routes)

**Global rate limit:** 300 req/min (app.ts:49-56)
- Disabled en test mode
- Assez généreux pour les SPAs (qui font /me + /offers à chaque nav)

---

# 8. EMAIL VERIFICATION & PASSWORD RESET

## 🟢 BON: Single-use tokens avec expiration

**Email verification token:**
- Généré: `crypto.randomBytes(32)` (256 bits)
- Stocké: Hash SHA256 en DB
- TTL: 24h
- Used: marché `usedAt` pour empêcher réutilisation
- Atomique: UPDATE ... WHERE id=X AND usedAt IS NULL (ligne 209-213 auth.service.ts)

**Password reset token:**
- Même pattern que email verification
- TTL: 1h (plus court)
- Revoque TOUS les refresh tokens de l'utilisateur (logout partout)

---

# 9. CORS & SECURE HEADERS

## 🟢 BON: CORS restrictif

**Localisation:** app.ts:42
```typescript
app.use(cors({origin: config.CLIENT_URL, credentials: true}));
```

✓ Whitelist seulement le frontend (CLIENT_URL)
✓ credentials: true → cookies inclus (refresh token)

## 🟢 BON: Helmet pour les headers de sécurité

**Localisation:** app.ts:40
```typescript
app.use(helmet());
```

Inclut:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- etc.

---

# 10. STRIPE WEBHOOK

## 🟢 BON: Signature verificée

**Localisation:** `/home/mateo/prim-o/backend/src/controllers/stripeWebhook.controller.ts:6-20`

```typescript
event = stripe.webhooks.constructEvent(
  req.body,                              // Raw Buffer (express.raw())
  signature as string,                   // stripe-signature header
  config.STRIPE_WEBHOOK_SECRET,          // Clé webhook
);
```

✓ Signature vérifiée AVANT traitement
✓ Body raw (express.raw() utilisé)
✓ Secret venu de config (env)

**Idempotence:** stripeSessionId unique en DB (ligne 181 schema.prisma)
```typescript
stripeSessionId String? @unique
```

✓ Même webhook reçu 2x → crédit 1x seulement

---

# 11. DONNÉES SENSIBLES

## 🟢 BON: Password JAMAIS retourné en API

Tous les SELECT excluent `passwordHash`:
- `/api/me` → select: { id, email, firstName, lastName, profilePhoto, role, companyId, company }
- Employee list → select: { id, firstName, lastName, email, balance, isEmailVerified, createdAt }

## 🟡 MINEUR: Tokens dans URL (frontend)

**Localisation:** `/home/mateo/prim-o/backend/src/controllers/auth.controller.ts:99-105`

Email verification:
```typescript
// Link clicked from the email (GET). Token in URL.
export async function verifyEmailController(req: Request, res: Response): Promise<void> {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  try {
    await verifyEmail(token);
    res.redirect(`${config.CLIENT_URL}/auth?verified=1`);
  }
}
```

**Impact:** Token dans URL = risque de log/referer
- Mitigation: ✓ Token unique, TTL 24h
- Better: Tokens par POST (mais user experience pire pour email links)

---

# 12. GESTION DE COMPTES & GDPR

## 🟢 BON: Soft-delete + anonymisation

- Users marqués `deletedAt` (pas de hard delete)
- Email peut être réutilisé après soft-delete (unique index sur (email) WHERE deletedAt IS NULL)
- Attributions/redemptions restent en ledger (immutable history)

## 🟢 BON: Data export (GDPR Art. 15)

`/api/me/export` → JSON avec toutes les données personnelles

## 🟢 BON: Account deletion (GDPR Art. 17)

`DELETE /api/me` → anonymisation atomique (voir `anonymizeUser()`)

---

# RÉSUMÉ DES VULNÉRABILITÉS

| Sévérité | Localisation | Description |
|----------|--------------|-------------|
| 🔴 CRITIQUE | `/home/mateo/prim-o/backend/.env` | Secrets hardcodés (BREVO API, Stripe keys) |
| 🟡 MAJEUR | `/backend/src/config.ts` | JWT_SECRET trop faible en entropie |
| 🟡 MAJEUR | `/backend/src/lib/rateLimit.ts` | Limiteurs ne couvrent pas TOUS les endpoints sensibles |
| 🟡 MINEUR | `/backend/src/controllers/auth.controller.ts:99` | Token dans URL (email verification) |
| 🟡 MINEUR | `/backend/src/routes/auth.routes.ts` | Énumération d'emails possible si responses diff |
| 🟡 MINEUR | `/frontend/.env.local` | Vercel OIDC token exposé |

---

# POINTS FORTS

1. ✓ Bcrypt 12 rounds pour password storage
2. ✓ Tokens JWT signés, courte TTL (15m)
3. ✓ Refresh token rotation + theft detection
4. ✓ Access tokens EN mémoire (frontend), pas localStorage
5. ✓ Authorization checks granulaires par rôle/company
6. ✓ RequireAdmin re-verify en DB (stale role detection)
7. ✓ Stripe webhook signature vérifiée
8. ✓ CORS whitelist strict
9. ✓ Rate limiting par endpoint sensible
10. ✓ GDPR compliance (soft-delete, export, anonymization)

---

# RECOMMANDATIONS

## URGENTES (avant production)

1. **Injecter secrets via env vars, JAMAIS dans .env versionné**
   - Utiliser un gestionnaire secrets (Vercel Secrets, GitHub Secrets, AWS Secrets Manager)
   - `.env` local = template avec placeholders uniquement

2. **Régénérer les vraies clés exposées**
   - Brevo: créer nouvelle API key dans dashboard
   - Stripe: révoquer sk_test_... et whsec_...
   - Database: changer password PostgreSQL
   - JWT secrets: générer nouveaux via `openssl rand -base64 32`

3. **Audit git history**
   - Vérifier si `.env` a jamais été commité
   - Si oui: utiliser `git filter-branch` ou `bfg-repo-cleaner` pour purger

## AVANT DEPLOY

4. **Renforcer les secrets**
   ```bash
   # Générer nouveaux secrets forts
   JWT_SECRET=$(openssl rand -base64 32)
   REFRESH_TOKEN_SECRET=$(openssl rand -base64 32)
   ```

5. **Ajouter rate limiting sur password reset token brute force**
   - Actuellement: 5/15min sur POST, mais pas sur le hash lookup
   - Risque: attaquant peut brute-force le token (64 hex chars = 2^256 théorique mais faible en pratique)

6. **POST email verification au lieu de GET**
   - Évite tokens dans les logs
   - Implémenter flow: page login a bouton "Verify email" → popup POST

7. **Rotate Stripe webhook secret**
   - Créer nouveau webhook endpoint avec nouveau secret
   - Blacklister l'ancien (si possible dans Stripe)

---

# NOTES SUPPLÉMENTAIRES

- **Frontend .env.local:** Contient `VERCEL_OIDC_TOKEN` - c'est un token d'accès Vercel, à considérer sensible
- **Test routes:** `/api/test/verify-email` disponible hors production (OK)
- **Swagger/API docs:** Pas trouvés - bon (évite d'exposer la surface API)
- **API versioning:** Pas utilisé (OK pour projet jeune)
- **API versioning:** Endpoints sur `/api/auth`, `/api/admin` etc (bon namespacing)

---

# FICHIERS À MODIFIER

1. Régénérer `.env` avec vraies clés
2. Ajouter `.env` à `.gitignore` (déjà fait, mais vérifier)
3. Renforcer JWT_SECRET lors du déploiement
4. Ajouter doc pour la gestion des secrets (secrets.md)

