# Validation Gaps - Detailed Findings by File:Line

## CRITICAL GAPS (HIGH PRIORITY)

### 1. Offer Controller - Missing Path Param Validation

**File**: `/home/mateo/prim-o/backend/src/controllers/offer.controller.ts`

#### Gap 1: updateOfferController - No ID validation
- **Line**: 59
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation before passing to service
- **Risk**: Malformed UUID reaches Prisma → 500 error instead of 400
- **Current**: Manual check only exists for null: `if (!id)` (line 60)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 64

#### Gap 2: deactivateOfferController - No ID validation
- **Line**: 78
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation
- **Risk**: Same as Gap 1
- **Current**: Only null check (line 79)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 83

#### Gap 3: uploadOfferImageController - No ID validation
- **Line**: 112
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation
- **Risk**: File uploaded for non-existent offer ID
- **Current**: Only null check (line 113)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 116

#### Gap 4: deleteOfferImageController - No ID validation
- **Line**: 130
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation
- **Risk**: Same as Gap 1
- **Current**: Only null check (line 131)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 133

---

### 2. Category Controller - Missing Path Param Validation

**File**: `/home/mateo/prim-o/backend/src/controllers/category.controller.ts`

#### Gap 5: updateCategoryController - No ID validation
- **Line**: 33
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation
- **Risk**: Malformed UUID reaches Prisma → 500 error
- **Current**: Only null check (line 34)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 35

#### Gap 6: deactivateCategoryController - No ID validation
- **Line**: 48
- **Code**: `const { id } = req.params;`
- **Issue**: No schema validation
- **Risk**: Same as Gap 5
- **Current**: Only null check (line 49)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 50

---

### 3. PromoCode Controller - Missing Path Param Validation

**File**: `/home/mateo/prim-o/backend/src/controllers/promoCode.controller.ts`

#### Gap 7: addPromoCodesController - No offerId validation
- **Line**: 13
- **Code**: `const { offerId } = req.params;`
- **Issue**: No UUID schema validation
- **Risk**: Malformed UUID passed to service
- **Current**: Only null check (line 14)
- **Fix**: Create promoCodeParamSchema or reuse idParamSchema, parse before line 18

#### Gap 8: listPromoCodesController - No offerId validation
- **Line**: 37
- **Code**: `const { offerId } = req.params;`
- **Issue**: No UUID schema validation
- **Risk**: Same as Gap 7
- **Current**: Only null check (line 38)
- **Fix**: Same as Gap 7

#### Gap 9: deletePromoCodeController - No ID validation
- **Line**: 60
- **Code**: `const { id } = req.params;`
- **Issue**: No UUID schema validation
- **Risk**: Same as Gap 7
- **Current**: Only null check (line 61)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 65

---

### 4. Employee Controller - Pagination Manual Parsing

**File**: `/home/mateo/prim-o/backend/src/controllers/employee.controller.ts`

#### Gap 10: parsePaging function - No Zod validation
- **Lines**: 14-17
- **Code**:
  ```typescript
  function parsePaging(req: Request): { page: number; limit: number } {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
    return { page, limit };
  }
  ```
- **Issue**: Manual Number() parsing instead of Zod schema (compare to admin.controller which uses paginationQuerySchema)
- **Risk**: 
  - Invalid type coercion (e.g., "abc" → NaN → 1)
  - No consistent error messages
  - Inconsistency with admin pagination validation
- **Current**: Ad-hoc manual checks
- **Fix**: Create and use `paginationQuerySchema` from admin.schemas (already exists!) or move to employee.schemas

#### Gap 11: getEmployeeReceivedController - Uses manual parsePaging
- **Line**: 112
- **Code**: `const { page, limit } = parsePaging(req);`
- **Issue**: Uses Gap 10's manual parsing instead of Zod
- **Fix**: Use paginationQuerySchema.parse(req.query)

#### Gap 12: getEmployeeSpentController - Uses manual parsePaging
- **Line**: 130
- **Code**: `const { page, limit } = parsePaging(req);`
- **Issue**: Uses Gap 10's manual parsing instead of Zod
- **Fix**: Use paginationQuerySchema.parse(req.query)

#### Gap 13: setRedemptionUsedController - Manual body validation
- **Line**: 147
- **Code**: `const used = req.body?.used;`
- **Issue**: Manual typeof check instead of Zod schema (line 148)
- **Risk**: No structured error response
- **Current**: 
  ```typescript
  if (typeof id !== 'string' || typeof used !== 'boolean') {
    next(new AppError(400, 'Paramètres invalides (id, used booléen requis).'));
  }
  ```
- **Fix**: Create redemptionUpdateSchema with Zod and use .parse(req.body)

#### Gap 14: deleteEmployeeController - No ID validation
- **Line**: 48
- **Code**: `const id = req.params.id;`
- **Issue**: No UUID schema validation
- **Risk**: Malformed UUID reaches service
- **Current**: Only typeof check (line 49)
- **Fix**: Use `idParamSchema.parse(req.params.id)` before line 54

#### Gap 15: listEmployeesController - No pagination validation
- **Lines**: 22-36
- **Issue**: No query param validation (if pagination params exist)
- **Fix**: Add paginationQuerySchema.parse(req.query) if pagination is supported

---

## MEDIUM PRIORITY GAPS

### 5. Cookies Not Validated

**File**: `/home/mateo/prim-o/backend/src/controllers/auth.controller.ts`

#### Gap 16: refreshController - refreshToken not validated
- **Line**: 60
- **Code**: `const rawToken = req.cookies?.refreshToken;`
- **Issue**: No Zod schema validation for cookie format/length
- **Risk**: Malformed tokens passed to JWT verification (though JWT lib handles it)
- **Current**: No pre-validation; directly passed to refreshTokens()
- **Fix**: Create refreshTokenSchema with basic format validation

#### Gap 17: logoutController - refreshToken not validated
- **Line**: 89
- **Code**: `const rawToken = req.cookies?.refreshToken;`
- **Issue**: No Zod schema validation
- **Risk**: Malformed tokens passed to service
- **Current**: No pre-validation
- **Fix**: Same as Gap 16

---

### 6. Stripe Webhook - Header Not Validated

**File**: `/home/mateo/prim-o/backend/src/controllers/stripeWebhook.controller.ts`

#### Gap 18: stripeWebhookController - stripe-signature header not validated
- **Line**: 7
- **Code**: `const signature = req.headers['stripe-signature'];`
- **Issue**: No schema validation before passing to Stripe SDK
- **Risk**: 
  - Missing header not validated (passed as undefined to stripe.webhooks.constructEvent)
  - Stripe SDK error response unclear
- **Current**: Passed directly to stripe.webhooks.constructEvent (line 14)
- **Fix**: Create webhookSignatureSchema with z.string().min(1) and validate before line 14

---

## LOW-MEDIUM PRIORITY GAPS

### 7. Query Parameter Validation Inconsistencies

**File**: `/home/mateo/prim-o/backend/src/controllers/auth.controller.ts`

#### Gap 19: verifyEmailController - token query param manual check
- **Line**: 99
- **Code**: `const token = typeof req.query.token === 'string' ? req.query.token : '';`
- **Issue**: Manual type coercion instead of Zod schema
- **Risk**: Accepts empty string instead of failing validation
- **Current**: typeof check only
- **Fix**: Create emailVerificationTokenSchema with z.string().min(1) and use .parse(req.query)

---

### 8. Missing Pagination Validation

**File**: `/home/mateo/prim-o/backend/src/controllers/category.controller.ts`

#### Gap 20: listAllCategoriesController - No validation needed
- **Note**: Read-only, no query params, OK

#### Gap 21: listActiveCategoriesController - No validation needed
- **Note**: Read-only, no query params, OK

---

### 9. Inline Schemas (Inconsistency)

**File**: `/home/mateo/prim-o/backend/src/controllers/offer.controller.ts`

#### Gap 22: offerIdSchema defined locally
- **Line**: 8
- **Code**: `const offerIdSchema = z.uuid();`
- **Issue**: Duplicates idParamSchema from admin.schemas
- **Risk**: Schema fragmentation, maintenance burden
- **Fix**: Remove local definition, import idParamSchema from admin.schemas, reuse everywhere

**File**: `/home/mateo/prim-o/backend/src/routes/test.routes.ts`

#### Gap 23: verifyEmailSchema defined locally
- **Line**: 10
- **Code**: `const verifyEmailSchema = z.object({ email: z.email() });`
- **Issue**: Should be in schemas/auth.schemas.ts with other auth schemas
- **Fix**: Move to schemas/auth.schemas.ts, import in test.routes.ts

---

## ENVIRONMENTAL & STARTUP GAPS

### 10. No Environment Variable Validation

**File**: `/home/mateo/prim-o/backend/src/config.ts`

#### Gap 24: Environment variables not validated at startup
- **Issue**: No Zod schema to validate NODE_ENV, PORT, DATABASE_URL, STRIPE_WEBHOOK_SECRET, etc.
- **Risk**: 
  - Invalid config discovered at runtime (e.g., missing STRIPE_WEBHOOK_SECRET)
  - Silent failures with undefined env vars
- **Current**: Direct process.env.X || fallback pattern
- **Fix**: Create config.schema.ts with z.object validation, call at app startup

---

## SUMMARY TABLE (All 24 Gaps)

| # | File | Line | Issue Type | Severity | Fix Effort |
|---|------|------|-----------|----------|-----------|
| 1 | offer.controller.ts | 59 | Path param: no UUID validation | HIGH | 1 line |
| 2 | offer.controller.ts | 78 | Path param: no UUID validation | HIGH | 1 line |
| 3 | offer.controller.ts | 112 | Path param: no UUID validation | HIGH | 1 line |
| 4 | offer.controller.ts | 130 | Path param: no UUID validation | HIGH | 1 line |
| 5 | category.controller.ts | 33 | Path param: no UUID validation | HIGH | 1 line |
| 6 | category.controller.ts | 48 | Path param: no UUID validation | HIGH | 1 line |
| 7 | promoCode.controller.ts | 13 | Path param: no UUID validation | HIGH | 1 line |
| 8 | promoCode.controller.ts | 37 | Path param: no UUID validation | HIGH | 1 line |
| 9 | promoCode.controller.ts | 60 | Path param: no UUID validation | HIGH | 1 line |
| 10 | employee.controller.ts | 14-17 | Manual pagination parsing | HIGH | Refactor to schema |
| 11 | employee.controller.ts | 112 | Uses manual parsePaging | HIGH | 1 line (call schema) |
| 12 | employee.controller.ts | 130 | Uses manual parsePaging | HIGH | 1 line (call schema) |
| 13 | employee.controller.ts | 147-148 | Manual body validation | MEDIUM | Create schema |
| 14 | employee.controller.ts | 48 | Path param: no UUID validation | HIGH | 1 line |
| 15 | employee.controller.ts | 22-36 | No pagination validation | MEDIUM | Add schema call |
| 16 | auth.controller.ts | 60 | Cookie not validated | MEDIUM | Create schema |
| 17 | auth.controller.ts | 89 | Cookie not validated | MEDIUM | Create schema |
| 18 | stripeWebhook.controller.ts | 7 | Header not validated | MEDIUM | Create schema |
| 19 | auth.controller.ts | 99 | Query param manual check | MEDIUM | Create schema |
| 20 | category.controller.ts | - | Read-only, OK | - | - |
| 21 | category.controller.ts | - | Read-only, OK | - | - |
| 22 | offer.controller.ts | 8 | Inline schema (duplication) | LOW | Move to schemas/ |
| 23 | test.routes.ts | 10 | Inline schema | LOW | Move to schemas/auth.schemas.ts |
| 24 | config.ts | - | No env var validation | MEDIUM | Create config.schema.ts |

---

## IMPLEMENTATION PRIORITY

### Phase 1: Critical Path Param Fixes (30 mins)
- Gaps 1-9, 14: Add UUID validation to 9 offer/category/promoCode controllers
- Change: `const id = req.params.id;` → `const id = idParamSchema.parse(req.params.id);`
- Import: `import { idParamSchema } from '../schemas/admin.schemas';`

### Phase 2: Query/Body Validation (45 mins)
- Gap 10: Replace parsePaging() with paginationQuerySchema
- Gap 13: Create redemptionUpdateSchema
- Gap 15: Add pagination schema to listEmployeesController
- Gap 19: Create emailVerificationTokenSchema

### Phase 3: Cookie/Header Validation (30 mins)
- Gap 16-17: Create refreshTokenSchema
- Gap 18: Create webhookSignatureSchema

### Phase 4: Consolidation (20 mins)
- Gap 22-23: Move inline schemas to centralized location
- Gap 24: Create config.schema.ts

**Total Effort**: ~2 hours

---

## CODE SNIPPETS FOR FIXES

### Fix Pattern 1: Path Param Validation (Used 9 times)

**Current**:
```typescript
export async function updateOfferController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (!id) {
      next(new AppError(400, 'ID de l\'offre requis.')); 
      return;
    }
    const data = updateOfferSchema.parse(req.body);
    const offer = await updateOffer(String(id), data);
```

**Fixed**:
```typescript
import { idParamSchema } from '../schemas/admin.schemas';

export async function updateOfferController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = idParamSchema.parse(req.params.id);
    const data = updateOfferSchema.parse(req.body);
    const offer = await updateOffer(id, data);
```

### Fix Pattern 2: Query Pagination (Replace parsePaging)

**Current**:
```typescript
const { page, limit } = parsePaging(req);
const result = await getEmployeeReceived(employeeId, page, limit);
```

**Fixed**:
```typescript
import { paginationQuerySchema } from '../schemas/admin.schemas';

const { page, limit } = paginationQuerySchema.parse(req.query);
const result = await getEmployeeReceived(employeeId, page, limit);
```

### Fix Pattern 3: Manual Body Validation → Zod

**Current**:
```typescript
const id = req.params.id;
const used = req.body?.used;
if (typeof id !== 'string' || typeof used !== 'boolean') {
  next(new AppError(400, 'Paramètres invalides (id, used booléen requis).'));
  return;
}
```

**Fixed**:
```typescript
// Add to schemas/employee.schemas.ts
export const redemptionUpdateSchema = z.object({
  used: z.boolean(),
});

// In controller
const id = idParamSchema.parse(req.params.id);
const { used } = redemptionUpdateSchema.parse(req.body);
```

### Fix Pattern 4: Header Validation

**Current**:
```typescript
const signature = req.headers['stripe-signature'];

let event: ReturnType<typeof stripe.webhooks.constructEvent>;
try {
  event = stripe.webhooks.constructEvent(
    req.body,
    signature as string,
    config.STRIPE_WEBHOOK_SECRET,
  );
```

**Fixed**:
```typescript
// Add to schemas/stripe.schemas.ts
export const webhookSignatureSchema = z.string().min(1);

// In controller
const signature = webhookSignatureSchema.parse(req.headers['stripe-signature']);

let event: ReturnType<typeof stripe.webhooks.constructEvent>;
try {
  event = stripe.webhooks.constructEvent(
    req.body,
    signature,
    config.STRIPE_WEBHOOK_SECRET,
  );
```
