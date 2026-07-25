# 🐛 BUG TRACKER - PRIM'O

**Last Updated:** 2026-07-21  
**Total Bugs Found:** ~80  
**Bugs Fixed:** 5  
**Bugs Remaining:** ~75

---

## ✅ BUGS FIXÉS (5)

### 🔴 CRITIQUES - FIXÉS

| # | Bug | Fichier | Fix | Commit | Status |
|---|-----|---------|-----|--------|--------|
| 1 | Stripe webhook errors silencieux | `backend/src/controllers/stripeWebhook.controller.ts:26` | Ajouter logging (error, sessionId, stack) | `6ce267a` | ✅ FIXÉ |
| 2 | Brevo email timeout manquant | `backend/src/lib/mail.ts:21` | Ajouter AbortController 10s timeout | `6ce267a` | ✅ FIXÉ |
| 3 | No unhandledRejection handler | `backend/src/server.ts` | Ajouter `process.on('unhandledRejection')` | `6ce267a` | ✅ FIXÉ |
| 4 | No graceful shutdown | `backend/src/server.ts` | Ajouter SIGTERM handler + Prisma disconnect | `6ce267a` | ✅ FIXÉ |
| 5 | Managers can self-allocate | `backend/src/services/attribution.service.ts:68` | Valider creator est OWNER | `6ce267a` | ✅ FIXÉ |

**Status:** ✅ Committés en local (commit `6ce267a`)  
**Besoin de tester:** OUI - vérifier que les fixes fonctionnent

---

## 📋 PROCHAINS BUGS À FIXER (Phase 2 - 2-3h)

### 🟠 IMPORTANTS - BUSINESS LOGIC (6 bugs)

| # | Bug | Fichier | Priority | Status |
|---|-----|---------|----------|--------|
| 6 | Users peuvent rejoindre company REJECTED | `backend/src/services/auth.service.ts:87` | HIGH | ⏳ TODO |
| 7 | Invite codes non révoqués si company REJECTED | `backend/src/services/admin.service.ts` | HIGH | ⏳ TODO |
| 8 | Allocations orphelines si manager supprimé | `backend/src/services/admin.service.ts` | HIGH | ⏳ TODO |
| 9 | Allocations orphelines si company supprimée | `backend/src/services/admin.service.ts` | HIGH | ⏳ TODO |
| 10 | Manager demotion avec allocations pending | `backend/src/services/admin.service.ts` | MEDIUM | ⏳ TODO |
| 11 | Admin peut réduire prix des offres | `backend/src/schemas/offer.schemas.ts` | MEDIUM | ⏳ TODO |

**Référence:** `AUDIT_REPORT/07_AUDIT_TRANSITIONS_ETAT.md`

---

### 🟠 IMPORTANTS - PAGINATION & DOS (7 bugs)

| # | Bug | Fichier | Priority | Status |
|---|-----|---------|----------|--------|
| 12 | listManagerEnvelopes sans pagination | `backend/src/services/attribution.service.ts:197` | CRITICAL | ⏳ TODO |
| 13 | listSentEnvelopes sans pagination | `backend/src/services/attribution.service.ts:227` | CRITICAL | ⏳ TODO |
| 14 | listAttributionsByCompany sans pagination | `backend/src/services/attribution.service.ts:280` | CRITICAL | ⏳ TODO |
| 15 | listEmployeesByEmployer sans pagination | `backend/src/services/employee.service.ts:6` | CRITICAL | ⏳ TODO |
| 16 | listOffers (Admin) sans pagination | `backend/src/services/offer.service.ts:8` | CRITICAL | ⏳ TODO |
| 17 | listActiveOffers (Public) sans pagination | `backend/src/services/offer.service.ts:83` | CRITICAL | ⏳ TODO |
| 18 | GDPR export sans limite | `backend/src/services/privacy.service.ts:34` | HIGH | ⏳ TODO |

**Référence:** `AUDIT_REPORT/10_audit-report.md`

---

### 🟠 IMPORTANTS - CONFIGURATION (3 bugs)

| # | Bug | Fichier | Priority | Status |
|---|-----|---------|----------|--------|
| 19 | Frontend API_URL cassée | `frontend/.env.production` | CRITICAL | ⏳ TODO |
| 20 | render.yaml missing API_URL | `render.yaml` | CRITICAL | ⏳ TODO |
| 21 | render.yaml missing CLIENT_URL | `render.yaml` | HIGH | ⏳ TODO |

**Référence:** `AUDIT_REPORT/03_CHECKLIST_PROD.md` (lignes 94-109)

---

## 🔍 BUGS RESTANTS PAR CATÉGORIE

### 🟡 DATABASE & INDEXES (24 bugs)
- 17 missing indexes (performance dégradée)
- 4 missing constraints (data inconsistency)
- 1 N+1 query (perf bottleneck)
- 1 GDPR violation (password reset tokens)
- 1 other issue

**Référence:** `AUDIT_REPORT/08_DATABASE_AUDIT_COMPLET.md`

---

### 🟡 ERROR HANDLING & LOGGING (17 bugs)
- 3 errors silencieux (lost data)
- 3 timeout manquants (hangs)
- 5 logging manquant (no observability)
- 3 retry logic (reliability)
- 3 monitoring (blind ops)

**Référence:** `AUDIT_REPORT/09_audit_findings.md`

---

### 🟡 SECURITY & VALIDATION (24 bugs)
- 14 Zod validation gaps
- 1 CSRF missing
- 1 Cookie flags incorrect
- 1 File upload validation
- 3 XSS risks
- 4 Other

**Référence:** `AUDIT_REPORT/12_zod-audit-results.md`, `AUDIT_REPORT/11_SECURITY_AUDIT_FINAL.md`

---

### 🟢 TECH DEBT & MINORS (26 bugs)
- 2 Vite config
- 1 Console logging
- 1 Build verification
- 2 Rate limiting
- 1 Frontend caching
- 19 Other

**Référence:** `AUDIT_REPORT/06_action-plan.md`

---

## 🧪 COMMENT VÉRIFIER LES 5 BUGS FIXÉS?

### Bug #1: Stripe Webhook Logging
**Test:**
1. Mock Stripe webhook avec erreur (ex: DB unavailable)
2. Vérifier que `console.error` est appelé avec:
   - `sessionId` du checkout
   - Message d'erreur
   - Stack trace
3. Vérifier que response est 500

**Fichier:** `backend/src/controllers/stripeWebhook.controller.ts:26`

---

### Bug #2: Brevo Timeout
**Test:**
1. Mock Brevo qui ne répond pas (delay > 10s)
2. Vérifier que fetch timeout après 10s
3. Vérifier que `clearTimeout` est appelé
4. Vérifier que l'erreur est throwée

**Fichier:** `backend/src/lib/mail.ts:21`

---

### Bug #3: Unhandled Rejection
**Test:**
1. Émettre une promise rejection non catchée
2. Vérifier que `process.on('unhandledRejection')` est appelé
3. Vérifier que console.error log le reason
4. Vérifier que process ne crash pas

**Fichier:** `backend/src/server.ts`

---

### Bug #4: Graceful Shutdown
**Test:**
1. Envoyer SIGTERM au process
2. Vérifier que `server.close()` est appelé
3. Vérifier que Prisma `$disconnect()` est appelé
4. Vérifier que le timeout 30s fonctionne
5. Vérifier que `process.exit(0)` est appelé

**Fichier:** `backend/src/server.ts`

---

### Bug #5: Manager Self-Allocation
**Test:**
1. Essayer d'allouer comme MANAGER (devrais échouer)
   - Attendu: `UNAUTHORIZED` error
2. Essayer d'allouer comme OWNER (devrais réussir)
   - Attendu: allocation créée
3. Vérifier que le creator check au service level fonctionne

**Fichier:** `backend/src/services/attribution.service.ts:68`

---

## 📋 PLAN SUIVANT

### Phase 2: CRITICAL (2-3h)
**À faire ensuite (après tests des 5 premiers):**

1. **Business Logic (6 bugs - 1h)**
   - Fix company status validation in joinCompany
   - Fix invite code revocation on REJECTED
   - Fix allocations orphelines (manager/company deletion)

2. **Pagination DOS Prevention (7 bugs - 1-2h)**
   - Add pagination to 7 endpoints (20 rows par défaut, max 100)
   - GDPR export limit 1000 rows

3. **Configuration (3 bugs - 30 mins)**
   - Create `frontend/.env.production` with VITE_API_URL
   - Update `render.yaml` with API_URL and CLIENT_URL

---

## 📊 COMMIT HISTORY

| Commit | Message | Bugs |
|--------|---------|------|
| `4d1fade` | docs: add comprehensive audit report | - |
| `6ce267a` | fix: resolve 5 critical bugs | 1-5 |
| (next) | (Phase 2 fixes) | 6-21 |

---

**Status:** ✅ Phase 1 COMPLÈTE  
**Prêt pour:** Phase 2 (après tests)

