# Vulnérabilités Détaillées - Prim'O Audit

## 1. DEPENDENCY VULNERABILITIES - CRITICAL (FIX IMMÉDIATEMENT)

### HIGH - brace-expansion

**Affected**: Both backend and frontend

**CVE**: GHSA-3jxr-9vmj-r5cp

**Vulnerability**: DoS via exponential-time expansion of consecutive non-expanding {} groups

**Example Attack**:
```
Input: "{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{{}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}}"
Result: CPU spike, process hang
```

**Severity**: HIGH - Can crash server with simple input

**Fix**: 
```bash
cd backend && npm audit fix
cd frontend && npm audit fix
```

**Timeline**: ASAP (30 mins)

---

### MODERATE - body-parser

**Package**: body-parser 2.0.0-2.2.2

**Vulnerability**: Invalid limit value silently disables size enforcement

**Impact**: If someone sets `limit: "abc"` in express.json() config, size limit is silently ignored. File uploads larger than intended could be accepted.

**Current Config** (`/backend/src/app.ts:68`):
```typescript
app.use(express.json());  // Default limit: 100kb (safe)
```

**Status**: Safe in current codebase, but fix audit issue anyway

---

### MODERATE - morgan

**Package**: morgan 1.2.0-1.10.1

**Vulnerability**: Log Forging via unneutralized control characters in :remote-user

**Impact**: If request contains control characters in User-Agent or other fields, logs could be corrupted with newlines/escape sequences.

**Example Attack**:
```
User-Agent: "Mozilla/5.0\n[FAKE LOG]: Admin created user..."
Result: Malformed logs that look like admin actions
```

**Current Config** (`/backend/src/app.ts:61`):
```typescript
app.use(morgan(config.NODE_ENV === 'production' ? 'combined' : 'dev'));
```

**Status**: Low risk (logs are internal), but fix for completeness

---

## 2. ZOD VALIDATION GAPS - HIGH

### Gap Type A: Missing UUID Validation on Path Params

#### Location 1: `/backend/src/controllers/offer.controller.ts:59`

**Function**: `updateOfferController`

**Code**:
```typescript
const { id } = req.params;
if (!id) { next(new AppError(400, 'ID de l\'offre requis.')); return; }

// id is any string, could be:
// - "invalid-format" → Prisma error 500
// - "../../../etc/passwd" → path traversal attempt
// - "<script>" → log injection
```

**Fix**:
```typescript
import { offerIdSchema } from '../schemas/offer.schemas';

const id = offerIdSchema.parse(req.params.id); // Throws 400 automatically
```

**Impact**: Malformed input → 500 error instead of 400. User enumeration possible ("offer-1", "offer-2" returns 404 vs 500).

---

#### Location 2-4: `/backend/src/controllers/offer.controller.ts:78, 112, 130`

Same issue in:
- `deactivateOfferController`
- `uploadOfferImageController`
- `deleteOfferImageController`

**Combined Fix**: Create reusable middleware
```typescript
export async function offerIdParam(req: Request, res: Response, next: NextFunction) {
  try {
    req.params.id = offerIdSchema.parse(req.params.id);
    next();
  } catch (err) {
    next(err);
  }
}
```

---

#### Locations 5-6: `/backend/src/controllers/category.controller.ts:33, 48`

**Functions**:
- `updateCategoryController`
- `deactivateCategoryController`

**Same Pattern**:
```typescript
const { id } = req.params;
if (!id) { /* error */ }
// Missing: const id = idParamSchema.parse(req.params.id);
```

**Fix**: Apply same pattern as offers

---

#### Locations 7-9: `/backend/src/controllers/promoCode.controller.ts:13, 37, 60`

**Functions**:
- `listPromoCodesController` (offerId param)
- `addPromoCodesController` (offerId param)
- `deletePromoCodeController` (id param)

**Same Pattern** - Missing Zod validation on both `offerId` and `id`

---

#### Location 10: `/backend/src/controllers/employee.controller.ts:48`

**Function**: `deleteEmployeeController`

**Code**:
```typescript
const id = req.params.id;
if (typeof id !== 'string') { /* error */ }
// Missing: const id = z.uuid().parse(req.params.id);

await softDeleteEmployee(ctx.companyId, id);  // id could be any string
```

**Impact**: Database query doesn't validate UUID format. Prisma will reject, causing 500 instead of 400.

**Fix**:
```typescript
const id = z.uuid().parse(req.params.id);  // Throws 400 on invalid UUID
await softDeleteEmployee(ctx.companyId, id);
```

---

### Gap Type B: Manual Pagination Parsing

#### Location: `/backend/src/controllers/employee.controller.ts:14-17`

**Code**:
```typescript
function parsePaging(req: Request): { page: number; limit: number } {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  return { page, limit };
}
```

**Problems**:
1. No validation schema
2. `Number()` converts ANY value (e.g., "10abc" → 10, "-5" → 0 after Math.max)
3. No error messaging
4. Inconsistent with admin routes (which use Zod schema)

**Affected Endpoints**:
- `GET /api/employees` (line 31)
- `GET /api/employees/me/received` (line 85)
- `GET /api/employees/me/spent` (line 115)

**Fix**:
```typescript
import { paginationQuerySchema } from '../schemas/admin.schemas';

// In controllers:
const { page, limit } = paginationQuerySchema.parse(req.query);
```

---

### Gap Type C: Body Validation Issues

#### Location: `/backend/src/controllers/employee.controller.ts:147`

**Code**:
```typescript
export async function redeemRedemptionController(...) {
  // ... no schema validation
  const { redemptionId, used } = req.body;
  // `used` could be any value: "true", 1, null, {}
  await setRedemptionUsed(redemptionId, used);
}
```

**Expected Schema**:
```typescript
const redeemSchema = z.object({
  redemptionId: z.uuid(),
  used: z.boolean(),
});
```

---

## 3. AUTHENTICATION & COOKIES - MEDIUM

### Location: `/backend/src/controllers/auth.controller.ts:60, 89`

**Code**:
```typescript
export async function loginController(...) {
  // ... validate credentials
  const { accessToken, refreshToken } = await login(...);
  
  res.cookie('refreshToken', refreshToken);  // ❌ No schema validation
  res.json({ accessToken });
}
```

**Problems**:
1. Cookie value never validated/parsed on extraction
2. No HttpOnly/Secure/SameSite flags
3. Refresh token could be tampered with client-side

**Fix**:
```typescript
const refreshTokenSchema = z.string().length(64).regex(/^[a-f0-9]{64}$/);

export async function loginController(...) {
  const { accessToken, refreshToken } = await login(...);
  
  res.cookie('refreshToken', refreshToken, {
    httpOnly: true,      // Can't access from JS
    secure: config.NODE_ENV === 'production',  // HTTPS only in prod
    sameSite: 'strict',  // CSRF protection
    path: '/api/auth',   // Only sent to auth routes
  });
  res.json({ accessToken });
}
```

---

## 4. EMAIL VERIFICATION TOKEN - MEDIUM

### Location: `/backend/src/controllers/auth.controller.ts:99`

**Code**:
```typescript
export async function verifyEmailController(req: Request, res: Response, next: NextFunction) {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token) { next(new AppError(400, 'Token manquant.')); return; }
  
  try {
    await verifyEmail(token);  // token not validated
  }
}
```

**Problems**:
1. No format validation
2. `typeof` check is weak (could be "10" which will fail in service)
3. Should validate token length/format before DB query

**Fix**:
```typescript
const emailVerificationSchema = z.object({
  token: z.string().length(64).regex(/^[a-f0-9]{64}$/),
});

const { token } = emailVerificationSchema.parse({ token: req.query.token });
```

---

## 5. STRIPE WEBHOOK HEADER - MEDIUM

### Location: `/backend/src/controllers/stripeWebhook.controller.ts:7`

**Code**:
```typescript
export async function stripeWebhookController(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];
  
  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature as string,  // ❌ No validation
      config.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    res.status(400).send('Webhook signature verification failed');
    return;
  }
}
```

**Problems**:
1. `signature` could be undefined, array, or malformed
2. Stripe SDK might not handle all edge cases
3. No type coercion validation

**Fix**:
```typescript
const stripeSignatureSchema = z.object({
  'stripe-signature': z.string().min(1),
});

export async function stripeWebhookController(req: Request, res: Response): Promise<void> {
  const { 'stripe-signature': signature } = stripeSignatureSchema.parse(req.headers);
  
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, config.STRIPE_WEBHOOK_SECRET);
  }
}
```

---

## 6. ENVIRONMENT VARIABLES - LOW

### Location: `/backend/src/config.ts`

**Current**:
```typescript
const envSchema = z.object({
  PORT: z.string().default('4000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_URL: z.string().default('http://localhost:5180'),
  // ... etc
});

export const config = envSchema.parse(process.env);
```

**Status**: Actually GOOD! Zod validation is present.

**Potential Enhancement**:
- Validate CLIENT_URL is HTTPS in production
- Validate BREVO_SENDER_EMAIL is verified with Brevo

---

## 7. XSS - ERROR DETAIL ECHO - MINOR

### Location: `/backend/src/middleware/error.middleware.ts:61`

**Code**:
```typescript
[ErrorCode.COMPANY_RESTORE_EMAIL_CLASH]: {
  status: 409,
  message: (detail) => `Restauration impossible : email(s) déjà réutilisé(s) : ${detail ?? ''}.`,
},

// Called like:
throw new DomainError(
  ErrorCode.COMPANY_RESTORE_EMAIL_CLASH,
  conflictingEmails.join(', ')  // Could contain special chars
);
```

**Risk**: 
- JSON response includes emails (low risk)
- Emails are validated, so no XSS
- But pattern is not ideal

**Fix**:
```typescript
import sanitizeHtml from 'sanitize-html';

message: (detail) => {
  const sanitized = detail ? sanitizeHtml(detail, { allowedTags: [] }).trim() : '';
  return `Restauration impossible : email(s) déjà réutilisé(s) : ${sanitized}.`;
},
```

---

## 8. FILE UPLOAD - MAGIC BYTES - MINOR

### Location: `/backend/src/lib/upload.ts:34-37`

**Code**:
```typescript
const offerImageUpload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) cb(null, true);  // ❌ MIME type only
    else cb(new Error('INVALID_IMAGE_TYPE'));
  },
}).single('image');
```

**Problems**:
1. MIME type can be spoofed
2. Client could rename "malware.exe" to "image.jpg" and set MIME type
3. Multer trusts MIME type, not file content

**Example Attack**:
```
1. Attacker uploads PHP shell as "shell.jpg"
2. Sets Content-Type: image/jpeg
3. Multer accepts it
4. If `/uploads` is somehow made executable, shell runs
```

**Current Safety**: 
- `/uploads` served statically (not executable)
- File extension doesn't match content
- No direct risk, but not best practice

**Fix** (hardening):
```bash
npm install file-type
```

```typescript
import { fileTypeFromBuffer } from 'file-type';

fileFilter: async (_req, file, cb) => {
  if (!ALLOWED.has(file.mimetype)) {
    cb(new Error('INVALID_IMAGE_TYPE'));
    return;
  }
  
  // Double-check magic bytes
  // Note: This requires converting multer to use stream + buffering
  cb(null, true);
  // Full implementation: check in uploadOfferImageController after Multer
}
```

---

## SUMMARY TABLE

| ID | Category | File:Line | Severity | Status | Fix Time |
|----|----------|-----------|----------|--------|----------|
| 1 | Dependencies | package.json | CRITICAL | Open | 30 min |
| 2 | Zod Param | offer.controller:59 | HIGH | Open | 10 min |
| 3 | Zod Param | offer.controller:78 | HIGH | Open | 10 min |
| 4 | Zod Param | offer.controller:112 | HIGH | Open | 10 min |
| 5 | Zod Param | offer.controller:130 | HIGH | Open | 10 min |
| 6 | Zod Param | category.controller:33 | HIGH | Open | 10 min |
| 7 | Zod Param | category.controller:48 | HIGH | Open | 10 min |
| 8 | Zod Param | promoCode.controller:13 | HIGH | Open | 10 min |
| 9 | Zod Param | promoCode.controller:37 | HIGH | Open | 10 min |
| 10 | Zod Param | promoCode.controller:60 | HIGH | Open | 10 min |
| 11 | Zod Param | employee.controller:48 | HIGH | Open | 10 min |
| 12 | Zod Manual | employee.controller:14-17 | HIGH | Open | 15 min |
| 13 | Zod Body | employee.controller:147 | HIGH | Open | 15 min |
| 14 | Cookies | auth.controller:60,89 | MEDIUM | Open | 30 min |
| 15 | Email Token | auth.controller:99 | MEDIUM | Open | 15 min |
| 16 | Stripe Header | stripeWebhook:7 | MEDIUM | Open | 15 min |
| 17 | XSS Detail | error.middleware:61 | MINOR | Open | 5 min |
| 18 | File Upload | upload.ts:34 | MINOR | Open | 30 min |

**Total Fix Time**: 3-4 hours for all issues

