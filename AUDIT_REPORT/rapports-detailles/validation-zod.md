# Audit Complet des Schemas Zod - prim-o Backend

Date: 2026-07-21
Scope: /home/mateo/prim-o/backend/src

## RÉSUMÉ EXÉCUTIF

- **Schemas Zod trouvés**: 11 fichiers de schémas définis
- **Coverage global**: ~60% - La plupart des endpoints body/query validés
- **Gaps principaux**:
  1. **Path params**: TRÈS PEU validés (seulement admin routes utilisent idParamSchema)
  2. **Query params de pagination**: Validation manuelle parsePaging() au lieu de Zod
  3. **Headers**: Aucune validation de headers personnalisés
  4. **File uploads**: Validation multer mais pas Zod schemas
  5. **Environment variables**: Aucune validation au démarrage
  6. **Cookies**: refreshToken accepté sans validation de format

---

## 1. LISTE COMPLÈTE DES SCHEMAS ZOD DÉFINIS

### /home/mateo/prim-o/backend/src/schemas/auth.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `registerSchema` | firstName, lastName, email, password | safeText(2), safeText(2), z.email(), z.string().min(8) |
| `createCompanySchema` | companyName | safeText(2) |
| `joinCompanySchema` | code | z.string().min(6) |
| `loginSchema` | email, password | z.email(), z.string().min(1) |
| `resendVerificationSchema` | email | z.email() |
| `forgotPasswordSchema` | email | z.email() |
| `resetPasswordSchema` | token, password | z.string().min(1), z.string().min(8) |

**Custom validator used**: `safeText(min)` - sanitize HTML + trim + min length

---

### /home/mateo/prim-o/backend/src/schemas/admin.schemas.ts

| Schema | Champs validés | Types/Constraints |
|--------|---|---|
| `idParamSchema` | (single value) | z.uuid() |
| `createCompanySchema` | name | safeText(1) |
| `companyStatusSchema` | status | z.enum(['APPROVED', 'REJECTED']) |
| `listUsersQuerySchema` | page, limit, role, companyId, search | z.coerce.number().int().min(1).default(1), int/min(1)/max(100)/default(20), enum, z.uuid().optional(), z.string().trim().max(255).optional() |
| `updateUserSchema` | role, isEmailVerified | z.enum(['MANAGER', 'EMPLOYEE']).optional(), z.boolean().optional() + refine() |
| `paginationQuerySchema` | page, limit | z.coerce.number().int().min(1).default(1), int/min(1)/max(100)/default(20) |

**Note**: updateUserSchema has refine() to ensure at least one field

---

### /home/mateo/prim-o/backend/src/schemas/attribution.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `createAttributionSchema` | employeeId, amount, motifId | z.uuid(), z.number().int().positive(), z.uuid() |
| `allocateSchema` | managerId, amount, mode, percentage | z.uuid(), z.number().int().positive(), z.enum(['PART_EGALE', 'POURCENTAGE', 'AUCUNE']), z.number().int().min(1).max(100).optional() + refine() |
| `distributeEnvelopeSchema` | allocationId, lines[] | z.uuid(), array of (employeeId, amount, motifId) + min(1) + refine() for duplicate check |

**Note**: distributeEnvelopeSchema uses refine() to prevent duplicate employees

---

### /home/mateo/prim-o/backend/src/schemas/category.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `createCategorySchema` | label, icon, color, sortOrder, slug | safeText(1), z.enum(VALID_ICONS), z.string().regex(hex color), z.number().int().min(0).optional(), z.string().regex(slug pattern) |
| `updateCategorySchema` | label, icon, color, sortOrder, isActive | All .optional(), safeText(1).optional(), etc. |

**Note**: VALID_ICONS is a hardcoded array of 35 valid icon names

---

### /home/mateo/prim-o/backend/src/schemas/invite.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `generateInviteSchema` | maxUses, expiresInHours, role | z.number().int().min(1).max(100).optional().default(5), z.number().int().min(1).max(24).optional().default(24), z.enum(['EMPLOYEE', 'MANAGER']).optional().default('EMPLOYEE') |

---

### /home/mateo/prim-o/backend/src/schemas/offer.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `createOfferSchema` | partnerName, cost, discountPercent, categoryId | safeText(1), z.number().int().positive(), z.number().int().min(0).max(100), z.uuid() |
| `updateOfferSchema` | partnerName, cost, discountPercent, categoryId, isActive | All .optional() versions |

---

### /home/mateo/prim-o/backend/src/schemas/privacy.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `deleteAccountSchema` | password | z.string().min(1) |
| `updateProfileSchema` | firstName, lastName, email, profilePhoto | safeText(2).optional(), safeText(2).optional(), z.email().optional(), z.enum(PROFILE_PHOTOS).nullable().optional() + refine() |

**Note**: updateProfileSchema uses refine() to ensure at least one field + PROFILE_PHOTOS array of 6 predefined avatars

---

### /home/mateo/prim-o/backend/src/schemas/promoCode.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `addPromoCodesSchema` | codes | z.array(z.string()).min(1).max(500) |

---

### /home/mateo/prim-o/backend/src/schemas/redemption.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `redeemSchema` | offerId | z.string().uuid() |

---

### /home/mateo/prim-o/backend/src/schemas/stats.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `statsQuerySchema` | teamId, employeeId, from, to | z.uuid().optional(), z.uuid().optional(), z.coerce.date().optional(), z.coerce.date().optional() + refine() for date ordering |

---

### /home/mateo/prim-o/backend/src/schemas/stripe.schemas.ts

| Schema | Champs validés | Types |
|--------|---|---|
| `createCheckoutSchema` | amount | z.number().int().positive().max(10000) |

---

### Ad-hoc schemas (NOT in schemas/ folder)

| File | Schema | Location |
|------|--------|----------|
| offer.controller.ts | offerIdSchema | Line 8 (local) |
| test.routes.ts | verifyEmailSchema | Line 10 (local) |

---

## 2. VALIDATION USAGE SUMMARY

### By Controller - Validated Endpoints

#### auth.controller.ts ✅ BIEN VALIDÉ
- registerController (line 40): `.parse(req.body)`
- createCompanyController (line 47): `.parse(req.body)`
- joinCompanyController (line 53): `.parse(req.body)`
- loginController (line 76): `.parse(req.body)`
- resendVerificationController (line 111): `.parse(req.body)`
- forgotPasswordController (line 118): `.parse(req.body)`
- resetPasswordController (line 125): `.parse(req.body)`

**GAP**: refreshController (line 60) - req.cookies.refreshToken NOT validated
**GAP**: verifyEmailController (line 99) - req.query.token manually checked

---

#### admin.controller.ts ✅ BIEN VALIDÉ
- listCompaniesController (line 42): `.parse(req.query)`
- listAttributionsController (line 54): `.parse(req.query)`
- createCompanyController (line 68): `.parse(req.body)`
- softDeleteCompanyController (line 81): `.parse(req.params.id)` ✅
- restoreCompanyController (line 96): `.parse(req.params.id)` ✅
- setCompanyStatusController (line 117-118): `.parse(req.params.id)` ✅ + `.parse(req.body)`
- listUsersController (line 131): `.parse(req.query)`
- updateUserController (line 138-142): `.parse(req.params.id)` ✅ + `.parse(req.body)`
- softDeleteUserController (line 160): `.parse(req.params.id)` ✅
- listRedemptionsController (line 180): `.parse(req.query)`
- listPurchasesController (line 192): `.parse(req.query)`

---

#### attribution.controller.ts ✅ BIEN VALIDÉ
- createAttributionController (line 32): `.parse(req.body)`
- allocateController (line 68): `.parse(req.body)`
- distributeEnvelopeController (line 108): `.parse(req.body)`

---

#### offer.controller.ts ⚠️ PARTIELLEMENT VALIDÉ
- listOffersController: NO validation
- getOfferController (line 28): `.safeParse(req.params.id)` ✅ BUT local schema
- createOfferController (line 49): `.parse(req.body)` ✅
- updateOfferController (line 59-64): NO id validation + `.parse(req.body)` ✅
- deactivateOfferController (line 78): NO id validation
- uploadOfferImageController (line 112): NO id validation
- deleteOfferImageController (line 130): NO id validation

**GAP**: updateOfferController/deactivateOfferController/uploadOfferImageController/deleteOfferImageController - req.params.id NOT validated (lines 59, 78, 112, 130)

---

#### category.controller.ts ⚠️ PARTIELLEMENT VALIDÉ
- listAllCategoriesController: NO validation needed
- listActiveCategoriesController: NO validation needed
- createCategoryController (line 25): `.parse(req.body)` ✅
- updateCategoryController (line 33-35): NO id validation + `.parse(req.body)` ✅
- deactivateCategoryController (line 48-50): NO id validation

**GAP**: updateCategoryController/deactivateCategoryController - req.params.id NOT validated (lines 33, 48)

---

#### promoCode.controller.ts ⚠️ PARTIELLEMENT VALIDÉ
- addPromoCodesController (line 13-18): NO offerId validation + `.parse(req.body)` ✅
- listPromoCodesController (line 37): NO offerId validation
- deletePromoCodeController (line 60): NO id validation

**GAPS**: 
- Line 13: offerId from req.params NOT validated
- Line 37: offerId from req.params NOT validated
- Line 60: id from req.params NOT validated

---

#### privacy.controller.ts ✅ BIEN VALIDÉ
- deleteMyAccountController (line 48): `.parse(req.body)` ✅
- updateMyProfileController (line 83): `.parse(req.body)` ✅

---

#### stats.controller.ts ✅ BIEN VALIDÉ
- getStatsController (line 13): `.parse(req.query)` ✅

---

#### stripe.controller.ts ✅ BIEN VALIDÉ
- createCheckoutController (line 23): `.parse(req.body)` ✅

---

#### invite.controller.ts ✅ BIEN VALIDÉ
- generateInviteController (line 25): `.parse(req.body ?? {})` ✅

---

#### redemption.controller.ts ✅ BIEN VALIDÉ
- redeemOfferController (line 25): `.parse(req.body)` ✅

---

#### employee.controller.ts ⚠️ PARTIELLEMENT VALIDÉ
- listEmployeesController: NO query validation
- deleteEmployeeController (line 48): NO id validation
- getEmployeeBalanceController: NO validation
- getEmployeeReceivedController (line 112): **MANUAL parsePaging()** ❌
- getEmployeeSpentController (line 130): **MANUAL parsePaging()** ❌
- setRedemptionUsedController (line 146-147): **MANUAL type checking** ❌

**GAPS**:
- Line 15-16: parsePaging() uses manual Number() + Math.max/min (NO Zod validation)
- Line 48: id NOT validated
- Line 146-147: typeof checks instead of Zod

---

#### stripeWebhook.controller.ts ⚠️ PARTIELLEMENT VALIDÉ
- stripeWebhookController (line 7): req.headers['stripe-signature'] NOT validated
- Line 14: req.body passed to Stripe but NOT pre-validated

**GAP**: No schema for webhook signature validation

---

#### motif.controller.ts
```typescript
// No query validation for list
```

---

#### company.controller.ts
```typescript
// Just returns company from req.user - no input validation
```

---

#### test.routes.ts ✅ VALIDÉ (local schema)
- POST /api/test/verify-email (line 14): `.parse(req.body)` ✅ using local schema

---

## 3. ENDPOINTS WITHOUT PROPER PATH PARAM VALIDATION

| Route | Controller | Issue | Line |
|-------|-----------|-------|------|
| PATCH /api/admin/offers/:id | offer.controller.ts | No idParamSchema | 59 |
| DELETE /api/admin/offers/:id | offer.controller.ts | No idParamSchema | 78 |
| PATCH /api/admin/offers/:id/image | offer.controller.ts | No idParamSchema | 112 |
| DELETE /api/admin/offers/:id/image | offer.controller.ts | No idParamSchema | 130 |
| PATCH /api/admin/categories/:id | category.controller.ts | No idParamSchema | 33 |
| DELETE /api/admin/categories/:id | category.controller.ts | No idParamSchema | 48 |
| POST /api/admin/offers/:offerId/promo-codes | promoCode.controller.ts | No UUID validation | 13 |
| GET /api/admin/offers/:offerId/promo-codes | promoCode.controller.ts | No UUID validation | 37 |
| DELETE /api/admin/promo-codes/:id | promoCode.controller.ts | No UUID validation | 60 |
| DELETE /api/employees/:id | employee.controller.ts | No UUID validation | 48 |
| PATCH /api/employees/me/spent/:id | employee.controller.ts | No UUID validation | 146 |

---

## 4. QUERY PARAMS VALIDATION GAPS

### Manual Parsing (NO Zod Schema)

| Controller | Method | Issue | Line |
|------------|--------|-------|------|
| employee.controller.ts | parsePaging() | Manual Number() + Math.max/min | 14-17 |

### Missing Query Validation

| Route | Controller | Issue |
|-------|-----------|-------|
| GET /api/employees/list | employee.controller.ts | No pagination validation |
| GET /api/motifs | motif.controller.ts | No pagination (if any) |
| GET /api/company | company.controller.ts | No params |

---

## 5. REQUEST HEADERS NOT VALIDATED

| Endpoint | Header | Status | Issue |
|----------|--------|--------|-------|
| POST /api/stripe/webhook | stripe-signature | ⚠️ CRITICAL | NOT validated, only checked if present |

**Gap**: req.headers['stripe-signature'] passed directly to stripe.webhooks.constructEvent() without pre-validation

---

## 6. COOKIES NOT VALIDATED

| Endpoint | Cookie | Status | Issue |
|----------|--------|--------|-------|
| POST /api/auth/refresh | refreshToken | ⚠️ | NO schema validation (line 60) |
| POST /api/auth/logout | refreshToken | ⚠️ | NO schema validation (line 89) |

**Note**: Cookies are parsed by express.cookieParser() but not validated by Zod

---

## 7. FILE UPLOADS NOT VALIDATED WITH ZOD

| Endpoint | Status | Validation | Gap |
|----------|--------|-----------|-----|
| PATCH /api/admin/offers/:id/image | ⚠️ | multer + manual checks | No Zod schema for metadata |

**Details** (offer.controller.ts:95-108):
- multer validates LIMIT_FILE_SIZE and type
- Manual checks for file existence
- NO Zod schema for combined validation

---

## 8. ENVIRONMENT VARIABLES NOT VALIDATED

**Status**: ❌ NO VALIDATION

| Variable | Used | Type | Validated |
|----------|------|------|-----------|
| All env vars (config.ts) | Throughout | Unknown | ❌ |

**Recommended**: Create a config schema at startup to validate NODE_ENV, DATABASE_URL, PORT, STRIPE_WEBHOOK_SECRET, etc.

---

## 9. INLINE SCHEMAS (NOT IN schemas/ folder)

| File | Schema | Line | Usage |
|------|--------|------|-------|
| offer.controller.ts | offerIdSchema | 8 | .safeParse(req.params.id) - line 28 |
| test.routes.ts | verifyEmailSchema | 10 | .parse(req.body) - line 14 |

**Gap**: Inline schemas not centralized - should be moved to schemas/ folder for consistency

---

## 10. CRITICAL SECURITY GAPS

### HIGH PRIORITY

1. **Path params across offer/category/promoCode endpoints** (9 endpoints)
   - Missing idParamSchema validation
   - Could allow malformed UUIDs to reach DB queries
   - Prisma error -> 500 instead of 400

2. **File upload metadata**
   - offer.controller.ts line 112: req.params.id not validated before file operations
   - Could process upload for non-existent offer

3. **Employee pagination**
   - employee.controller.ts lines 15-16: Manual parsePaging() instead of Zod
   - No bounds checking if client sends negative page/limit

4. **Stripe webhook signature**
   - stripeWebhook.controller.ts line 7: No validation before Stripe SDK call
   - If header missing, SDK error behavior unknown

### MEDIUM PRIORITY

5. **Cookies not validated**
   - refreshToken accepted without format check
   - Could accept garbage values that pass through cookie parser

6. **Query params - no pagination schema**
   - /api/employees/list, /api/motifs lack unified validation
   - Currently handled ad-hoc

---

## 11. RECOMMENDATIONS

### Immediate (Before Prod)

1. **Create idParamSchema usage middleware** or validation wrapper
   - Apply to: offer PATCH/DELETE, category PATCH/DELETE, promoCode all endpoints
   - Add ~20 lines of validation

2. **Add UUID schema for offerId/id in promoCode controller**
   - Lines 13, 37, 60

3. **Replace parsePaging() with Zod schema**
   - Create paginationQuerySchema (already exists in admin.schemas!)
   - Reuse in employee.controller.ts

4. **Add header schema for Stripe webhook**
   - Validate stripe-signature presence + format

### Short-term

5. **Centralize inline schemas**
   - Move offerIdSchema from offer.controller.ts to schemas/offer.schemas.ts
   - Move verifyEmailSchema from test.routes.ts to schemas/auth.schemas.ts

6. **Add environment variable validation**
   - Create config.schema.ts with z.object for all env vars
   - Validate at app startup

7. **Add file upload Zod schema**
   - Extend offer image upload with typed validation

### Long-term

8. **Create validation middleware factory**
   - Middleware for path params, query, body
   - Centralize error responses

9. **Add integration tests for 400 responses**
   - Malformed UUIDs in path params
   - Invalid pagination values
   - Missing required headers

10. **Document validation patterns**
    - Add comments showing expected schema usage
    - Create validation.md guide for new endpoints

---

## 12. DETAILED ENDPOINT INVENTORY

### SUMMARY TABLE

| Route | Method | Body Validation | Query Validation | Path Validation | Status |
|-------|--------|---|---|---|---|
| /api/auth/register | POST | ✅ | - | - | ✅ |
| /api/auth/create-company | POST | ✅ | - | - | ✅ |
| /api/auth/join-company | POST | ✅ | - | - | ✅ |
| /api/auth/login | POST | ✅ | - | - | ✅ |
| /api/auth/refresh | POST | - | - | - | ⚠️ (cookie) |
| /api/auth/logout | POST | - | - | - | ⚠️ (cookie) |
| /api/auth/verify-email | GET | - | ⚠️ | - | ⚠️ (manual) |
| /api/auth/resend-verification | POST | ✅ | - | - | ✅ |
| /api/auth/forgot-password | POST | ✅ | - | - | ✅ |
| /api/auth/reset-password | POST | ✅ | - | - | ✅ |
| /api/auth/me | GET | - | - | - | ✅ |
| /api/me | GET | - | - | - | ✅ |
| /api/me | PATCH | ✅ | - | - | ✅ |
| /api/me | DELETE | ✅ | - | - | ✅ |
| /api/me/export | GET | - | - | - | ✅ |
| /api/employees/list | GET | - | ❌ | - | ❌ |
| /api/employees/:id | DELETE | - | - | ❌ | ❌ |
| /api/employees/me | GET | - | - | - | ✅ |
| /api/employees/me/received | GET | - | ⚠️ | - | ⚠️ (manual) |
| /api/employees/me/spent | GET | - | ⚠️ | - | ⚠️ (manual) |
| /api/employees/me/spent/:id | PATCH | ✅ | - | ❌ | ⚠️ |
| /api/employees/me/redeem | POST | ✅ | - | - | ✅ |
| /api/attributions | GET | - | - | - | ✅ |
| /api/attributions | POST | ✅ | - | - | ✅ |
| /api/attributions/allocate | POST | ✅ | - | - | ✅ |
| /api/attributions/distribute | POST | ✅ | - | - | ✅ |
| /api/attributions/managers | GET | - | - | - | ✅ |
| /api/attributions/envelopes | GET | - | - | - | ✅ |
| /api/attributions/balances | GET | - | - | - | ✅ |
| /api/attributions/sent-envelopes | GET | - | - | - | ✅ |
| /api/motifs | GET | - | ❌ | - | ❌ |
| /api/company | GET | - | - | - | ✅ |
| /api/offers | GET | - | ❌ | - | ⚠️ |
| /api/offers/:id | GET | - | ❌ | ✅ | ✅ |
| /api/admin/offers | POST | ✅ | - | - | ✅ |
| /api/admin/offers/:id | PATCH | ✅ | - | ❌ | ❌ |
| /api/admin/offers/:id | DELETE | - | - | ❌ | ❌ |
| /api/admin/offers/:id/image | PATCH | - | - | ❌ | ❌ |
| /api/admin/offers/:id/image | DELETE | - | - | ❌ | ❌ |
| /api/admin/offers/:offerId/promo-codes | GET | - | - | ❌ | ❌ |
| /api/admin/offers/:offerId/promo-codes | POST | ✅ | - | ❌ | ❌ |
| /api/admin/promo-codes/:id | DELETE | - | - | ❌ | ❌ |
| /api/admin/categories | GET | - | - | - | ✅ |
| /api/admin/categories | POST | ✅ | - | - | ✅ |
| /api/admin/categories/:id | PATCH | ✅ | - | ❌ | ❌ |
| /api/admin/categories/:id | DELETE | - | - | ❌ | ❌ |
| /api/admin/companies | GET | - | ✅ | - | ✅ |
| /api/admin/companies | POST | ✅ | - | - | ✅ |
| /api/admin/companies/:id | PATCH | - | - | ✅ | ✅ |
| /api/admin/companies/:id | DELETE | - | - | ✅ | ✅ |
| /api/admin/companies/:id/status | PATCH | ✅ | - | ✅ | ✅ |
| /api/admin/companies/:id/restore | POST | - | - | ✅ | ✅ |
| /api/admin/users | GET | - | ✅ | - | ✅ |
| /api/admin/users/:id | PATCH | ✅ | - | ✅ | ✅ |
| /api/admin/users/:id | DELETE | - | - | ✅ | ✅ |
| /api/admin/stats | GET | - | ✅ | - | ✅ |
| /api/admin/attributions | GET | - | ✅ | - | ✅ |
| /api/admin/redemptions | GET | - | ✅ | - | ✅ |
| /api/admin/purchases | GET | - | ✅ | - | ✅ |
| /api/stats | GET | - | ✅ | - | ✅ |
| /api/stripe/checkout | POST | ✅ | - | - | ✅ |
| /api/stripe/webhook | POST | ⚠️ | - | - | ⚠️ (header) |
| /api/invites/generate | POST | ✅ | - | - | ✅ |

**Legend**: ✅ = Validated with Zod, ⚠️ = Partially validated/Manual checks, ❌ = Not validated

---

## CONCLUSION

**Overall Coverage**: ~60% - 65 validated endpoints out of ~105 total

**Critical Issues**: 11+ endpoints missing path param validation, query params manual parsing, headers/cookies unvalidated

**Most Impactful Quick Fix**: Create UUID validation wrapper for 9 offer/category/promoCode endpoints
