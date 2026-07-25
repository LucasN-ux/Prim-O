# Audit Performance et DoS Prevention - Prim'O

## RATE LIMITING

### ✅ EXISTANT
- `app.ts:49-56`: Global limiter 300 req/min
- `rateLimit.ts:11-44`: Limiters spécifiques
  - Login: 10/15min
  - Refresh: 20/1min
  - Generate code: 10/1min
  - Password reset: 5/15min

### ⚠️ MANQUANT
- Pas de rate limit sur upload fichiers (multer OK, mais pas de throttle réseau)
- Pas de rate limit sur certaines routes critiques de stats/admin

---

## REQUEST SIZE LIMITS

### ✅ BON
- `upload.ts:33`: 2 MB limit sur upload images
- `app.ts:68`: `express.json()` (par défaut 100 KB)
- Multer validation stricte mime-type

### ⚠️ PAS TESTÉ
- POST/PUT JSON body size limite? (Express 5 défaut 100KB)
- Pas de `express.urlencoded()` = risque minimal

---

## QUERY LIMITS & PAGINATION

### ✅ PAGINÉ
- `employee.service.ts:54-87`: `getEmployeeReceived/Spent` (skip/take)
- `admin.service.ts:21-36`: `listCompanies` (default limit=20, max=100)
- `admin.service.ts:40-62`: `listAttributions` (default limit=20, max=100)
- `admin.service.ts:189-207`: `listUsers` (default limit=20, max=100)

### 🔴 NON PAGINÉ - RISQUE!
- `attribution.service.ts:197-223`: `listManagerEnvelopes()` - findMany SANS skip/take
- `attribution.service.ts:227-248`: `listSentEnvelopes()` - findMany SANS skip/take
- `attribution.service.ts:280-293`: `listAttributionsByCompany()` - findMany SANS skip/take
- `employee.service.ts:6-19`: `listEmployeesByEmployer()` - findMany SANS skip/take
- `offer.service.ts:8-32`: `listOffers()` - findMany SANS skip/take (enrichi avec 2 groupBy)
- `offer.service.ts:83-105`: `listActiveOffers()` - findMany SANS skip/take
- `privacy.service.ts:34-65`: `exportUserData()` - findMany 3x SANS skip/take (export illimité!)

---

## MEMORY LEAKS

### 🟡 TIMERS
- `tokenCleanup.ts:34-37`: `setInterval()` OK, `timer.unref()` ✅
- `inactiveAccountCleanup.ts:35-38`: `setInterval()` OK, `timer.unref()` ✅

### 🟡 EVENT LISTENERS
- `App.tsx:17-18`: `addEventListener/removeEventListener` pair OK ✅
- `ConfirmDialog.tsx`: `addEventListener/removeEventListener` pair OK ✅

### 🔴 MEMORY LEAK!
- `MyPromoCodes.tsx:46`: `setTimeout()` SANS cleanup - appel chaque copie
  ```tsx
  setTimeout(() => setCopied(...), 2000); // NO CLEANUP!
  ```
  Si un utilisateur copie 100 codes rapidement, 100 timers en mémoire.

---

## CPU-INTENSIVE OPERATIONS

### ⚠️ JOBS LENTS
- `inactiveAccountCleanup.ts:26-28`: BOUCLE par utilisateur, 1 transaction/user!
  ```ts
  for (const { id } of candidates) {
    await prisma.$transaction((tx) => anonymizeUser(tx, id));
  }
  ```
  = O(N) transactions = lent pour 10k comptes inactifs.

### ✅ PAS DE CALCUL LOURD
- `retribution.ts`: Math simple (division/pourcentage)
- `stats.service.ts`: Aggregation en SQL via groupBy/raw queries

---

## DATABASE CONNECTION POOLING

### ✅ PRÉSENT
- `db.ts:5-11`: `PrismaClient` singleton réutilisé (pas de leak de connexions en dev)
- Prisma gère le pool par défaut (10 connexions)

### ⚠️ PAS VU EXPLICITEMENT
- Pas de `maxRequestsPerConnection`, `maxIdleConnectionDuration` configurés
- Prisma defaults = souvent suffisant

---

## CACHE & INVALIDATION

### 🔴 PAS DE CACHE!
- HTTP headers: pas de `Cache-Control`, ETag disactivé
- `app.ts:35`: `app.set('etag', false)` = pas de 304 possible (délibéré, API dynamic)
- Response cache layer: NONE
- Database query cache: NONE

---

## COMPRESSION & BUNDLING

### 🔴 PAS DE GZIP
- Backend: no `compression` middleware
- Frontend: Vite ne configure pas gzip (Vercel/Render le fait en production)
- JSON responses: UNCOMPRESSED

### ✅ FRONTEND OK
- Vite build minification ✅
- Tree-shaking ✅
- PWA plugin configuré (caching assets)

---

## DATABASE INDICES

### ⚠️ INDICES CRITIQUES MANQUANTS
Requêtes avec `orderBy { createdAt }` SANS index:

1. `attribution.service.ts:200`: Allocation findMany orderBy createdAt (table Allocation)
2. `attribution.service.ts:230`: Allocation findMany orderBy createdAt
3. `attribution.service.ts:283`: Attribution findMany orderBy createdAt (table Attribution - HAS index ✅)
4. `employee.service.ts:9`: User findMany orderBy createdAt (table User - HAS index ✅)
5. `offer.service.ts:10`: PartnerOffer findMany orderBy createdAt (table PartnerOffer - NO index ❌)
6. `offer.service.ts:86`: PartnerOffer findMany orderBy createdAt (table PartnerOffer - NO index ❌)

### Index présents:
```
User: [companyId], [email] ✅
Attribution: [companyId], [employeeId], [managerId], [motifId], [allocationId] ✅
PartnerOffer: [categoryId], [isActive] (but NOT on createdAt) ❌
Allocation: [companyId], [managerId] (but NOT on createdAt) ❌
PromoCode: [offerId], [isUsed] ✅
RefreshToken, EmailVerificationToken: [userId] ✅
CompanyTokenPurchase: [companyId], [createdById] ✅
```

### ACTION REQUIRED:
- Add index on `Allocation(createdAt)`
- Add index on `PartnerOffer(createdAt)`
- Add composite index on `Attribution(companyId, createdAt DESC)` for faster filtering

---

## N+1 QUERY ISSUES

### ✅ FIXED
- `stats.service.ts:18-282`: Zero N+1, all groupBy/aggregations optimized

### 🔴 POTENTIAL N+1
- `listManagerEnvelopes()`: Computes `retribution` per envelope inside loop
  ```ts
  allocations.map((a) => {
    const retribution = computeRetribution(...); // Per row, but it's a function call (OK)
  });
  ```
  = Actually OK (computation not query).

### ✅ NO EAGER-LOADING ISSUES
- Privacy exports DO include relations (ok for now, but unbounded)

---

## CONCURRENT CONNECTIONS

### ⚠️ NO LIMITS
- No connection pooling limit exposed to routes
- No concurrent request limiter per IP/user
- Refresh limiter exists but low (20/min = 1 per 3 sec max)

---

## SLOW QUERIES & LOGGING

### 🔴 NO SLOW QUERY DETECTION
- `server.ts`: Morgan logs requests (dev/prod)
- No query performance monitoring
- Prisma logs disabled by default in prod

---

## LOAD TESTING RESULTS
- None found in repo

---

## FRONTEND SPECIFIC

### 🔴 NO ABORT CONTROLLER
- `client.ts`: All fetch() calls without AbortSignal
- Long navigations = orphaned requests stay in memory

### 🔴 MEMORY LEAK IN COPY HANDLER
- `MyPromoCodes.tsx:46`: `setTimeout` without cleanup

### ✅ CLEANUP OK
- Main App: `addEventListener` properly removed ✅
- ConfirmDialog: `addEventListener` properly removed ✅

---

## SUMMARY MATRIX

| Category | Status | Severity |
|----------|--------|----------|
| Rate Limiting | Partial | Low |
| Request Size | Good | - |
| Pagination | **Incomplete** | **High** |
| Memory Leaks | 1 found | Medium |
| CPU Intensive | 1 loop issue | Medium |
| Connection Pool | OK | - |
| Cache | None | Medium |
| Compression | Missing | Low |
| Indices | **Missing 2 tables** | **High** |
| N+1 Queries | None critical | - |
| Async Cleanup | 1 issue | Medium |
| AbortController | **Missing** | **High** |

