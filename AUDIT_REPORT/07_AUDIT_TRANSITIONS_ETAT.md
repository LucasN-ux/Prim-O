# AUDIT - Transitions d'État et Logique Métier Prim'O

## Aperçu général

Prim'O repose sur trois entités principales avec cycles de vie : **Company**, **User** (roles), **Offer** (motif), **Token balance**, et **Allocation** (envelopes).

**Schéma de base** : Prisma `schema.prisma` + raw SQL constraints (CHECK + partial unique index sur email).

**Multi-tenancy** : Company est la boundary; tout utilisateur non-ADMIN appartient à une Company.

---

## 1. COMPANY STATUS TRANSITIONS

### Cycle de vie : PENDING → APPROVED/REJECTED

**Modèle Prisma**:
```prisma
enum CompanyStatus { PENDING, APPROVED, REJECTED }
model Company {
  status CompanyStatus @default(PENDING)
  tokenBalance Int @default(0) // CHECK >= 0
  deletedAt DateTime?
}
```

### Scénarios d'état

#### 1.1 PENDING
- **Qui crée** : Utilisateur flottant via `POST /api/auth/create-company`
- **État initial** : `PENDING`
- **Que peut-on faire ?**
  - ✅ Générer un code invite (MANAGER/EMPLOYEE) – voir §1.3
  - ❌ Acheter des tokens (checkout) – `COMPANY_INACTIVE` (stripe.service.ts:18)
  - ❌ Allouer des tokens (allocateToManager) – `COMPANY_INACTIVE` (attribution.service.ts:90)
  - ❌ Créer une attribution directe – `COMPANY_INACTIVE` (attribution.service.ts:34)
  - ❌ Rejoindre via code invite – aucune vérification du status (auth.service.ts:93-100)

**PROBLÈME 1.1 : joinCompany ne valide pas Company.status**
```
Scénario :
  1. Owner crée company (PENDING)
  2. Owner génère code invite
  3. Personne rejoint via ce code
  4. Admin rejette la company (REJECTED)
  5. Personne reçoit un accès dans une company REJECTED

Résultat : User.companyId pointe une company REJECTED
Accès : Les checks de status se font à l'opération (attribut, checkout), pas au joinCompany
Attendu : Empêcher joinCompany si company ≠ APPROVED
```

**PROBLÈME 1.2 : Code invite pour PENDING company**
```
Scénario :
  1. Owner crée company (PENDING) et génère invite MANAGER
  2. Admin rejette la company (REJECTED)
  3. Code reste valide (pas de cascade delete/revoke)
  4. Quelqu'un peut toujours rejoindre une company REJECTED

Résultat : L'invite code ne se valide que sur expirationDate, maxUses, revokedAt (auth.service.ts:98-99)
Résultant : generateInviteCode check que company.status === APPROVED (invite.service.ts:37)
             MAIS dans joinCompany, on récupère simplement le companyId du code
Attendu : Ajouter un check joinCompany : company.status === APPROVED
```

#### 1.2 APPROVED
- **Comment y parvenir** : Via `POST /api/admin/companies/:id/status` (admin seulement)
- **Que peut-on faire ?** (tous les opérations activées)
  - ✅ Allouer, attribuer, acheter, générer invites
  - ✅ Les utilisateurs peuvent rejoindre via invites
  - ✅ Redemption fonctionne normalement

#### 1.3 REJECTED
- **Comment y parvenir** : Via `POST /api/admin/companies/:id/status` (admin seulement)
- **Que peut-on faire ?**
  - ❌ Opérations métier (allouer, attribuer, checkout) – tous check status !== REJECTED
  - ✅ Les sessions existantes restent actives (pas de revocation)
  - ⚠️ Les codes invites *restent valides* si la company APPROVED → REJECTED (pas de revoke auto)

**PROBLÈME 1.3 : Cascade de company REJECTED**
```
admin.service.ts::softDeleteCompany permet soft-delete :
  - Marque company.deletedAt
  - Revoque tous les refresh tokens des users (logique correcte)
  - Revoque tous les invite codes (logique correcte)

MAIS setCompanyStatus (PENDING → REJECTED) ne le fait PAS :
  - Pas de cascade
  - Utilisateurs existants restent attachés
  - Sessions restent valides
  - Codes restent valides

Scénario :
  1. Company PENDING → APPROVED
  2. 100 users rejoignent
  3. Company APPROVED → REJECTED
  4. Users peuvent toujours poster/consulter (checks au point d'opération)
  5. Admin doit soft-delete pour vraiment la tuer

Attendu : Clarifier la sémantique :
  - REJECTED = inaccessible ? → ajouter revocation cascade
  - REJECTED = archived ? → OK, laisser comme c'est (checks au point d'opération suffisent)
```

#### 1.4 Soft-delete (deletedAt != null)
```prisma
softDeleteCompany(companyId):
  - Soft-mark company.deletedAt
  - Soft-mark toutes les users (deletedAt)
  - Revoke refresh tokens
  - Revoke invite codes
  - Ledgers (Attribution, Redemption, CompanyTokenPurchase) restent intacts
```

**Problème 1.4 : Restauration avec collision email**
```
admin.service.ts::restoreCompany::ligne 159-166 :
  - Vérifie s'il existe des users actifs (deletedAt=null) avec le même email
  - Lance EMAIL_TAKEN si collision

Logique correcte, mais :
  - Le user DELETED n'est pas soft-marked anonyme (pas de anonymizeUser)
  - Son email dans la DB est toujours intact
  - Risque de collision + léger : si quelqu'un a repris l'email entre la suppression et la restauration

Attendu : Pas d'action ; la logique est sûre via la partial unique index
```

### Résumé Company Status

| État | Allocation | Attribution | Checkout | Invite code | Users existants | Notes |
|------|-----------|-------------|----------|------------|-----------------|-------|
| PENDING | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ Valides | ✅ Actifs | Aucune opération métier |
| APPROVED | ✅ OK | ✅ OK | ✅ OK | ✅ Valides | ✅ Actifs | État normal |
| REJECTED | ❌ BLOCKED | ❌ BLOCKED | ❌ BLOCKED | ✅ Valides* | ✅ Actifs* | *Codes/sessions pas révoqués |
| DELETED (soft) | ❌ Impossible | ❌ Impossible | ❌ Impossible | ❌ Révoqués | ❌ Supprimés | Ledger préservé |

---

## 2. USER DELETION & ROLE TRANSITIONS

### 2.1 User Soft-Delete (anonymization)

**Appels** :
- `privacy.service.ts::deleteOwnAccount()` → self-service (requiert password)
- `admin.service.ts::softDeleteUser()` → admin only
- `admin.service.ts::softDeleteCompany()` → cascade

**Logique** (privacy.service.ts:111-126):
```typescript
anonymizeUser(tx, userId):
  email = `deleted-${userId}@anonymized.local`
  firstName = null
  lastName = null
  passwordHash = '' // login impossible
  isEmailVerified = false
  deletedAt = now()
  // Delete: RefreshToken, EmailVerificationToken
  // Keep: PasswordResetToken (unused after passwordHash='')
  // Keep: User.role, User.companyId, User.balance (ledger references)
```

**Implications** :

#### Scénario 2.1.1 : Manager deleted, ses allocations/attributions
```
Scénario :
  1. Manager reçoit allocation: {id: alloc1, managerId: mgr1, amount: 10, status: A_DISTRIBUER}
  2. Admin delete le manager
  3. Allocation reste en DB : managerId toujours mgr1 (qui a deletedAt != null)
  4. Manager "fantôme" : allocation.manager.firstName = null
  5. Front affiche "null null"

Résultat réel :
  - Allocation n'est pas annulée
  - Les tokens de l'enveloppe sont bloqués (enveloppe gelée)
  - Front doit gérer deletedAt du manager pour l'affichage

Attendu :
  - Clarifier : enveloppe A_DISTRIBUER d'un manager deleted = perdue ?
  - Ajouter un job qui crédite la pool si enveloppe jamais distribuée après 90j ?
  - Ou : marquer allocation.status = CANCELLED si manager deleted ?
```

#### Scénario 2.1.2 : Employee deleted, ses attributions/redemptions
```
Scénario :
  1. Employee reçoit 10 tokens (attribution)
  2. Employee dépense 5 (redemption)
  3. Balance = 5
  4. Admin delete l'employee
  5. User.deletedAt = now(), balance = 5

Résultat :
  - Attributions/Redemptions gardées dans ledger (GDPR: anonymous data)
  - User.balance = 5 persiste
  - Les tokens "morts" dans la balance d'un user deleted

Attendu : Comportement correct (GDPR conforme) mais :
  - Tokens orphelins = non-utilisables
  - Pas de refund automatique vers la pool
  - Admin doit manuellement créditer pool si nécessaire
```

#### Scénario 2.1.3 : User change email, puis delete
```
1. User email "alice@acme.fr"
2. User change email → "alice.new@acme.fr" (isEmailVerified=false pour EMPLOYEE)
3. Admin delete user
4. User.email = "deleted-{uuid}@anonymized.local"
5. Ancien email "alice@acme.fr" disponible immédiatement (partial unique index)
6. Nouveau email "alice.new@acme.fr" aussi disponible

Résultat : Emails orphelins ; aucun problème (partial index sur deletedAt)
```

### 2.2 User Role Changes (MANAGER ↔ EMPLOYEE)

**Route** : `PATCH /api/admin/users/:id` (admin only)

**Logique** (admin.service.ts:206-255):
```typescript
updateUser(id, { role }):
  if (losesAdmin):
    - Count ADMIN roles
    - if count <= 1: throw LAST_ADMIN
  if (role !== currentRole):
    - updateMany(role)
    - Revoke refresh tokens (force re-login)
```

#### Scénario 2.2.1 : Manager → Employee
```
1. Manager a allocation: {managerId: mgr1, status: A_DISTRIBUER, amount: 10}
2. Admin change role: MANAGER → EMPLOYEE
3. User.role = EMPLOYEE, refresh tokens revoked
4. Allocation toujours managerId = mgr1
5. Enveloppe "orpheline" : aucun manager ne la revendique

Résultat :
  - Enveloppe A_DISTRIBUER bloquée indéfiniment
  - Tokens = 10 gérés nulle part
  - Front affiche le ex-manager en "Manager ayant reçu une enveloppe" avec role=EMPLOYEE

Attendu :
  OPTION A (Strict) : Empêcher demotion si manager a envelopes A_DISTRIBUER
    - Throw: "Manager a des enveloppes non distribuées"
  OPTION B (Permissive) : Auto-cancel envelopes + refund pool
    - if (manager.allocations.status=A_DISTRIBUER): 
        refund pool with envelope.amount
        mark allocation.status=CANCELLED
  OPTION C (Current) : Allow, accepter les envelopes orphelines
    - Exige un job/cleanup mensuel
```

#### Scénario 2.2.2 : Employee → Manager
```
1. Employee a balance = 5 (tokens personnels, pas d'enveloppe)
2. Admin promote: EMPLOYEE → MANAGER
3. User.role = MANAGER, refresh token revoked
4. Allocation créée pour ce manager : {amount: 20, managerId: xxx}
5. Manager a 2 balances maintenant :
   - personal = 5
   - envelope = 20

Résultat : Fonctionne correctement
Attendu : ✅ OK
```

#### Scénario 2.2.3 : Last ADMIN demotion guard
```
1. Seul 1 ADMIN dans la DB
2. Admin essaie de changer un autre admin de rôle
   → Passe (ce n'est pas _cet_ admin)
3. Admin essaie de changer SON propre rôle
   → Bloqué (LAST_ADMIN guard, count=1)

Résultat : Guard fonctionne correctement pour auto-demotion
Attendu : ✅ OK
```

### 2.3 User Password Reset & Sessions

**Logique** (auth.service.ts:268-295):
```typescript
resetPassword(token, newPassword):
  Atomique :
    - Marque token.usedAt = now()
    - Change user.passwordHash
    - Revoke ALL refresh tokens (logout everywhere)
```

**Problème 2.3.1 : Concurrent resets**
```
Deux POST /api/auth/reset-password avec le MÊME token :
  - Tx1 consomme token (UPDATE ... WHERE usedAt=null)
  - Tx2 consomme token (UPDATE ... WHERE usedAt=null)
  - Une seule gagne (count=1)
  - L'autre voit count=0, lance INVALID_TOKEN

Résultat : Atomique, correct ✅
```

**Scénario 2.3.2 : Password reset ne révoque pas les codes d'invite**
```
1. Manager a généré 5 codes invites
2. Manager oublie son password et reset via lien email
3. Manager.passwordHash changé, sessions révoquées
4. BUT : Tous les codes invites restent valides

Résultat :
  - Manager peut se re-connecter
  - Ses codes restent valides
  - Pas d'exposition (les codes sont déjà "in the wild")

Attendu : ✅ OK (pas d'action nécessaire)
```

---

## 3. ALLOCATION LIFECYCLE (Envelopes)

### 3.1 Modèle d'état

```prisma
enum AllocationStatus { A_DISTRIBUER, DISTRIBUEE }
model Allocation {
  status AllocationStatus @default(A_DISTRIBUER)
  amount Int // Envelope total
  mode RetributionMode // PART_EGALE, POURCENTAGE, AUCUNE
  retributionAmount Int @default(0) // R (part manager)
  distributedAt DateTime? // When moved to DISTRIBUEE
}
```

### 3.2 Transitions

#### A_DISTRIBUER (créée)
```
- Owner alloue tokens via POST /api/attributions/allocate
- Pool débité du montant
- Allocation.status = A_DISTRIBUER
- Allocation.retributionAmount = 0 (pas encore figé)
```

**Scénario 3.2.1 : Allocation d'un manager deleted**
```
1. Manager mgr1 existe, reçoit allocation {amount: 10, status: A_DISTRIBUER}
2. Owner alloue à mgr1
3. Admin delete mgr1 (soft-delete)
4. Allocation.managerId toujours = mgr1 (deleted)
5. Manager ne peut pas se connecter ni distribuer

Résultat :
  - Tokens de l'enveloppe bloqués indéfiniment
  - Pool n'est pas remboursée
  - Aucun job de cleanup

Attendu :
  OPTION A : Lors de soft-delete, réaffecter A_DISTRIBUER envelopes au prochain manager
  OPTION B : Lors de soft-delete, refund l'enveloppe à la pool et mark allocation.status=CANCELLED
  OPTION C : Ignorer et exiger un admin cleanup manuel
```

#### DISTRIBUEE (locked)
```
- Manager distribue via POST /api/attributions/distribute
- Atomique :
  1. Recalcule R (retribution) basé sur team size actuelle
  2. Crédite manager.balance += R
  3. Crédite chaque employee.balance += amount
  4. Crée Attribution rows (one per employee)
  5. Mark allocation.status = DISTRIBUEE, retributionAmount = R, distributedAt = now()
```

**Scénario 3.2.2 : Distribution avec emploi supprimé entre alloc et dist**
```
1. Allocation créée avec 10 employees
2. Owner alloue 20 tokens (mode=PART_EGALE) : R = 20/(10+1) = 1.8 ≈ 1 token
3. 2 employees supprimés (deleted)
4. Manager valide distribution avec 8 employees
5. Team size utilisé lors de distribution = 8 (line 141-143)
6. R recalculé = 20/(8+1) = 2.2 ≈ 2 tokens

Résultat : R a augmenté (2 > 1) entre allocation et distribution
Attendu : Comportement attendu (team size change = nouveau calcul)
```

**Scénario 3.2.3 : Re-distribution bloquée**
```
1. Allocation distribuée (status=DISTRIBUEE)
2. Manager essaie de redistribuer avec des lignes différentes
3. Check: if (alloc.status !== A_DISTRIBUER): throw ALLOCATION_ALREADY_DISTRIBUTED

Résultat : ✅ Atomique, protégé
```

**Scénario 3.2.4 : Distribution avec motif inactif**
```
1. Allocation créée
2. Manager distribue avec motifId=X (active=true)
3. Entre création et distribution, admin désactive motif X
4. Lors de distribution, validMotifs.count check (active=true)
5. Motif inactif = MOTIF_INVALID, distribution échoue

Résultat : ✅ OK (validation pointwise)
```

### 3.3 Allocation orphelines

**Scénario : Enveloppe A_DISTRIBUER jamais distribuée**
```
1. Allocation créée en jan 2026
2. Manager change de poste en fev 2026 (devient employee)
3. Enveloppe reste A_DISTRIBUER
4. En juillet 2026, toujours à_distribuer

Résultat : Tokens bloqués, aucun autorefund
Attendu : Ajouter un job de cleanup (par ex. 90j) ou documenter la procédure manuelle
```

---

## 4. OFFER & PROMO CODE LIFECYCLE

### 4.1 Offer status

```prisma
model PartnerOffer {
  isActive Boolean @default(true)
  promoCodes PromoCode[] // One-to-many
}

enum PromoCodeStatus { // implicit
  AVAILABLE (isUsed: false)
  USED (isUsed: true)
}
```

#### ACTIVE (isActive=true)
- ✅ Affiché sur le storefront
- ✅ Employees peuvent redemner (redeemOffer)
- ✅ Admin peut ajouter/supprimer codes

#### INACTIVE (isActive=false)
- ❌ Pas affiché sur le storefront (listActiveOffers filter)
- ❌ redeemOffer lance OFFER_NOT_FOUND (offer.service.ts:12 filter)
- ✅ Codes existants restent valides (Redemption n'est pas révoquée)

**Scénario 4.1.1 : Offer ACTIVE → INACTIVE avec codes en circulation**
```
1. Offer "Netflix 3 mois" (cost=15, isActive=true)
2. Admin désactive l'offre (isActive=false)
3. 10 codes réservés par employees (isUsed=true, Redemption créé)
4. 5 codes restants non utilisés

Résultat :
  - Employees qui ont réservé : leur redemption.used=false (attendent de passer au marchand)
  - Nouveaux employees : ne peuvent pas redemner (offer invisible + OFFER_NOT_FOUND guard)
  - Codes réservés : restent valides pour les employees qui les ont

Attendu : ✅ Correct (no revocation needed)
```

**Scénario 4.1.2 : Offer ACTIVE → INACTIVE, puis re-ACTIVE**
```
1. Offer temporairement désactivé pour maintenance
2. Admin reactive (isActive=true)
3. Anciens codes + nouveaux codes = stock disponible

Résultat : ✅ OK (pas de soft-delete, juste flag)
```

### 4.2 Promo Code lifecycle

**Modèle** :
```prisma
model PromoCode {
  code String @unique
  isUsed Boolean @default(false)
  usedAt DateTime?
  offerId String
  redemption Redemption? // One-to-one
}
```

#### AVAILABLE (isUsed=false)
- ✅ Peut être réservé par redemption (redeemOffer)
- ✅ Peut être supprimé (deletePromoCode: guarded on isUsed=false)
- ✅ Admin peut l'ajouter à l'offre

#### USED (isUsed=true)
- ❌ Impossible de le réserver à nouveau
- ❌ Impossible de le supprimer (deletePromoCode check line 30: if count=0, throw CODE_USED)
- ✅ Garde trace du quelle employee a reçu le code
- ✅ Can be toggled "used at merchant" (Redemption.used boolean)

**Scénario 4.2.1 : Concurrent redemption de la last code**
```
1. Offer a 1 code disponible (isUsed=false)
2. Employee A et B POST /api/employees/me/redeem simultanément
3. Tx A : UPDATE promoCode SET isUsed=true WHERE id=code1, isUsed=false
4. Tx B : idem
5. Une seule gagne (count=1), l'autre voit count=0 et retry avec next code
6. Si plus de codes : OUT_OF_STOCK

Résultat : ✅ Atomic, race condition handled via retry loop (5 attempts max)
```

**Scénario 4.2.2 : PromoCode déjà utilisé, employee essaie de "unreserve"**
```
1. Code "NETFLIX-001" réservé (isUsed=true, usedAt=2025-07-20)
2. Employee n'arrive pas à l'utiliser au marchand (oublie)
3. Quelques jours plus tard, employee essaie de redemner à nouveau
4. Impossible : déjà isUsed=true

Résultat :
  - Employee doit redemner une autre offre
  - Pas de "return/unreserve" mechanism
  - Code reste gelé

Attendu : OK (design accepté)
```

**Scénario 4.2.3 : Supprimer un code qui vient d'être réservé**
```
1. Admin lance deletePromoCode(codeId)
2. Simultanément, employee reserve le code
3. Tx Admin : DELETE promoCode WHERE id=codeId, isUsed=false
4. Tx Employee : UPDATE promoCode SET isUsed=true WHERE id=codeId, isUsed=false
5. Une seule gagne

Cas A : Admin gagne → code supprimé, employee voit OUT_OF_STOCK ou code unavailable
Cas B : Employee gagne → code réservé, admin DELETE échoue (count=0), lance CODE_USED

Résultat : Race condition possible, mais handled via guards ✅
```

---

## 5. REDEMPTION & PROMO CODE EXCHANGE

### 5.1 Redemption model

```prisma
model Redemption {
  id String @id
  amount Int // Snapshot du cost au moment du redemption
  employeeId String
  offerId String
  promoCodeId String @unique // One-to-one
  companyId String
  used Boolean @default(false) // Toggled manually by employee at merchant
  createdAt DateTime
}
```

### 5.2 Atomicity: Offer reservation

**Service** : redemption.service.ts::redeemOffer

```typescript
for (let attempt = 0; attempt < 5; attempt++) {
  candidate = SELECT promoCode WHERE offerId=X, isUsed=false LIMIT 1
  if (!candidate) throw OUT_OF_STOCK
  
  tx {
    // Reserve code
    claim = UPDATE promoCode SET isUsed=true WHERE id=candidate, isUsed=false
    if (claim.count === 0) throw CODE_TAKEN (retry)
    
    // Debit balance
    debit = UPDATE user SET balance -= amount WHERE id=empId, balance >= amount
    if (debit.count === 0) throw INSUFFICIENT_BALANCE
    
    // Record redemption
    CREATE redemption(empId, offerId, codeId, amount)
  }
}
```

**Scénario 5.2.1 : Redemption fails mid-tx (balance debit fails)**
```
1. Employee a 10 tokens
2. Employee redeem Offer (cost=15)
3. Code réservé atomiquement (isUsed=true)
4. Debit échoue: balance check (10 < 15)
5. Tx rollback

Résultat : Code back to isUsed=false (atomic rollback) ✅
```

**Scénario 5.2.2 : Redemption succeeds, checkout fails later**
```
1. Redemption crée (balance débité, code réservé)
2. Frontend essaie de payer via Stripe
3. Stripe returns error
4. Employee n'a pas payé, mais son balance est débité et code réservé

Résultat :
  - Employee.balance = 10-15 = -5 (IMPOSSIBLE: CHECK >= 0)
  - Attendu : balance -= debit guarded on balance >= cost (line 37)
  - Si debit fails, Redemption n'est pas créé
  - Checkout failure = frontend problem, pas backend

Attendu : ✅ OK (pas de paiement Prim'O dans ce flow)
```

**Scénario 5.2.3 : Concurrent redemptions, insufficient balance**
```
1. Employee a 20 tokens
2. 2 offers, chacun coûte 15
3. 2 concurrent POST /me/redeem
4. Tx A : code1 reserved, balance 20 >= 15 ✅, debit → balance=5, redemption A created
5. Tx B : code2 reserved, balance 5 < 15 ❌, INSUFFICIENT_BALANCE (rollback, code freed)

Résultat : Une seule rédemption réussit, l'autre échoue proprement ✅
```

---

## 6. ATTRIBUTION & TOKEN ALLOCATION

### 6.1 Direct attribution (OWNER → EMPLOYEE)

**Service** : attribution.service.ts::createAttribution

```typescript
Atomic:
  UPDATE company SET tokenBalance -= amount WHERE tokenBalance >= amount
  if (count === 0) throw INSUFFICIENT_POOL
  
  UPDATE user SET balance += amount WHERE id=empId
  
  CREATE attribution(empId, amount, motifId, managerId=attributorId, ...)
```

**Scénario 6.1.1 : Attribution avec motif inactif**
```
1. Attribution POST avec motifId=X (active=true)
2. Entre schéma parse et service call, motif désactivé
3. DB INSERT attribution(motifId=X) réussit (pas de FK constraint sur motif.active)

Résultat :
  - Attribution créé avec motif inactif
  - Affichage frontend : motif?.label ?? '' (line 292)
  - Attestation sauvegardée mais motif ≠ visible aux futurs filtres

Attendu :
  OPTION A : Add FK constraint ou CHECK sur motif.active
  OPTION B : Ignore (données historiques, motif peut être désactivé)
  OPTION C : Current (acceptance implique)
```

**Scénario 6.1.2 : Attribution avec employee deleted**
```
1. CREATE attribution avec employeeId=emp1
2. Service validé emp1 (role=EMPLOYEE, deletedAt=null)
3. Entre validation et INSERT, admin delete emp1
4. INSERT réussit (pas de race condition guard)
5. Employee.balance incrémentée pour un user deleted

Résultat :
  - Attribution créé pour employee deleted
  - User.balance = 10 (tokens orphelins)
  - User.deletedAt != null

Attendu : Atomic guard dans la transaction
```

### 6.2 Allocation-based distribution (OWNER → MANAGER → EMPLOYEES)

**Flow**:
```
1. Owner: allocateToManager(manager, amount, mode, percentage)
   - Debit pool
   - Create Allocation(status=A_DISTRIBUER, retributionAmount=0)

2. Manager: distributeEnvelope(allocationId, lines)
   - Recalculate R based on current team size
   - Verify total = amount - R
   - Credit manager.balance += R
   - Credit each employee.balance += line.amount
   - Create Attributions (one per employee)
   - Update Allocation(status=DISTRIBUEE, retributionAmount=R, distributedAt)
```

**Scénario 6.2.1 : Distribution avec employee inactif ajouté post-allocation**
```
1. Allocation crée (10 employees, 20 tokens, mode=PART_EGALE)
2. New employee rejoint la company
3. Manager distribue : team size = 11
4. Manager essaie de distribuer à l'ancien employee + nouveau
5. validateEmployees check : NEW employee doit être dans les lines

Résultat :
  - Si manager oublie de mettre nouveau employee : distribution réussit
  - Nouveau employee n'a pas ses tokens (budget exact)
  - Ancien employee peut l'avoir reçu

Attendu : Pas d'auto-ajustement ; manager doit inclure les lignes explicitement ✅
```

**Scénario 6.2.2 : Distribution avec employee qui vient de changer de rôle**
```
1. Allocation crée (manager=mgr1, team=10)
2. Admin change employee→manager (promote)
3. Employee disparaît de la team (now manager)
4. Manager distribue, team size = 9
5. Distribution lines incluent l'ex-employee (maintenant manager)

Service check :
  validEmployees = COUNT(users WHERE id IN ids, role=EMPLOYEE, deletedAt=null)
  → ex-employee a role=MANAGER maintenant
  → Count < expected
  → EMPLOYEE_INVALID

Résultat : Distribution bloquée ✅
```

**Scénario 6.2.3 : Distribution avec motif inactif**
```
1. Allocation créée avec motifs actifs
2. Admin désactive un motif
3. Manager distribute avec ligne: employeeId=X, motifId=inactif
4. Service check: validMotifs = COUNT(motifs WHERE id IN ids, active=true)
5. Motif inactif count < expected
6. MOTIF_INVALID

Résultat : Distribution bloquée ✅
```

---

## 7. TOKEN BALANCE CONSTRAINTS

### 7.1 User.balance

```prisma
model User {
  balance Int @default(0)
  // CHECK: balance >= 0 (SQL constraint)
}
```

**Gardes** :
- ✅ Attribution : UPDATE user SET balance += amount (increment, toujours +)
- ✅ Redemption : UPDATE user SET balance -= cost WHERE balance >= cost (guarded debit)
- ✅ Allocation distribution : UPDATE user SET balance += amount (increment)

**Scénario 7.1.1 : Bypass negative balance via direct SQL**
```
UPDATE "User" SET balance = -100 WHERE id = 'X'
→ Violates CHECK constraint → 400-level error

Résultat : ✅ DB-level protection
```

**Scénario 7.1.2 : Balance overflow (INT MAX)**
```
User.balance = INT.MAX (2^31 - 1 = 2147483647)
Attribution: amount = 1
UPDATE balance += 1 → overflow (2147483648)

Résultat :
  - PostgreSQL INT overflow : error or wraparound (database-specific)
  - Prim'O Zod schema limits amount (see attribution.schemas.ts)

Attendu : Vérifier les limites de Zod
```

### 7.2 Company.tokenBalance

```prisma
model Company {
  tokenBalance Int @default(0)
  // CHECK: tokenBalance >= 0 (SQL constraint)
}
```

**Gardes** :
- ✅ Purchase (Stripe): UPDATE company SET tokenBalance += amount (after payment success)
- ✅ Allocation: UPDATE company SET tokenBalance -= amount WHERE tokenBalance >= amount
- ✅ Attribution: UPDATE company SET tokenBalance -= amount WHERE tokenBalance >= amount

**Scénario 7.2.1 : Concurrent allocation requests**
```
1. Company tokenBalance = 100
2. Owner allocates 60 to manager A (A: tx1)
3. Owner allocates 60 to manager B (B: tx2)
4. Tx1: UPDATE WHERE tokenBalance >= 60 ✅ (100 >= 60) → balance = 40
5. Tx2: UPDATE WHERE tokenBalance >= 60 ❌ (40 >= 60) → rollback → INSUFFICIENT_POOL

Résultat : ✅ One succeeds, other fails (guarded debit)
```

**Scénario 7.2.2 : Stripe webhook retry (idempotent)**
```
1. Payment succeeds, webhook processes
2. fulfillCheckout(session):
   - CREATE CompanyTokenPurchase(stripeSessionId=cs_123, companyId=X, amount=50)
   - UPDATE company SET tokenBalance += 50
3. Webhook replayed (network issue)
4. Stripe resends same event
5. CREATE fails: stripeSessionId @unique violation (P2002)
6. Service catches P2002 → return silently

Résultat : ✅ Idempotent (no duplicate credit)
```

---

## 8. INVITE CODES & COMPANY MEMBERSHIP

### 8.1 Invite code lifecycle

```prisma
model CompanyInviteCode {
  code String @unique
  expiresAt DateTime
  maxUses Int
  usedCount Int @default(0)
  revokedAt DateTime?
  role Role // EMPLOYEE or MANAGER
}
```

**Validity check** :
```typescript
// auth.service.ts:98-99 (joinCompany)
UPDATE CompanyInviteCode
SET usedCount = usedCount + 1
WHERE code = X
  AND revokedAt IS NULL
  AND expiresAt > now()
  AND usedCount < maxUses
RETURNING companyId, role
```

**Scénario 8.1.1 : Expired code**
```
1. Code créé avec expiresAt = now() + 24h
2. 25 hours later, someone tries to use it
3. UPDATE condition fails (expiresAt <= now())
4. No rows updated, INVALID_CODE

Résultat : ✅ OK
```

**Scénario 8.1.2 : Code revoked between generation and use**
```
1. Manager generates code for employee (24h expiry)
2. Admin revokes the code (revokedAt = now())
3. Employee tries to join
4. UPDATE condition fails (revokedAt != null)
5. INVALID_CODE

Résultat : ✅ OK
```

**Scénario 8.1.3 : Code at max uses**
```
1. Code generated with maxUses=5
2. 5 people join (usedCount=5)
3. 6th person tries to join
4. UPDATE condition fails (usedCount >= maxUses)
5. INVALID_CODE

Résultat : ✅ OK
```

**Scénario 8.1.4 : Code from REJECTED company**
```
1. Company PENDING, code generated (still checks status=APPROVED in generateInviteCode)
2. Admin rejects company (status=REJECTED)
3. Code not revoked (no cascade in setCompanyStatus)
4. Person uses code

Issue (from §1) :
  - joinCompany doesn't check company.status
  - User gets added to REJECTED company

Résultat : ❌ Bug, see Problem 1.2
```

### 8.2 joinCompany atomicity

```typescript
tx {
  rows = UPDATE CompanyInviteCode SET usedCount++ 
    WHERE code, revokedAt IS NULL, expiresAt > now(), usedCount < maxUses
    RETURNING companyId, role
  
  if (!rows[0]) throw INVALID_CODE
  
  UPDATE user SET role, companyId FROM rows[0]
}
```

**Scénario 8.2.1 : Race: code becomes invalid between validation and claim**
```
1. Manager checks code validity (returns true)
2. Between check and joinCompany POST, code revoked
3. joinCompany: UPDATE fails (count=0)
4. INVALID_CODE

Résultat : ✅ Atomic (no race exposure)
```

---

## 9. CROSS-CUTTING CONCERNS

### 9.1 Company-wide deletion cascade

**admin.service.ts::softDeleteCompany**:
```typescript
tx {
  // Collect affected users
  users = SELECT WHERE companyId, deletedAt=null
  userIds = users.map(u => u.id)
  
  // Soft-mark users
  UPDATE users SET deletedAt = now()
  
  // Revoke sessions
  UPDATE refreshTokens SET isRevoked=true WHERE userId IN userIds
  
  // Revoke invites
  UPDATE inviteCodes SET revokedAt = now() WHERE companyId
  
  // Soft-delete company
  UPDATE company SET deletedAt = now()
}
```

**Preserved (for audit)** :
- Attribution (ledger)
- Redemption (ledger)
- CompanyTokenPurchase (ledger)
- Allocation (envelope records)

**Scénario 9.1.1 : Soft-delete with pending allocations**
```
1. Company has Allocations(status=A_DISTRIBUER) from various managers
2. admin.softDeleteCompany(companyId)
3. Company.deletedAt set, but Allocations remain
4. Managers deleted, but their allocations stay in DB
5. Tokens = lost

Résultat :
  - Allocations become orphaned
  - No automatic refund to pool
  - Audit trail preserved (by design)

Attendu : Acceptable ; admin should check for pending allocations before deletion
```

### 9.2 Refresh token rotation & theft detection

**auth.service.ts::refreshTokens**:
```typescript
stored = SELECT refreshToken WHERE tokenHash
if (!stored) throw INVALID_REFRESH

if (stored.isRevoked):
  // Theft detected
  REVOKE ALL user sessions
  throw INVALID_REFRESH

if (stored.expiresAt < now()) throw INVALID_REFRESH

user = SELECT WHERE id = stored.userId
if (!user || user.deletedAt) throw INVALID_REFRESH

// Atomic rotation
tx {
  newToken = CREATE refreshToken(...)
  UPDATE refreshToken SET isRevoked=true WHERE id=stored.id, isRevoked=false
  if (updateResult.count === 0) throw INVALID_REFRESH // Concurrent refresh
}
```

**Scénario 9.2.1 : Token reuse (theft detection)**
```
1. Attacker steals refreshToken (raw value)
2. Attacker: POST /api/auth/refresh with token
   - Token found, not revoked
   - New token issued, old token marked revoked
3. Legitimate user: POST /api/auth/refresh with same token
   - Token found, isRevoked=true
   - REVOKE ALL user's sessions (theft marker)
   - Throw INVALID_REFRESH

Résultat : ✅ Threat mitigated (all user sessions killed)
```

**Scénario 9.2.2 : Deleted user tries to refresh**
```
1. User deleted (deletedAt != null)
2. User has valid refresh token (created before deletion)
3. User: POST /api/auth/refresh
4. Service: SELECT user WHERE deletedAt IS NOT NULL
5. Condition fails (user exists but deleted)
6. INVALID_REFRESH

Résultat : ✅ OK (deleted user can't refresh)
```

---

## 10. SUMMARY TABLE: EDGE CASES & VERDICTS

| Edge Case | Current Behavior | Verdict | Recommendation |
|-----------|-----------------|---------|-----------------|
| **1.1** Join company PENDING → REJECTED | No status check in joinCompany | ❌ BUG | Add company.status === APPROVED guard |
| **1.2** Invite code for REJECTED company | Codes not revoked on status change | ⚠️ LOGICAL GAP | Auto-revoke invites on setCompanyStatus(REJECTED) |
| **1.3** Manager deleted with A_DISTRIBUER envelope | Envelope orphaned, tokens lost | ⚠️ DATA LOSS | Option: Auto-refund or mark CANCELLED on soft-delete |
| **2.2.1** Manager→Employee demotion with A_DISTRIBUER | Envelope orphaned | ⚠️ DATA LOSS | Guard against demotion OR auto-handle envelopes |
| **3.2.1** Attribution with deleted employee | Possible race condition | ⚠️ RACE | Add FK or atomic guard in transaction |
| **4.1.1** Offer ACTIVE→INACTIVE with issued codes | Codes remain valid for recipients | ✅ OK | Design intent (no revocation) |
| **5.2.2** Concurrent redemptions + insufficient balance | Handled via guarded UPDATE | ✅ OK | Behavior is correct |
| **6.2.1** Distribution with inactive motif | Caught by validation | ✅ OK | Pointwise validation sufficient |
| **7.1.1** Negative balance via direct SQL | Blocked by CHECK constraint | ✅ OK | DB-level protection |
| **7.2.1** Concurrent allocation (insufficient pool) | Only one succeeds | ✅ OK | Guarded UPDATE + atomic check |
| **7.2.2** Stripe webhook replay | Idempotent via @unique stripeSessionId | ✅ OK | No duplicate credit |
| **8.1.4** Invite code from REJECTED company | Code remains usable | ❌ BUG | Related to Problem 1.2 |
| **9.1.1** Company soft-delete with pending A_DISTRIBUER | Allocations orphaned | ⚠️ DATA LOSS | Document cleanup procedure or auto-refund |
| **10.1** Admin self-demotion guard | Blocks if last ADMIN | ✅ OK | Last-admin protection |
| **10.2** Role change revokes sessions | All refresh tokens killed | ✅ OK | Forces re-login with new role |

---

## 11. CRITICAL FINDINGS & RECOMMENDATIONS

### 🔴 CRITICAL (Must fix)

#### Finding 1.1: joinCompany missing status check
```
File: backend/src/services/auth.service.ts::joinCompany (line 87-112)
Problem: No validation that company.status === APPROVED
Impact: User can join REJECTED company
Severity: CRITICAL (data consistency)

Fix:
  After line 100, before UPDATE user:
  const company = await tx.company.findUnique({
    where: { id: rows[0].companyId },
    select: { status: true }
  });
  if (company.status !== 'APPROVED') throw new DomainError(..., 'COMPANY_INACTIVE');
```

#### Finding 1.2: Invite codes not revoked on company status change
```
File: backend/src/services/admin.service.ts::setCompanyStatus (line 75-86)
Problem: setCompanyStatus does not revoke invite codes
Impact: Users can join REJECTED company via lingering invite codes
Severity: CRITICAL (data consistency)

Fix:
  Add to setCompanyStatus transaction:
  if (status === 'REJECTED') {
    await tx.companyInviteCode.updateMany({
      where: { companyId, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
```

### 🟠 HIGH (Should fix soon)

#### Finding 3.1: A_DISTRIBUER allocations orphaned on manager deletion
```
File: Multiple (admin.service.ts::softDeleteUser, attribution.service.ts)
Problem: When manager soft-deleted, A_DISTRIBUER allocations remain in DB, tokens inaccessible
Impact: Token pool leaks; no automatic recovery
Severity: HIGH (financial impact, no compensation mechanism)

Options:
A) Auto-refund on deletion:
   softDeleteUser():
     allocations = SELECT WHERE managerId, status=A_DISTRIBUER
     for each allocation:
       company.tokenBalance += allocation.amount
       allocation.status = CANCELLED

B) Block demotion/deletion if pending:
   softDeleteUser():
     pending = COUNT(allocations WHERE managerId, status=A_DISTRIBUER)
     if (pending > 0) throw 'PENDING_ALLOCATIONS'

Recommendation: Option A (auto-refund)
```

#### Finding 6.2.3: Attribution with inactiveMotif
```
File: backend/src/services/attribution.service.ts::distributeEnvelope (line 164-165)
Problem: validates motif.active=true at distribution, but no check at allocation creation
Impact: Distribution may fail if motif deactivated between alloc and dist
Severity: MEDIUM (temporal inconsistency, not data loss)

Fix:
  distributeEnvelope should return more explicit error message
  OR pre-check motif status when the envelope is created
```

### 🟡 MEDIUM (Nice to have)

#### Finding 2.2: Manager→Employee demotion with allocations
```
File: backend/src/services/admin.service.ts::updateUser (line 206-255)
Problem: Allows demotion even if manager has A_DISTRIBUER envelopes
Impact: Envelopes become orphaned, but less severe than soft-delete
Recommendation: Guard against demotion OR auto-handle (Option A from Finding 3.1)
```

#### Finding 9.1.1: Data loss on company soft-delete with pending allocations
```
File: backend/src/services/admin.service.ts::softDeleteCompany
Problem: Allocations not handled, tokens lost
Recommendation: Implement refund logic (same as Finding 3.1)
```

#### Finding 7.1: INT overflow on balance
```
File: backend/src/schemas/attribution.schemas.ts, etc.
Problem: No explicit limit on amount in Zod schemas
Impact: Theoretical overflow risk
Recommendation: Add max bounds (e.g., max: 1000000 tokens)
```

---

## 12. COMPLIANCE & TESTING NOTES

### GDPR Compliance
- ✅ User anonymization on deletion (privacy.service.ts)
- ✅ Ledger preserved for audit (Attribution, Redemption, Purchase)
- ✅ Email unique only among non-deleted (partial unique index)
- ✅ Data export (exportUserData)

### Testing Gaps
- ❌ No integration test for joinCompany with REJECTED company
- ❌ No test for setCompanyStatus(REJECTED) → invite code revocation
- ❌ No test for manager soft-delete with A_DISTRIBUER envelopes
- ❌ No test for concurrent allocation + insufficient pool race
- ⚠️ Stripe webhook replay tested implicitly via P2002 handling

### Recommended Test Additions
1. `auth.test.ts`: Add "join company REJECTED → 403"
2. `admin.test.ts`: Add "setCompanyStatus REJECTED → invite codes revoked"
3. `allocation.test.ts` (new): Add "manager deleted with A_DISTRIBUER → tokens refunded"
4. `allocation.test.ts`: Add concurrent allocation race condition test
5. `redemption.test.ts`: Add concurrent redemption + insufficient balance race test

---

## APPENDIX: Key Files Reference

| File | Purpose |
|------|---------|
| `schema.prisma` | Data model + enums |
| `auth.service.ts` | User registration, company join, session management |
| `attribution.service.ts` | Token allocation, envelopes, distribution |
| `redemption.service.ts` | Offer redemption, promo code reservation |
| `admin.service.ts` | Company/user management, company deletion |
| `privacy.service.ts` | User anonymization, account deletion |
| `stripe.service.ts` | Checkout session creation |
| `stripeWebhook.service.ts` | Payment fulfillment (idempotent) |
| `offer.service.ts` | Offer CRUD, offer listing |
| `promoCode.service.ts` | Promo code management |
| `invite.service.ts` | Invite code generation |

---

**Audit completed: 2026-07-21**
**Audited by: Claude (Haiku 4.5)**
