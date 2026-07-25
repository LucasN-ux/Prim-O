# Action Plan - Zod Validation Gaps

## EXECUTIVE SUMMARY

**Total Issues Found**: 24 validation gaps across 9 files
**Current Validation Coverage**: ~65% of endpoints
**Critical Issues**: 14 (HIGH priority)
**Medium Issues**: 7
**Low Issues**: 3

**Recommended Implementation**: 2 hours for all critical + medium fixes

---

## QUICK REFERENCE: Files That Need Changes

### 1. `/home/mateo/prim-o/backend/src/schemas/admin.schemas.ts`
- **Current**: idParamSchema and paginationQuerySchema already defined
- **Action**: No changes needed - this is good
- **Status**: ✅ OK

### 2. `/home/mateo/prim-o/backend/src/schemas/auth.schemas.ts`
- **Add**: emailVerificationTokenSchema
- **Add**: refreshTokenSchema
- **Move**: verifyEmailSchema (currently in test.routes.ts)

### 3. `/home/mateo/prim-o/backend/src/schemas/offer.schemas.ts`
- **Add**: Nothing new needed (offerIdSchema = idParamSchema)
- **Note**: Remove duplicate offerIdSchema from offer.controller.ts

### 4. `/home/mateo/prim-o/backend/src/schemas/stripe.schemas.ts`
- **Add**: webhookSignatureSchema

### 5. NEW: `/home/mateo/prim-o/backend/src/schemas/employee.schemas.ts`
- **Create**: redemptionUpdateSchema

### 6. NEW: `/home/mateo/prim-o/backend/src/config.schema.ts`
- **Create**: Full environment variable validation

---

## IMPLEMENTATION CHECKLIST

### Phase 1: Add Missing Schemas (45 mins)

#### 1a. Extend auth.schemas.ts
- [ ] Add `emailVerificationTokenSchema = z.string().min(1)`
- [ ] Add `refreshTokenSchema = z.string().min(1)`
- [ ] Copy/import `verifyEmailSchema` from test.routes.ts

#### 1b. Extend stripe.schemas.ts
- [ ] Add `webhookSignatureSchema = z.string().min(1)`

#### 1c. Create employee.schemas.ts
- [ ] Create new file with `redemptionUpdateSchema = z.object({ used: z.boolean() })`

#### 1d. Create config.schema.ts
- [ ] Define schema for NODE_ENV, PORT, DATABASE_URL, STRIPE_WEBHOOK_SECRET, etc.
- [ ] Call validation at app.ts startup

---

### Phase 2: Fix Controllers - Path Params (30 mins)

All 9 of these use same pattern:

#### 2a. `/home/mateo/prim-o/backend/src/controllers/offer.controller.ts`
- [ ] Line 8: Remove local `offerIdSchema` definition
- [ ] Line 59: Change `const { id } = req.params;` → `const id = idParamSchema.parse(req.params.id);`
- [ ] Line 78: Same fix
- [ ] Line 112: Same fix
- [ ] Line 130: Same fix
- [ ] Add import: `import { idParamSchema } from '../schemas/admin.schemas';`

#### 2b. `/home/mateo/prim-o/backend/src/controllers/category.controller.ts`
- [ ] Line 33: Change `const { id } = req.params;` → `const id = idParamSchema.parse(req.params.id);`
- [ ] Line 48: Same fix
- [ ] Add import: `import { idParamSchema } from '../schemas/admin.schemas';`

#### 2c. `/home/mateo/prim-o/backend/src/controllers/promoCode.controller.ts`
- [ ] Line 13: Change `const { offerId } = req.params;` → `const offerId = idParamSchema.parse(req.params.offerId);`
- [ ] Line 37: Same fix
- [ ] Line 60: Change `const { id } = req.params;` → `const id = idParamSchema.parse(req.params.id);`
- [ ] Add import: `import { idParamSchema } from '../schemas/admin.schemas';`

#### 2d. `/home/mateo/prim-o/backend/src/controllers/employee.controller.ts`
- [ ] Line 48: Change `const id = req.params.id;` → `const id = idParamSchema.parse(req.params.id);`
- [ ] Add import: `import { idParamSchema } from '../schemas/admin.schemas';`

---

### Phase 3: Fix Controllers - Query Params (30 mins)

#### 3a. `/home/mateo/prim-o/backend/src/controllers/employee.controller.ts`
- [ ] Line 14-17: Remove `parsePaging()` function entirely
- [ ] Line 112: Change `const { page, limit } = parsePaging(req);` → `const { page, limit } = paginationQuerySchema.parse(req.query);`
- [ ] Line 130: Same change
- [ ] Add import: `import { paginationQuerySchema } from '../schemas/admin.schemas';`

#### 3b. `/home/mateo/prim-o/backend/src/controllers/auth.controller.ts`
- [ ] Line 99: Change `const token = typeof req.query.token === 'string' ? req.query.token : '';` → create schema
  ```typescript
  const emailVerificationQuery = z.object({ token: z.string().min(1) });
  const { token } = emailVerificationQuery.parse(req.query);
  ```
- [ ] Import from auth.schemas: `import { emailVerificationTokenSchema } from '../schemas/auth.schemas';`

---

### Phase 4: Fix Controllers - Body Validation (20 mins)

#### 4a. `/home/mateo/prim-o/backend/src/controllers/employee.controller.ts`
- [ ] Line 146-148: Replace manual type checking
  ```typescript
  // Remove:
  if (typeof id !== 'string' || typeof used !== 'boolean') {
    next(new AppError(400, 'Paramètres invalides (id, used booléen requis).'));
    return;
  }
  
  // Replace with:
  const id = idParamSchema.parse(req.params.id);
  const { used } = redemptionUpdateSchema.parse(req.body);
  ```
- [ ] Add imports: `import { redemptionUpdateSchema } from '../schemas/employee.schemas';`

---

### Phase 5: Fix Controllers - Cookies (15 mins)

#### 5a. `/home/mateo/prim-o/backend/src/controllers/auth.controller.ts`
- [ ] Line 60 (refreshController):
  ```typescript
  // Change from:
  const rawToken = req.cookies?.refreshToken;
  
  // To:
  const rawToken = refreshTokenSchema.parse(req.cookies?.refreshToken);
  ```
- [ ] Line 89 (logoutController): Same change
- [ ] Add import: `import { refreshTokenSchema } from '../schemas/auth.schemas';`

---

### Phase 6: Fix Controllers - Headers (15 mins)

#### 6a. `/home/mateo/prim-o/backend/src/controllers/stripeWebhook.controller.ts`
- [ ] Line 7:
  ```typescript
  // Change from:
  const signature = req.headers['stripe-signature'];
  
  // To:
  const signature = webhookSignatureSchema.parse(req.headers['stripe-signature']);
  ```
- [ ] Add import: `import { webhookSignatureSchema } from '../schemas/stripe.schemas';`

---

### Phase 7: Move Inline Schemas (15 mins)

#### 7a. Move verifyEmailSchema from test.routes.ts to auth.schemas.ts
- [ ] Delete from `/home/mateo/prim-o/backend/src/routes/test.routes.ts` line 10
- [ ] Add to `/home/mateo/prim-o/backend/src/schemas/auth.schemas.ts`
- [ ] Update import in test.routes.ts

#### 7b. Remove duplicate offerIdSchema from offer.controller.ts
- [ ] Delete line 8: `const offerIdSchema = z.uuid();`
- [ ] Ensure idParamSchema imported from admin.schemas

---

### Phase 8: Environment Validation (20 mins)

#### 8a. Create `/home/mateo/prim-o/backend/src/config.schema.ts`

```typescript
import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  CLIENT_URL: z.string().url(),
  // Add other required env vars
});

export type Config = z.infer<typeof configSchema>;

export function validateConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.errors);
    process.exit(1);
  }
  return result.data;
}
```

#### 8b. Update `/home/mateo/prim-o/backend/src/app.ts`
- [ ] Add call to validateConfig() at app startup
- [ ] Or move validation to server.ts before app.listen()

---

## TESTING CHECKLIST

After all fixes:

### Unit Tests
- [ ] Test idParamSchema with valid UUID
- [ ] Test idParamSchema with invalid UUID (should throw)
- [ ] Test paginationQuerySchema with valid page/limit
- [ ] Test paginationQuerySchema with invalid values
- [ ] Test refreshTokenSchema
- [ ] Test redemptionUpdateSchema
- [ ] Test webhookSignatureSchema

### Integration Tests (if they exist)
- [ ] Verify offer PATCH with malformed UUID → 400
- [ ] Verify category DELETE with malformed UUID → 400
- [ ] Verify promoCode operations with malformed UUID → 400
- [ ] Verify employee pagination with invalid page/limit → 400
- [ ] Verify webhook with missing stripe-signature → 400

### Manual Testing
- [ ] POST /api/auth/verify-email?token=invalid → should fail
- [ ] PATCH /api/admin/offers/invalid-id → should fail with 400
- [ ] GET /api/employees/me/received?page=abc → should fail with 400

---

## EFFORT ESTIMATE

| Phase | Task | Time | Cumulative |
|-------|------|------|-----------|
| 1 | Add missing schemas | 45 min | 45 min |
| 2 | Fix path params (9 locations) | 30 min | 75 min |
| 3 | Fix query params | 30 min | 105 min |
| 4 | Fix body validation | 20 min | 125 min |
| 5 | Fix cookies | 15 min | 140 min |
| 6 | Fix headers | 15 min | 155 min |
| 7 | Move inline schemas | 15 min | 170 min |
| 8 | Environment validation | 20 min | 190 min |
| - | Testing & verification | 30 min | 220 min |

**Total: ~3.5 hours** (can be parallelized to ~2.5 hours)

---

## SUCCESS CRITERIA

After implementation:
- [ ] All path params validated with idParamSchema
- [ ] All query params validated with appropriate Zod schemas
- [ ] All body params validated with Zod schemas
- [ ] Cookies validated (refreshToken)
- [ ] Headers validated (stripe-signature)
- [ ] No inline schemas in controllers
- [ ] Environment variables validated at startup
- [ ] All ~65 previously validated endpoints still passing
- [ ] All 24 gaps now properly validated (→100% coverage)
- [ ] No manual type checking (typeof) in request handlers
- [ ] Consistent 400 responses for malformed input (not 500)

---

## PRIORITY RANKING IF TIME-LIMITED

If you can only do some fixes:

### Must-Do (Critical) - 1 hour
1. Fix 9 path param validations (offer, category, promoCode, employee)
2. Fix parsePaging() → paginationQuerySchema
3. Fix manual redemption update validation

### Should-Do (High) - 45 mins
4. Fix refreshToken validation
5. Fix stripe-signature validation
6. Fix email verification token

### Nice-To-Do (Medium) - 45 mins
7. Move inline schemas
8. Create environment validation
9. Tests & verification

---

## RELATED FILES (Reference)

- Schemas currently defined: `/home/mateo/prim-o/backend/src/schemas/`
- Validation utility: `/home/mateo/prim-o/backend/src/lib/validation.ts`
- Error handling: `/home/mateo/prim-o/backend/src/middleware/error.middleware.ts`
- Route config: `/home/mateo/prim-o/backend/src/app.ts`

---

## NOTES

- `safeText()` custom validator from `lib/validation.ts` handles XSS + HTML sanitization ✅
- `idParamSchema` already exists in admin.schemas.ts - reuse everywhere
- `paginationQuerySchema` already exists in admin.schemas.ts - reuse everywhere
- Zod error responses automatically handled by error.middleware.ts ✅
- No need to change error handling middleware - Zod throws and Express 5 catches

---

## QUESTIONS FOR TEAM

1. Should environment validation fail hard (exit(1)) or soft (log warning)?
2. Do you want HTTP 400 or 422 for validation errors? (Currently 400)
3. Should we add custom error messages in Zod schemas for business logic?
4. Do integration tests exist? Where should new validation tests go?
5. Is there a code review process before merging?
