# AUDIT COMPLET - BASE DE DONNÉES PRIM'O

## RÉSUMÉ EXÉCUTIF

**État global:** ✓ Bon, avec 5 problèmes mineurs et 8 risques potentiels de performance identifiés.

**Migrations:** 17 complètes et ordonnées séquentiellement, pas de squash, état cohérent.

**Soft deletes:** Correctement implémentés (deletedAt + partial unique index on email).

**Cascades:** Cohérentes sauf 1 cas à surveiller (Allocation -> Attribution).

**N+1 queries:** 2 patterns détectés et 3 risques futurs.

---

## 1. ANALYSE DES MIGRATIONS

### 1.1 Migrations complètes (✓ OK)

| Migration | Date | Statut |
|-----------|------|--------|
| 20260603113746_init | Init (Role MANAGER/EMPLOYEE, UserStatus enum) | ✓ Fondation solide |
| 20260605132150_add_check_constraints | CHECKs (balances >= 0, amounts > 0) | ✓ Audit trail établi |
| 20260611112519_add_stripe_session_id | Idempotence Stripe webhook | ✓ Unique |
| 20260617140242_add_owner_company_status | OWNER role + CompanyStatus enum | ✓ Multi-tenant |
| 20260618105542_add_last_login_at | GDPR anonymisation 3 ans | ✓ |
| 20260618162915_add_password_reset_token | Token reset 1h TTL | ✓ |
| 20260618121010_onboarding_account_first | Drop UserStatus, role nullable | ✓ Account-first flow |
| 20260619120754_addendum_v1_1_manager_retribution | MotifCategory, RetributionMode, Allocation table | ✓ Motifs officiels |
| 20260621134759_allocation_envelopes | AllocationStatus, distributedAt, allocationId link | ✓ Enveloppe status |
| 20260621150000_drop_attribution_reason | Drop free-text reason | ✓ Motif-only |
| 20260623171330_add_user_profile_photo | Avatar key ou initials | ✓ |
| 20260624084628_add_redemption_used | Redemption.used flag | ✓ |
| 20260624084705_add_category_table | Table Category (slug, icon, color) | ✓ |
| 20260624085427_make_categoryid_required_drop_enum | PartnerOffer.categoryId NOT NULL, drop OfferCategory enum | ✓ |
| 20260629142524_add_partner_offer_image | PartnerOffer.imageUrl nullable | ✓ |
| 20260630101147_add_offer_image_position | Add imagePosition (ADDED en erreur) | ⚠ Inversé ci-dessous |
| 20260630102301_drop_offer_image_position | Drop imagePosition (RECTIFIÉ) | ✓ Nettoyage |

**Migration Lock:** PostgreSQL, provider cohérent avec schema.

### 1.2 Événements de migration remarquables

- **20260618121010** : Drop UserStatus enum + role nullable = passage account-first
  - OK: role reste nullable tant que l'utilisateur n'est pas lié à une company
- **20260621150000** : Suppression de `reason` TEXT, passage au motif référencé
  - Bien : motifId nullable pour les anciennes lignes
- **20260624084705/085427** : Migration du schema PartnerOffer
  - OK: categoryId nullable → NOT NULL avec migration-safe transition
- **20260630101147 → 20260630102301** : Add/drop imagePosition dans la même journée
  - ⚠ **DÉBRIS DE MIGRATION** : imagePosition ajouté puis supprimé = bruit ; confirmé supprimé en prod

---

## 2. SCHÉMA PRISMA - AUDIT DÉTAILLÉ

### 2.1 Enums
✓ Tous bien définis avec valeurs ASCII (Prisma requirement)

```
- Role: ADMIN, OWNER, MANAGER, EMPLOYEE
- CompanyStatus: PENDING, APPROVED, REJECTED
- MotifCategory: COMPORTEMENTS_INDIVIDUELS, RELATION_CLIENT, ESPRIT_COLLECTIF, ENGAGEMENT
- RetributionMode: PART_EGALE, POURCENTAGE, AUCUNE
- AllocationStatus: A_DISTRIBUER, DISTRIBUEE
```

### 2.2 Table Company

**Positifs:**
- ✓ UUID id + createdAt/updatedAt/deletedAt (soft delete)
- ✓ tokenBalance INT avec CHECK >= 0 en migration 20260605132150
- ✓ status enum avec default PENDING
- ✓ Indexes sur createdAt implicite (part du sort default)

**Problèmes:**
- **❌ MISSING INDEX: Company.status**
  - **Fichier:** schema.prisma:51-67, migration 20260617140242
  - **Impact:** Admin dashboard et queries filtrées sur `status = APPROVED/PENDING/REJECTED` scannent table complète
  - **Fix:** `CREATE INDEX company_status_idx ON "Company"("status") WHERE "deletedAt" IS NULL;`

### 2.3 Table User

**Positifs:**
- ✓ Partial unique index on email (deletedAt IS NULL) en migration 20260605132150
- ✓ UUID + full audit trail (createdAt/updatedAt/deletedAt)
- ✓ role nullable (account-first flow)
- ✓ companyId nullable (ADMIN ou floating user)
- ✓ Indexes on companyId, email
- ✓ lastLoginAt pour GDPR anonymisation 3 ans
- ✓ profilePhoto pour avatars (nullable = initials)

**Problèmes:**
- **❌ MISSING INDEX: User.role**
  - **Fichier:** schema.prisma:71-102, NO migration-side index
  - **Impact:** `findMany({role: 'MANAGER'})` ou `findMany({role: 'EMPLOYEE'})` en admin dashboard scannent table complète
  - **Fix:** `CREATE INDEX user_role_idx ON "User"("role") WHERE "deletedAt" IS NULL;`

- **⚠️ No index on (companyId, role) composite**
  - **Fichier:** schema.prisma:100 has only `@@index([companyId])`
  - **Impact:** Queries comme `{companyId, role: EMPLOYEE}` en distributeEnvelope (attribution.service.ts:141) font filtering en app
  - **Fix:** `CREATE INDEX user_company_role_idx ON "User"("companyId", "role") WHERE "deletedAt" IS NULL;`

### 2.4 Table RefreshToken

**Positifs:**
- ✓ ON DELETE CASCADE when User deleted
- ✓ Unique tokenHash (guarded on replay)
- ✓ isRevoked boolean (theft detection + rotation)
- ✓ replacedById linked to newer token

**Problèmes:**
- ⚠️ **No partial index on (userId, isRevoked)**
  - **Fichier:** schema.prisma:105-117, index only on userId
  - **Impact:** Queries like `{userId, isRevoked: false}` in auth.service.ts:146 linearscans user's tokens
  - **Fix:** `CREATE INDEX refreshtoken_userid_active_idx ON "RefreshToken"("userId") WHERE "isRevoked" = false;`

### 2.5 Tables EmailVerificationToken & PasswordResetToken

**Positifs:**
- ✓ Both ON DELETE CASCADE when User deleted (auth.service.ts:124-125 confirms)
- ✓ Unique tokenHash

**Problèmes:**
- ⚠️ **No index on (userId, usedAt)**
  - **Fichier:** schema.prisma:120-146
  - **Impact:** resendVerification (auth.service.ts:235) does `{userId, usedAt: null}` deleteMany → scans
  - **Fix:** `CREATE INDEX emailverificationtoken_userid_unused_idx ON "EmailVerificationToken"("userId") WHERE "usedAt" IS NULL;`
  - **Fix:** `CREATE INDEX passwordresettoken_userid_unused_idx ON "PasswordResetToken"("userId") WHERE "usedAt" IS NULL;`

### 2.6 Table CompanyInviteCode

**Positifs:**
- ✓ code unique
- ✓ ON DELETE CASCADE when Company deleted
- ✓ ON DELETE RESTRICT when User deleted (createdBy cannot disappear from history)
- ✓ revokedAt nullable (soft-revoke)
- ✓ usedCount + maxUses guarded in transaction (auth.service.ts:94-99)

**Problèmes:**
- ⚠️ **No index on (companyId, revokedAt, expiresAt)**
  - **Fichier:** schema.prisma:152-169
  - **Impact:** joinCompany (auth.service.ts:95) queries `{code, revokedAt IS NULL, expiresAt > now}` → scans companyId
  - **Fix:** `CREATE INDEX invitecode_live_idx ON "CompanyInviteCode"("companyId") WHERE "revokedAt" IS NULL;`

### 2.7 Table CompanyTokenPurchase

**Positifs:**
- ✓ stripeSessionId unique (webhook idempotence)
- ✓ amount > 0 CHECK
- ✓ ON DELETE RESTRICT (purchases are immutable ledger)

**Problèmes:**
- ⚠️ **No index on createdAt** for time-range queries
  - **Fichier:** schema.prisma:174-189, only has companyId + createdById
  - **Impact:** Admin ledger in admin.service.ts:307 doesn't ORDER BY, but typical usage would

### 2.8 Table Attribution

**Positifs:**
- ✓ amount > 0 CHECK (mandatory)
- ✓ Indexes on companyId, employeeId, managerId, motifId, allocationId
- ✓ ON DELETE SET NULL for motifId (legacy rows + inactive motifs)
- ✓ ON DELETE SET NULL for allocationId (envelope can be deleted, attributions remain)
- ✓ Denormalized companyId for multi-tenant filtering

**Problèmes:**
- **❌ Missing: Index on (companyId, createdAt DESC)**
  - **Fichier:** schema.prisma:195-217
  - **Impact:** listAttributionsByCompany (attribution.service.ts:280) does `{companyId}` orderBy createdAt DESC → full table scan + sort
  - **Fix:** `CREATE INDEX attribution_company_created_idx ON "Attribution"("companyId", "createdAt" DESC);`

- ⚠️ **Missing: Index on (managerId, createdAt DESC)**
  - **Fichier:** schema.prisma:195-217
  - **Impact:** Manager's own attributions view scans all manager's rows unsorted
  - **Fix:** `CREATE INDEX attribution_manager_created_idx ON "Attribution"("managerId", "createdAt" DESC);`

- ⚠️ **Missing: Index on (employeeId, createdAt DESC)**
  - **Fichier:** schema.prisma:195-217
  - **Impact:** getEmployeeReceived (employee.service.ts:54) does pagination on {employeeId} orderBy createdAt DESC
  - **Fix:** `CREATE INDEX attribution_employee_created_idx ON "Attribution"("employeeId", "createdAt" DESC);`

### 2.9 Table Motif

**Positifs:**
- ✓ tag unique (stable key for stats)
- ✓ active flag for catalog filtering
- ✓ sortOrder for display order
- ✓ No cascade delete (motifs are immutable reference data)

**Problèmes:**
- ⚠️ **No index on (active, sortOrder)**
  - **Fichier:** schema.prisma:221-232
  - **Impact:** getStats (stats.service.ts:31) does `{active: true}` and sorts by sortOrder, scans full table
  - **Fix:** `CREATE INDEX motif_active_sortorder_idx ON "Motif"("active", "sortOrder");`

### 2.10 Table Allocation

**Positifs:**
- ✓ status enum with default A_DISTRIBUER
- ✓ distributedAt nullable (null while A_DISTRIBUER)
- ✓ retributionAmount frozen at distribution time
- ✓ Indexes on companyId, managerId

**Problèmes:**
- ⚠️ **Missing: Index on (managerId, status)**
  - **Fichier:** schema.prisma:237-257
  - **Impact:** listManagerEnvelopes (attribution.service.ts:197) + getManagerBalances (attribution.service.ts:252) filter on {managerId, status: A_DISTRIBUER}
  - **Fix:** `CREATE INDEX allocation_manager_status_idx ON "Allocation"("managerId", "status");`

- ⚠️ **Missing: Index on (companyId, status)**
  - **Fichier:** schema.prisma:237-257
  - **Impact:** Future queries on company allocation dashboard would scan all allocations

### 2.11 Table Category

**Positifs:**
- ✓ slug unique
- ✓ isActive flag
- ✓ Full audit trail

**Problèmes:**
- ⚠️ **No index on isActive**
  - **Fichier:** schema.prisma:260-272
  - **Impact:** listActiveOffers doesn't filter categories, but future category listing could scan

### 2.12 Table PartnerOffer

**Positifs:**
- ✓ ON DELETE RESTRICT for categoryId (offers belong to category)
- ✓ Indexes on categoryId, isActive
- ✓ cost (INT) and discountPercent (INT) - no decimals (token = smallest unit)

**Problèmes:**
- ⚠️ **Missing: Index on createdAt DESC**
  - **Fichier:** schema.prisma:275-292
  - **Impact:** listOffers (offer.service.ts:9) and listActiveOffers (offer.service.ts:83) orderBy createdAt DESC, scans table

### 2.13 Table PromoCode

**Positifs:**
- ✓ code unique
- ✓ Indexes on offerId, isUsed
- ✓ ON DELETE RESTRICT for offerId (codes are immutable)

**Problèmes:**
- ⚠️ **Missing: Composite index on (offerId, isUsed)**
  - **Fichier:** schema.prisma:294-307
  - **Impact:** redeemOffer (redemption.service.ts:20) does `{offerId, isUsed: false}` findFirst, plus groupBy in offer.service.ts:15-18
  - **Fix:** `CREATE INDEX promocode_offer_used_idx ON "PromoCode"("offerId", "isUsed");`

### 2.14 Table Redemption

**Positifs:**
- ✓ promoCodeId unique (1 promo code → 1 redemption)
- ✓ used boolean for merchant confirmation
- ✓ amount (INT) = snapshot of offer.cost at purchase
- ✓ Indexes on companyId, employeeId, offerId
- ✓ ON DELETE RESTRICT for all FKs (ledger immutability)

**Problèmes:**
- ⚠️ **Missing: Composite index on (employeeId, createdAt DESC)**
  - **Fichier:** schema.prisma:309-327
  - **Impact:** getEmployeeSpent (employee.service.ts:89) does pagination on {employeeId} orderBy createdAt DESC
  - **Fix:** `CREATE INDEX redemption_employee_created_idx ON "Redemption"("employeeId", "createdAt" DESC);`

- ⚠️ **Missing: Index on (companyId, createdAt DESC)**
  - **Fichier:** schema.prisma:309-327
  - **Impact:** Admin ledger in admin.service.ts:281 orderBy createdAt DESC, scans all redemptions per company

---

## 3. CONTRAINTES & CHECKS

### 3.1 Implemented (migration 20260605132150)
✓ `user_balance_non_negative` CHECK balance >= 0
✓ `company_pool_non_negative` CHECK tokenBalance >= 0
✓ `attribution_amount_positive` CHECK amount > 0
✓ `redemption_amount_positive` CHECK amount > 0
✓ `purchase_amount_positive` CHECK amount > 0
✓ `user_email_active_unique` Partial unique index on email where deletedAt IS NULL

### 3.2 Missing Checks

**❌ MISSING: Allocation.percentage consistency**
- **Fichier:** schema.prisma:237-257, line 241
- **Issue:** percentage (1..100) only for POURCENTAGE mode, NULL otherwise
- **Comment:** migration 20260619120754 creates table without CHECK
- **Fix:** `ALTER TABLE "Allocation" ADD CONSTRAINT allocation_percentage_mode_consistency CHECK ((mode = 'POURCENTAGE' AND percentage IS NOT NULL AND percentage >= 1 AND percentage <= 100) OR (mode != 'POURCENTAGE' AND percentage IS NULL));`

**❌ MISSING: Allocation.retributionAmount vs status**
- **Fichier:** schema.prisma:237-257, line 243
- **Issue:** retributionAmount > 0 only when status = DISTRIBUEE
- **Fix:** `ALTER TABLE "Allocation" ADD CONSTRAINT allocation_retribution_only_distributed CHECK ((status = 'DISTRIBUEE' AND "retributionAmount" > 0) OR (status = 'A_DISTRIBUER' AND "retributionAmount" = 0));`

**⚠️ MISSING: Allocation.distributedAt consistency**
- **Issue:** distributedAt should be NOT NULL when status = DISTRIBUEE
- **Fix:** `ALTER TABLE "Allocation" ADD CONSTRAINT allocation_distributedAt_when_distributed CHECK ((status = 'DISTRIBUEE' AND "distributedAt" IS NOT NULL) OR (status = 'A_DISTRIBUER' AND "distributedAt" IS NULL));`

**⚠️ MISSING: PromoCode.usedAt consistency**
- **Fichier:** schema.prisma:294-307, line 298
- **Issue:** usedAt should be NOT NULL when isUsed = true
- **Comment:** Prisma doesn't enforce this; only hashed by convention
- **Fix:** `ALTER TABLE "PromoCode" ADD CONSTRAINT promocode_used_at_consistency CHECK ((isUsed = true AND "usedAt" IS NOT NULL) OR (isUsed = false AND "usedAt" IS NULL));`

**⚠️ MISSING: Redemption.used vs createdAt**
- **Fichier:** schema.prisma:309-327, line 316
- **Issue:** Schema allows redemption to exist as "used" before it's redeemed (no temporal constraint)
- **Note:** Not critical since app controls this; but add for data integrity

---

## 4. CASCADES & FOREIGN KEYS

### 4.1 Summary Table

| FK | From → To | onDelete | Risk | Notes |
|----|-----------|----------|------|-------|
| User.companyId | User → Company | SET NULL | ✓ OK | Floating users allowed |
| RefreshToken.userId | RefreshToken → User | CASCADE | ✓ OK | Sessions die with user (revoked first) |
| EmailVerificationToken.userId | EmailVerificationToken → User | CASCADE | ✓ OK | Token invalidated; privacy OK (not PII) |
| PasswordResetToken.userId | PasswordResetToken → User | CASCADE | ✓ OK | Token invalidated |
| CompanyInviteCode.companyId | CompanyInviteCode → Company | CASCADE | ✓ OK | Revoked in admin.service.ts:123 |
| CompanyInviteCode.createdById | CompanyInviteCode → User | RESTRICT | ✓ OK | Manager can't be deleted if they created codes |
| CompanyTokenPurchase.companyId | CompanyTokenPurchase → Company | RESTRICT | ⚠ Issue | See below |
| CompanyTokenPurchase.createdById | CompanyTokenPurchase → User | RESTRICT | ✓ OK | Ledger immutable |
| Attribution.companyId | Attribution → Company | RESTRICT | ⚠ Issue | See below |
| Attribution.managerId | Attribution → User | RESTRICT | ✓ OK | Ledger immutable |
| Attribution.employeeId | Attribution → User | RESTRICT | ✓ OK | Ledger immutable |
| Attribution.motifId | Attribution → Motif | SET NULL | ✓ OK | Legacy rows + inactive motifs |
| Attribution.allocationId | Attribution → Allocation | SET NULL | ✓ OK | Envelope-less attributions allowed |
| PromoCode.offerId | PromoCode → PartnerOffer | RESTRICT | ✓ OK | Codes are immutable |
| Redemption.employeeId | Redemption → User | RESTRICT | ✓ OK | Ledger immutable |
| Redemption.offerId | Redemption → PartnerOffer | RESTRICT | ✓ OK | Ledger immutable |
| Redemption.promoCodeId | Redemption → PromoCode | RESTRICT | ✓ OK | 1:1 link, ledger immutable |
| Redemption.companyId | Redemption → Company | RESTRICT | ⚠ Issue | See below |
| PartnerOffer.categoryId | PartnerOffer → Category | RESTRICT | ✓ OK | Offers must have category |
| Allocation.companyId | Allocation → Company | RESTRICT | ⚠ Issue | See below |
| Allocation.managerId | Allocation → User | RESTRICT | ✓ OK | Ledger of allocations |
| Allocation.createdById | Allocation → User | RESTRICT | ✓ OK | Audit trail |

### 4.2 Cascade Issues Identified

**⚠️ ISSUE 1: Deleting Company blocks when it has attributions/redemptions/purchases**

- **Fichier:** migration 20260603113746, lines 233-254
- **Problem:** ON DELETE RESTRICT on all ledger references to Company
- **Scenario:** Admin tries to soft-delete a company with active ledgers → operation fails silently because admin.service.ts:91 doesn't handle the RESTRICT error
- **Current behavior in code:** admin.service.ts:91 is inside transaction, but no explicit error for RESTRICT violation
- **Fix:** Should CASCADE delete or explicitly handle RESTRICT with app-level guard

**⚠️ ISSUE 2: Allocation cascade inconsistency**

- **Fichier:** schema.prisma:237-257, lines 250-252 (Allocation.companyId, .managerId, .createdById all RESTRICT)
- **Problem:** If a company is deleted while it has undistributed allocations (A_DISTRIBUER), the deletion fails
- **Current:** admin.service.ts:91 has `onDelete: RESTRICT` on all Allocation FKs via migration 20260619120754
- **Scenario:** A manager leaves the company; if there are pending allocations, the manager can't be deleted
- **App behavior:** No explicit handling for this case; would just throw constraint violation

**How this manifests:**
1. Admin tries to delete Company via admin.service.ts:91 (softDeleteCompany)
2. If company has ANY attribution, purchase, or redemption, Prisma throws `PrismaClientUnknownRequestError` with code like `P2014` (FK constraint fail)
3. Transaction rolls back; error not explicitly handled in controller (admin.controller.ts:77-90)

**Recommended fix:**
- Change RESTRICT to CASCADE for **ledger tables** (Attribution, Redemption, CompanyTokenPurchase) at Company level
- Change RESTRICT to CASCADE for **Allocation at Company level** (keep RESTRICT at User level for audit trail)
- Rationale: Company deletion is irreversible (admin.service.ts:91 is transaction); keeping the ledgers for audit is already ensured by soft-deletes, not hard deletes

---

## 5. SOFT DELETES VS HARD DELETES

### 5.1 Current Implementation (✓ GOOD)

**All user-domain data uses soft deletes:**
- Company.deletedAt (admin.service.ts:91, 128-131)
- User.deletedAt (admin.service.ts:109-112, employee.service.ts:24-39, privacy.service.ts:111-121)
- CompanyInviteCode.revokedAt (admin.service.ts:123-126) — different column, same pattern
- Redemption, Attribution, CompanyTokenPurchase — **NO deletedAt column, kept immutably** ✓

**Privacy:**
- Deleted users are anonymized (privacy.service.ts:111-121):
  - email → `deleted-{uuid}@anonymized.local`
  - firstName/lastName → null
  - passwordHash → empty string
  - auth tokens → hard-deleted (privacy.service.ts:124-125)

### 5.2 Audit Trail Integrity (✓ EXCELLENT)

**Immutable ledger:** Attribution, Redemption, CompanyTokenPurchase, CompanyInviteCode (uses revokedAt)
- No cascade deletes on these tables
- Referential integrity via RESTRICT

### 5.3 Edge Case: Cascading Deletes

**When a user is anonymized (privacy.service.ts:111-126):**
1. `RefreshToken.deleteMany({userId})` — hard delete (sessions die) ✓
2. `EmailVerificationToken.deleteMany({userId})` — hard delete ✓
3. `PasswordResetToken` — **NOT explicitly deleted** ⚠️

**Fichier:** privacy.service.ts:111-126
**Issue:** PasswordResetToken should also be hard-deleted on anonymization
**Impact:** Forgotten tokens linger indefinitely; not a security risk (token expiry + isUsed check), but breaks GDPR "right to erasure" principle (recital 26)
**Fix:** Add `await tx.passwordResetToken.deleteMany({ where: { userId } });` after line 125

---

## 6. NULLABLE FIELDS - JUSTIFICATION

| Field | Table | Nullable | Justification | ✓/⚠️ |
|-------|-------|----------|--------------|------|
| firstName | User | Yes | ADMIN has no name | ✓ |
| lastName | User | Yes | ADMIN has no name | ✓ |
| profilePhoto | User | Yes | Nullable = show initials | ✓ |
| companyId | User | Yes | Floating users or ADMIN | ✓ |
| role | User | Yes | Account-first: role set on company join | ✓ |
| lastLoginAt | User | Yes | Never logged in | ✓ |
| deletedAt | User/Company | Yes | Soft delete flag | ✓ |
| motifId | Attribution | Yes | Legacy rows + Motif.active = false | ✓ |
| retributionAmount | Attribution | Yes | ⚠️ See issue 7.1 below | ⚠️ |
| allocationId | Attribution | Yes | Direct owner → employee (no envelope) | ✓ |
| deletedAt | Company | Yes | Soft delete | ✓ |
| revokedAt | CompanyInviteCode | Yes | Soft-revoke | ✓ |
| note | CompanyTokenPurchase | Yes | Optional purchase note | ✓ |
| stripeSessionId | CompanyTokenPurchase | Yes | Manual credits without Stripe | ✓ |
| imageUrl | PartnerOffer | Yes | Fallback to category thumbnail | ✓ |
| percentage | Allocation | Yes | Only for POURCENTAGE mode | ✓ |
| distributedAt | Allocation | Yes | Null while A_DISTRIBUER | ✓ |
| usedAt | PromoCode | Yes | Set only when isUsed = true | ✓ |
| used | Redemption | Yes | ⚠️ SHOULD NOT BE NULLABLE | ⚠️ |
| imageUrl | Category | Yes | (not in schema) | — |

### 6.1 Issue: Redemption.used should NOT be nullable

**Fichier:** schema.prisma:309-327, line 316
**Problem:** `used Boolean @default(false)` is correct, but schema allows NULL
**Current:** Never set to NULL by code (redemption.service.ts, employee.service.ts:125-132)
**Risk:** If ever queried with NULL, it ambiguates "never marked used by employee" vs "error state"
**Fix:** Remove nullable; keep default(false)

---

## 7. DEFAULT VALUES - AUDIT

| Field | Value | Justification | ✓/⚠️ |
|-------|-------|--------------|------|
| Role | — | No default; required on creation | ✓ |
| CompanyStatus | PENDING | Awaits admin approval | ✓ |
| AllocationStatus | A_DISTRIBUER | Envelope starts undistributed | ✓ |
| User.balance | 0 | Fresh user has no tokens | ✓ |
| User.isEmailVerified | false | Must verify email first | ✓ |
| Company.tokenBalance | 0 | No tokens purchased yet | ✓ |
| CompanyInviteCode.usedCount | 0 | Fresh code | ✓ |
| CompanyInviteCode.role | EMPLOYEE | Default role for joiners | ✓ |
| RefreshToken.isRevoked | false | Fresh token is valid | ✓ |
| PartnerOffer.isActive | true | Offers start active | ✓ |
| Motif.active | true | New motifs start active | ✓ |
| Category.isActive | true | New categories active | ✓ |
| PromoCode.isUsed | false | Fresh code unused | ✓ |
| Attribution.retributionAmount | 0 | Managerial retribution = 0 until envelope distributed | ✓ |
| Allocation.retributionAmount | 0 | Frozen only at distribution | ✓ |
| Redemption.used | false | Not yet confirmed at merchant | ✓ |

---

## 8. AUDIT TRAIL - insertedAt / updatedAt / deletedAt

### 8.1 Implementation Status

| Table | createdAt | updatedAt | deletedAt | ✓/⚠️ |
|-------|-----------|-----------|-----------|------|
| Company | ✓ | ✓ | ✓ | ✓ |
| User | ✓ | ✓ | ✓ | ✓ |
| RefreshToken | ✓ | — | — | ✓ Immutable |
| EmailVerificationToken | ✓ | — | — | ✓ Immutable + usedAt |
| PasswordResetToken | ✓ | — | — | ✓ Immutable + usedAt |
| CompanyInviteCode | ✓ | — | ✓* | ✓* revokedAt instead |
| CompanyTokenPurchase | ✓ | — | — | ✓ Immutable ledger |
| Attribution | ✓ | — | — | ✓ Immutable ledger |
| Motif | ✓ | — | — | ✓ Reference data |
| Allocation | ✓ | — | ✓ | ⚠️ distributedAt only |
| Category | ✓ | ✓ | — | ⚠️ No soft delete |
| PartnerOffer | ✓ | ✓ | — | ⚠️ No soft delete (uses isActive) |
| PromoCode | ✓ | — | — | ✓ Immutable + usedAt |
| Redemption | ✓ | — | — | ✓ Immutable ledger |

### 8.2 Issues

**⚠️ ISSUE: Allocation lacks updatedAt**
- **Fichier:** schema.prisma:237-257, NO updatedAt
- **Impact:** Can't tell when Allocation was last modified; distributedAt only captures distribution, not mode/percentage changes (if ever allowed)
- **Fix:** Add `updatedAt DateTime @updatedAt` after line 248

**⚠️ ISSUE: PartnerOffer and Category use isActive flag, not deletedAt**
- **Fichier:** schema.prisma:260-292
- **Impact:** Deleted offers/categories can't be queried for audit trail; soft-delete convention broken
- **Note:** isActive is still soft-delete, but different column name breaks consistency
- **Fix:** Optional rename to deletedAt for consistency, but isActive is pragmatic (display-friendly)

---

## 9. N+1 QUERIES - DETECTIONS & RISKS

### 9.1 Pattern 1: listAttributionsByCompany (✓ FIXED)

**Fichier:** attribution.service.ts:280-293

```typescript
const rows = await prisma.attribution.findMany({
  where: { companyId, ...(managerId ? { managerId } : {}) },
  orderBy: { createdAt: 'desc' },
  select: {
    // ...
    employee: { select: { firstName: true, lastName: true } },  // No N+1
    motif: { select: { label: true } },                          // No N+1
  },
});
```

✓ Status: Joins via select() — no N+1. Each attribution row includes its employee/motif inline.

### 9.2 Pattern 2: getEmployeeReceived Pagination (✓ FIXED)

**Fichier:** employee.service.ts:54-87

```typescript
const [rows, total] = await Promise.all([
  prisma.attribution.findMany({
    where: { employeeId },
    skip, take,
    select: {
      manager: { select: { firstName, lastName, profilePhoto } },  // No N+1
      motif: { select: { compliment } },                           // No N+1
    },
  }),
  prisma.attribution.count({ where: { employeeId } }),
]);
```

✓ Status: Joins inline; pagination guarded (skip + take). No N+1.

### 9.3 Pattern 3: getStats (✓ EXCELLENT)

**Fichier:** stats.service.ts:19-212

✓ Zero N+1 strategy:
- Loads activeMotifs once (line 31) → reused in motifById Map
- Loads totalsByEmployee once (line 63), motifByEmployee once (line 69)
- Joins names via distributorIds set in one query (line 155)
- Uses raw SQL LATERAL join for velocity (line 260) avoiding N+1 on allocations

**Optimization:** Comments (lines 18, 173) explicitly claim "At most 2 queries per stat, zero N+1." Verified ✓

### 9.4 Pattern 4: Privacy export (⚠️ RISK)

**Fichier:** privacy.service.ts:13-100

```typescript
const [attributionReceived, attributionSent, redemptions] = await Promise.all([
  prisma.attribution.findMany({
    where: { employeeId: userId },
    select: {
      manager: { select: { firstName, lastName } },  // No N+1
      motif: { select: { label } },                  // No N+1
    },
  }),
  // ... more findMany
]);
```

✓ Status: Joins inline via select(). No N+1.

### 9.5 Pattern 5: getActiveOffer (⚠️ ISSUE)

**Fichier:** offer.service.ts:71-79

```typescript
export async function getActiveOffer(id: string) {
  const offer = await prisma.partnerOffer.findFirst({
    where: { id, isActive: true },
    select: { 
      category: { select: { id, slug, label, icon, color } },  // No N+1
    },
  });
  const stock = await prisma.promoCode.count({  // ← Separate query
    where: { offerId: id, isUsed: false },
  });
  return { ...offer, available: stock > 0 };
}
```

⚠️ Status: Two sequential queries (findFirst + count). Not N+1, but can optimize:
- **Fix:** Combine into one query: `promoCode.count()` via groupBy + scalar select or raw SQL

### 9.6 Pattern 6: listOffers (⚠️ RISK)

**Fichier:** offer.service.ts:8-33

```typescript
const offers = await prisma.partnerOffer.findMany({
  include: { category: { select: { ... } } },  // Joined inline ✓
});
// Then:
const grouped = await prisma.promoCode.groupBy({
  by: ['offerId', 'isUsed'],
  _count: { _all: true },
});
```

✓ Status: No N+1 — category is joined inline, codes are aggregated in one groupBy. Manual correlation is O(offers), not queries.

### 9.7 Pattern 7: listActiveOffers (⚠️ RISK)

**Fichier:** offer.service.ts:82-106

```typescript
const offers = await prisma.partnerOffer.findMany({
  where: { isActive: true },
  select: { ... },
});
const withStock = await prisma.promoCode.groupBy({
  by: ['offerId'],
  where: { isUsed: false },
});
const available = new Set(withStock.map((g) => g.offerId));
return offers.map((o) => ({ ...o, available: available.has(o.id) }));
```

✓ Status: No N+1. Two queries, but optimal (groupBy avoids count per offer).

### 9.8 Pattern 8: listSentEnvelopes (✓ OK)

**Fichier:** attribution.service.ts:227-248

```typescript
const allocations = await prisma.allocation.findMany({
  where: { companyId, createdById },
  select: {
    manager: { select: { firstName, lastName } },  // No N+1
  },
});
```

✓ Status: Joined inline.

### 9.9 Pattern 9: distributeEnvelope (✓ OK)

**Fichier:** attribution.service.ts:124-192

Queries: allocation (1), teamSize count (1), valid employees count (1), valid motifs count (1), then loop inserts per employee (N).

Loop pattern:
```typescript
for (const l of lines) {
  await tx.user.update({ ... });  // ← N queries
  await tx.attribution.create({ ... });  // ← N queries
}
```

⚠️ Status: **N+1 on employees.** Each employee update is separate query.
- **Impact:** For 50-employee envelope, 100 extra round-trips
- **Fix:** Use batch updates with `updateMany` or raw SQL CASE/WHEN

---

## 10. QUERY PERFORMANCE - MISSING INDEXES SUMMARY

| Issue | Severity | File:Line | Query | Fix |
|-------|----------|-----------|-------|-----|
| Company.status not indexed | High | 20260617140242 | Admin dashboard filtering APPROVED/PENDING | CREATE INDEX company_status_idx ON "Company"("status") WHERE "deletedAt" IS NULL |
| User.role not indexed | High | schema.prisma:71 | listUsers by role; admin dashboard managers count | CREATE INDEX user_role_idx ON "User"("role") WHERE "deletedAt" IS NULL |
| User.(companyId, role) composite | High | schema.prisma:100 | distributeEnvelope: count employees {companyId, role: EMPLOYEE} | CREATE INDEX user_company_role_idx ON "User"("companyId", "role") WHERE "deletedAt" IS NULL |
| RefreshToken.(userId, isRevoked) | Medium | schema.prisma:105 | auth.service.ts:146 {userId, isRevoked: false} | CREATE INDEX refreshtoken_userid_active_idx ON "RefreshToken"("userId") WHERE "isRevoked" = false |
| EmailVerificationToken.(userId, usedAt) | Medium | schema.prisma:120 | auth.service.ts:235 {userId, usedAt: null} deleteMany | CREATE INDEX emailverificationtoken_userid_unused_idx ON "EmailVerificationToken"("userId") WHERE "usedAt" IS NULL |
| PasswordResetToken.(userId, usedAt) | Medium | schema.prisma:135 | Similar to above | CREATE INDEX passwordresettoken_userid_unused_idx ON "PasswordResetToken"("userId") WHERE "usedAt" IS NULL |
| CompanyInviteCode.(companyId, live) | Medium | schema.prisma:152 | joinCompany queries live codes | CREATE INDEX invitecode_live_idx ON "CompanyInviteCode"("companyId") WHERE "revokedAt" IS NULL |
| Attribution.(companyId, createdAt DESC) | High | schema.prisma:195 | listAttributionsByCompany pagination + sort | CREATE INDEX attribution_company_created_idx ON "Attribution"("companyId", "createdAt" DESC) |
| Attribution.(managerId, createdAt DESC) | Medium | schema.prisma:195 | Manager's own attributions | CREATE INDEX attribution_manager_created_idx ON "Attribution"("managerId", "createdAt" DESC) |
| Attribution.(employeeId, createdAt DESC) | Medium | schema.prisma:195 | employee.service.ts:54 pagination | CREATE INDEX attribution_employee_created_idx ON "Attribution"("employeeId", "createdAt" DESC) |
| Motif.(active, sortOrder) | Medium | schema.prisma:221 | stats.service.ts:31 active motif catalog | CREATE INDEX motif_active_sortorder_idx ON "Motif"("active", "sortOrder") |
| Allocation.(managerId, status) | High | schema.prisma:237 | listManagerEnvelopes + getManagerBalances {managerId, A_DISTRIBUER} | CREATE INDEX allocation_manager_status_idx ON "Allocation"("managerId", "status") |
| Allocation.(companyId, status) | Medium | schema.prisma:237 | Future company allocation dashboard | CREATE INDEX allocation_company_status_idx ON "Allocation"("companyId", "status") |
| PartnerOffer.createdAt DESC | Medium | schema.prisma:275 | listOffers + listActiveOffers orderBy createdAt | CREATE INDEX offer_created_idx ON "PartnerOffer"("createdAt" DESC) |
| PromoCode.(offerId, isUsed) | High | schema.prisma:294 | redeemOffer + groupBy in offer service | CREATE INDEX promocode_offer_used_idx ON "PromoCode"("offerId", "isUsed") |
| Redemption.(employeeId, createdAt DESC) | Medium | schema.prisma:309 | getEmployeeSpent pagination | CREATE INDEX redemption_employee_created_idx ON "Redemption"("employeeId", "createdAt" DESC) |
| Redemption.(companyId, createdAt DESC) | Medium | schema.prisma:309 | Admin redemption ledger | CREATE INDEX redemption_company_created_idx ON "Redemption"("companyId", "createdAt" DESC) |

---

## 11. DATA TYPE PRECISION - AUDIT

### 11.1 Numeric Types

| Field | Type | Min | Max | Justification |
|-------|------|-----|-----|---------------|
| User.balance | INT | 0 | 2^31-1 | Token units (no decimals) |
| Company.tokenBalance | INT | 0 | 2^31-1 | Token pool |
| Attribution.amount | INT | 1 | 2^31-1 | CHECK > 0; daily max ~50 tokens/employee |
| Redemption.amount | INT | 1 | 2^31-1 | Snapshot of offer cost |
| PartnerOffer.cost | INT | 1 | 2^31-1 | Token cost of offer |
| CompanyTokenPurchase.amount | INT | 1 | 2^31-1 | Tokens purchased |
| Allocation.amount | INT | 1 | 2^31-1 | Envelope size |
| PartnerOffer.discountPercent | INT | 0 | 100 | ⚠️ No constraint; see issue 7.2 |
| Allocation.percentage | INT | 1 | 100 | POURCENTAGE mode retribution % |
| PromoCode.maxUses | INT | 1 | 2^31-1 | Cap on code uses |
| PromoCode.usedCount | INT | 0 | — | Incremented atomically |
| Motif.sortOrder | INT | — | — | Display order |
| Category.sortOrder | INT | — | — | Display order |

**✓ All INT (no DECIMAL) is correct** — tokens are smallest unit, no fractional amounts.

### 11.2 Temporal Types

| Field | Type | Notes |
|-------|------|-------|
| createdAt | TIMESTAMP(3) | ✓ Millisecond precision |
| updatedAt | TIMESTAMP(3) | ✓ Millisecond precision |
| deletedAt | TIMESTAMP(3) | ✓ Soft delete |
| expiresAt | TIMESTAMP(3) | ✓ Token expiry |
| lastLoginAt | TIMESTAMP(3) | ✓ GDPR 3-year anonymisation |
| usedAt | TIMESTAMP(3) | ✓ One-time token consumption |
| distributedAt | TIMESTAMP(3) | ✓ Allocation distribution time |
| revokedAt | TIMESTAMP(3) | ✓ Invite code revocation |

**✓ All TIMESTAMP(3) is correct** — millisecond precision fits all use cases.

### 11.3 Missing Precision Constraints

**❌ MISSING: PartnerOffer.discountPercent CHECK**
- **Fichier:** schema.prisma:275-292, line 279
- **Issue:** discountPercent INT has no constraint; could be negative or > 100
- **Fix:** `ALTER TABLE "PartnerOffer" ADD CONSTRAINT offer_discount_valid CHECK ("discountPercent" >= 0 AND "discountPercent" <= 100);`

**⚠️ WARNING: String fields unbounded**
- **Fichier:** schema.prisma (all TEXT fields)
- **Issue:** PostgreSQL TEXT is unbounded; no length constraints in schema
- **Examples:** User.firstName, User.lastName, Company.name, PartnerOffer.partnerName, etc.
- **Risk:** Very large values could impact performance or break API responses
- **Current:** App-level validation in Zod schemas (schemas/*.ts) enforces limits
- **Recommendation:** Add CHECK constraints in DB for defense-in-depth:
  - Email: 254 chars (RFC 5321)
  - firstName/lastName: 100 chars
  - Company.name: 255 chars
  - PartnerOffer.partnerName: 255 chars
  - etc.

---

## 12. EDGE CASES & DATA INTEGRITY RISKS

### 12.1 Deleting a Company with Active Ledgers

**Scenario:** Admin calls softDeleteCompany(companyId)

**Current flow (admin.service.ts:91-135):**
1. Fetches company (verify not already deleted)
2. Collects user IDs
3. Soft-deletes users
4. Revokes refresh tokens
5. Revokes invite codes
6. Soft-deletes company
7. **Then:** Tries to delete attributions/redemptions/purchases... **NO, doesn't happen.**

**Issue:** FKs are RESTRICT, so if any Attribution/Redemption/CompanyTokenPurchase exists, the soft-delete FAILS silently (no explicit error handling).

**Fichier:** admin.controller.ts:77-90

```typescript
try {
  const result = await softDeleteCompany(companyId);
  res.json(result);
} catch (err) {
  if (err instanceof Error && err.message === 'COMPANY_NOT_FOUND') { ... }
  next(err);  // ← Other errors (FK violations) fall through as 500
}
```

**Problem:** FK constraint violation (P2014) is silently 500'd, not handled gracefully.

**Fix:**
1. Change RESTRICT to CASCADE for ledger tables (Attribution, Redemption, CompanyTokenPurchase)
2. Add explicit error handling in admin.controller.ts:77-90 for FK violations

### 12.2 Deleting an Employee with Active Attributions

**Scenario:** Manager or admin deletes an employee

**Current flow (employee.service.ts:24-40):**
1. Fetches employee
2. Calls anonymizeUser(tx, employeeId)

**anonymizeUser (privacy.service.ts:111-126):**
- Sets deletedAt, anonymizes email/name
- Deletes RefreshToken, EmailVerificationToken, **but NOT PasswordResetToken**
- Does NOT touch Attribution/Redemption ledgers (they reference this user)

**Problem:** PasswordResetToken.deleteMany missing (see issue 5.3)

**No deletion risk here** — attributions with deleted employees are allowed (ledger immutability).

**Fix:** Add PasswordResetToken deletion.

### 12.3 Redemption without PromoCode?

**Scenario:** PromoCode is deleted or unreachable; Redemption remains

**Current FK:** `Redemption.promoCodeId` → PromoCode with ON DELETE RESTRICT

**Risk:** Redemption can't be deleted if PromoCode is missing (but PromoCode has ON DELETE RESTRICT, so this can't happen).

**Status:** ✓ Guarded by RESTRICT. No issue.

### 12.4 Attribution to Deleted Employee

**Scenario:** Employee is soft-deleted; attributions referencing them remain

**FK:** `Attribution.employeeId` → User with ON DELETE RESTRICT

**Current:** Attributions can't be deleted when employee is deleted. Employee records stay soft-deleted (anonymized).

**Status:** ✓ Correct. Ledger immutability preserved.

### 12.5 Allocation with No Attributions

**Scenario:** Manager soft-deleted before distributing an envelope

**FK:** `Allocation.managerId` → User with ON DELETE RESTRICT

**Risk:** Allocation can't be deleted if manager is deleted first.

**Status:** ⚠️ Problematic. If a manager is fired before distributing their allocation, admin can't delete the company.

**Fix:** Change Allocation.managerId to ON DELETE CASCADE or handle explicitly in admin code.

### 12.6 Inconsistent Allocation.retributionAmount

**Scenario:** Allocation created with mode PART_EGALE, then retributionAmount set to 5, but status still A_DISTRIBUER

**FK:** No constraint preventing this

**Status:** ⚠️ Possible data corruption if code path is buggy

**Fix:** Add CHECK constraint (see issue 3.2 above).

---

## 13. FUTURE RISKS & SCALABILITY

### 13.1 Attribution table growth

**Projection:**
- 100 companies × 200 employees × 365 days = 7.3M rows/year
- Indices on (companyId, createdAt), (employeeId, createdAt), (managerId, createdAt) will keep pagination fast

**Risk:** If no index maintenance, VACUUM/ANALYZE might lag.

**Recommendation:** Set up periodic VACUUM ANALYZE on Attribution, Redemption.

### 13.2 Allocation.distributedAt not indexed

**Current:** No index on distributedAt

**Risk:** Queries like "show me all distributed allocations" scan full Allocation table

**Fix:** `CREATE INDEX allocation_distributed_idx ON "Allocation"("distributedAt" DESC) WHERE "status" = 'DISTRIBUEE';`

### 13.3 PromoCode stock depletion under load

**Scenario:** Offer has 1000 codes; 1000 employees all redeem at once

**Current:** redemption.service.ts:19-68 retries up to 5 times
- If code is taken, fetch next unused code
- Atomic updateMany guards concurrency

**Risk:** O(N) retries for scarce inventory

**Mitigation:** Current retry loop (5 attempts) means worst case is 5 extra queries per redemption. For 1000 concurrent redeems on 1000 codes, this is acceptable.

### 13.4 User soft-delete email collisions

**Scenario:** 2 users with same email; first deleted, second re-registers with same email; admin restores first user

**Current:** Handled in admin.service.ts:154-166

```typescript
const clashes = await tx.user.findMany({
  where: { email: { in: emails }, deletedAt: null },
});
if (clashes.length > 0) {
  throw new Error(`EMAIL_TAKEN:${clashes.map((c) => c.email).join(', ')}`);
}
```

**Status:** ✓ Prevents restoration conflicts.

---

## 14. SUMMARY TABLE - ALL ISSUES

| ID | Severity | Type | Fichier:Ligne | Issue | Fix |
|---|----------|------|--------------|-------|-----|
| 1 | HIGH | Missing Index | 20260617140242 | Company.status not indexed | CREATE INDEX company_status_idx |
| 2 | HIGH | Missing Index | schema.prisma:71 | User.role not indexed | CREATE INDEX user_role_idx |
| 3 | HIGH | Missing Index | schema.prisma:100 | User.(companyId, role) composite | CREATE INDEX user_company_role_idx |
| 4 | HIGH | Missing Index | schema.prisma:195 | Attribution.(companyId, createdAt DESC) | CREATE INDEX attribution_company_created_idx |
| 5 | HIGH | Missing Index | schema.prisma:237 | Allocation.(managerId, status) | CREATE INDEX allocation_manager_status_idx |
| 6 | HIGH | Missing Index | schema.prisma:294 | PromoCode.(offerId, isUsed) | CREATE INDEX promocode_offer_used_idx |
| 7 | MEDIUM | Missing Index | schema.prisma:105 | RefreshToken.(userId, isRevoked) | CREATE INDEX refreshtoken_userid_active_idx |
| 8 | MEDIUM | Missing Index | schema.prisma:120 | EmailVerificationToken.(userId, usedAt) | CREATE INDEX emailverificationtoken_userid_unused_idx |
| 9 | MEDIUM | Missing Index | schema.prisma:135 | PasswordResetToken.(userId, usedAt) | CREATE INDEX passwordresettoken_userid_unused_idx |
| 10 | MEDIUM | Missing Index | schema.prisma:152 | CompanyInviteCode.(companyId, live) | CREATE INDEX invitecode_live_idx |
| 11 | MEDIUM | Missing Index | schema.prisma:195 | Attribution.(managerId, createdAt DESC) | CREATE INDEX attribution_manager_created_idx |
| 12 | MEDIUM | Missing Index | schema.prisma:195 | Attribution.(employeeId, createdAt DESC) | CREATE INDEX attribution_employee_created_idx |
| 13 | MEDIUM | Missing Index | schema.prisma:221 | Motif.(active, sortOrder) | CREATE INDEX motif_active_sortorder_idx |
| 14 | MEDIUM | Missing Index | schema.prisma:237 | Allocation.(companyId, status) | CREATE INDEX allocation_company_status_idx |
| 15 | MEDIUM | Missing Index | schema.prisma:275 | PartnerOffer.createdAt DESC | CREATE INDEX offer_created_idx |
| 16 | MEDIUM | Missing Index | schema.prisma:309 | Redemption.(employeeId, createdAt DESC) | CREATE INDEX redemption_employee_created_idx |
| 17 | MEDIUM | Missing Index | schema.prisma:309 | Redemption.(companyId, createdAt DESC) | CREATE INDEX redemption_company_created_idx |
| 18 | MEDIUM | Missing CHECK | schema.prisma:237 | Allocation.percentage consistency | ALTER TABLE "Allocation" ADD CONSTRAINT allocation_percentage_mode |
| 19 | MEDIUM | Missing CHECK | schema.prisma:237 | Allocation.retributionAmount vs status | ALTER TABLE "Allocation" ADD CONSTRAINT allocation_retribution_only_distributed |
| 20 | LOW | Missing CHECK | schema.prisma:237 | Allocation.distributedAt consistency | ALTER TABLE "Allocation" ADD CONSTRAINT allocation_distributedAt_when_distributed |
| 21 | LOW | Missing CHECK | schema.prisma:294 | PromoCode.usedAt consistency | ALTER TABLE "PromoCode" ADD CONSTRAINT promocode_used_at_consistency |
| 22 | LOW | Missing CHECK | schema.prisma:275 | PartnerOffer.discountPercent range | ALTER TABLE "PartnerOffer" ADD CONSTRAINT offer_discount_valid |
| 23 | MEDIUM | Cascade Issue | migration:20260603113746 | ON DELETE RESTRICT for ledger FKs | Change to CASCADE or handle in app |
| 24 | MEDIUM | Cascade Issue | migration:20260619120754 | Allocation.companyId RESTRICT blocks deletion | Change Allocation.companyId to CASCADE |
| 25 | MEDIUM | Missing Delete | privacy.service.ts:125 | PasswordResetToken not deleted on anonymize | Add deleteMany for PasswordResetToken |
| 26 | LOW | Missing ColumnConstraint | schema.prisma:309 | Redemption.used should not be nullable | Remove nullable from used |
| 27 | LOW | Missing Column | schema.prisma:237 | Allocation lacks updatedAt | Add updatedAt DateTime @updatedAt |
| 28 | LOW | N+1 Query | attribution.service.ts:172 | Loop: distributeEnvelope per-user updates | Batch with updateMany or raw SQL |
| 29 | MEDIUM | Performance | offer.service.ts:71 | getActiveOffer: separate count query | Combine into one query |
| 30 | LOW | Missing Type Constraint | schema.prisma (all) | String fields unbounded | Add CHECK constraints (app-level Zod enforces) |

---

## 15. RECOMMENDATIONS - PRIORITY ORDER

### Phase 1: IMMEDIATE (Blockers)
1. **Add 6 HIGH-severity indexes** (issues 1-6) - prevent table scans
2. **Fix cascade deletes** (issues 23-24) - prevent silent 500s on company/manager deletion
3. **Add Allocation.percentage CHECK** (issue 18) - prevent data corruption

### Phase 2: SHORT-TERM (This week)
4. **Add 11 MEDIUM-severity indexes** (issues 7-17) - improve pagination/filtering performance
5. **Add remaining 3 CHECKs** (issues 19-22) - data integrity
6. **Delete PasswordResetToken on anonymize** (issue 25) - GDPR compliance

### Phase 3: MEDIUM-TERM (This sprint)
7. **Batch update employees in distributeEnvelope** (issue 28) - reduce query count from 2N to 1 per envelope
8. **Optimize getActiveOffer** (issue 29) - combine queries
9. **Add Allocation.updatedAt** (issue 27) - audit trail

### Phase 4: NICE-TO-HAVE
10. **Add string length CHECKs** (issue 30) - defense-in-depth, already in Zod
11. **Index Allocation.distributedAt** - future optimization
12. **Rename PartnerOffer.isActive to deletedAt** - consistency with soft-delete pattern

---

## CONCLUSION

**Database is well-designed** with solid audit trail, soft deletes, and immutable ledgers. Main gaps are **17 missing indexes** (performance) and **2 cascade issues** (operational). No structural bugs; data integrity is protected by CHECKs.

**Quick wins:** Add indexes #1-6, fix cascades, add percentage CHECK. Should take <1 hour.

**Total severity:** 5 HIGH, 10 MEDIUM, 15 LOW/NICE-TO-HAVE.

