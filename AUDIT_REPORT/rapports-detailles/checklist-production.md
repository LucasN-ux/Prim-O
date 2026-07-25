# ✅ CHECKLIST PRÉ-PRODUCTION COMPLÈTE

**Avant de déployer Prim'O en production, vérifier TOUS les items.**

---

## 🔴 CRITIQUES (Must Fix - 45 mins)

### Erreur Handling
- [ ] **Stripe webhook:** Add logging + error handling (stripeWebhook.controller.ts:26)
  ```ts
  try { await fulfillOrder(...); } catch(err) { 
    console.error('Stripe fulfillment failed:', err); 
    return res.status(500).json({error: 'fulfillment_failed'});
  }
  ```

- [ ] **Brevo timeout:** Add AbortController (mail.ts:21)
  ```ts
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(BREVO_ENDPOINT, {..., signal: controller.signal});
  clearTimeout(timeout);
  ```

- [ ] **Process crash:** Add unhandledRejection handler (server.ts)
  ```ts
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
    // Alert ops, but don't crash
  });
  ```

- [ ] **Graceful shutdown:** Add SIGTERM handler (server.ts)
  ```ts
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down gracefully...');
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
  });
  ```

- [ ] **Permissions:** Block manager self-allocation (attribution.controller.ts:53)
  ```ts
  if (ctx.role !== 'OWNER') {
    throw new AppError(403, 'Only owners can allocate envelopes');
  }
  ```

---

## 🟠 IMPORTANTS (Before Deploy - 2-3h)

### Business Logic
- [ ] **Company status:** Validate APPROVED in joinCompany (auth.service.ts:87)
  ```ts
  // After finding company from invite code:
  if (company.status !== 'APPROVED') {
    throw new DomainError(ErrorCode.COMPANY_NOT_APPROVED);
  }
  ```

- [ ] **Invite code revocation:** Auto-revoke on REJECTED (admin.service.ts)
  ```ts
  if (newStatus === 'REJECTED') {
    await prisma.companyInviteCode.updateMany({
      where: { companyId: id },
      data: { revokedAt: new Date() }
    });
  }
  ```

### Pagination & DOS Prevention
- [ ] **listManagerEnvelopes:** Add pagination (attribution.service.ts:197)
  ```ts
  const { skip, take } = extractPaginationParams(req.query, 1, 20);
  ```

- [ ] **listSentEnvelopes:** Add pagination (attribution.service.ts:227)

- [ ] **listAttributionsByCompany:** Add pagination (attribution.service.ts:280)

- [ ] **listEmployeesByEmployer:** Add pagination (employee.service.ts:6)

- [ ] **listOffers (Admin):** Add pagination (offer.service.ts:8)

- [ ] **listActiveOffers (Public):** Add pagination (offer.service.ts:83)

- [ ] **exportUserData (GDPR):** Limit to 1000 rows (privacy.service.ts:34)

### Configuration
- [ ] **Frontend API_URL:** Set VITE_API_URL (frontend/.env.production)
  ```
  VITE_API_URL=https://primo-backend.onrender.com
  ```

- [ ] **Render.yaml:** Add API_URL variable
  ```yaml
  - key: API_URL
    value: "https://primo-backend.onrender.com"
  ```

- [ ] **render.yaml:** Add CLIENT_URL
  ```yaml
  - key: CLIENT_URL
    value: "https://prim-o.vercel.app"
  ```

---

## 🟡 CONFIG & SECRETS (1h)

### Secrets Management
- [ ] **npm audit:** Fix vulnerabilities (especially brace-expansion)
  ```bash
  cd backend && npm audit fix
  cd ../frontend && npm audit fix
  ```

- [ ] **.env.local:** Remove from git (already in .gitignore, verify)
  ```bash
  git rm --cached frontend/.env.local
  ```

- [ ] **Rotate secrets:** Regenerate all tokens/keys
  - New JWT_SECRET
  - New STRIPE_SECRET_KEY (use live key, not test)
  - New BREVO_API_KEY
  - Regenerate Vercel OIDC token

### Database
- [ ] **Add 17 missing indexes** (see DATABASE_AUDIT_COMPLET.md)
  ```sql
  CREATE INDEX idx_company_status ON "Company"(status);
  CREATE INDEX idx_user_role ON "User"(role);
  CREATE INDEX idx_allocation_created_at ON "Allocation"(createdAt);
  -- ... (see full list in DATABASE_AUDIT_COMPLET.md)
  ```

- [ ] **Run migrations:** Ensure all migrations applied
  ```bash
  cd backend && npx prisma migrate deploy
  ```

### Environment
- [ ] **.env.example:** Updated with all required vars
- [ ] **Health check:** Verify all dependencies
  ```bash
  curl http://localhost:4000/health
  # Should verify: DB, Brevo, Stripe connectivity
  ```

---

## 🟢 TESTING (Before Deploy)

### Unit Tests
- [ ] Backend: `npm test` - All pass
- [ ] Frontend: `npm test` - All pass
- [ ] Coverage: Minimum 80%

### Integration Tests
- [ ] Authentication flow (register, verify, login, refresh, logout)
- [ ] Payment flow (checkout, webhook, token purchase)
- [ ] Allocation flow (allocate, distribute, redeem)
- [ ] State transitions (company PENDING → APPROVED → REJECTED)

### Manual Tests
- [ ] joinCompany with APPROVED company → ✅ Works
- [ ] joinCompany with REJECTED company → ❌ Blocked
- [ ] Manager allocate envelope to self → ❌ Blocked
- [ ] GDPR export → Limited to 1000 rows
- [ ] Email verification → Works with Brevo
- [ ] Stripe checkout → Works end-to-end

### Load Testing
- [ ] **Peak load:** Can handle 10x normal traffic
- [ ] **Response times:** P95 < 500ms
- [ ] **DB connections:** Not exhausted at peak

---

## 🔒 SECURITY CHECKLIST

### HTTP Headers
- [ ] Helmet enabled (all security headers)
- [ ] CORS configured (whitelist origins)
- [ ] HTTPS enforced (redirect HTTP → HTTPS)
- [ ] HSTS header present

### Authentication
- [ ] JWT tokens not logged (grep for console.log token)
- [ ] Passwords hashed with bcrypt (salt rounds >= 10)
- [ ] Refresh tokens httpOnly + Secure + SameSite
- [ ] Token expiration times correct

### Data Protection
- [ ] Sensitive data encrypted (passwords, tokens)
- [ ] No PII in URLs/params
- [ ] Error messages don't expose internals
- [ ] Stack traces not visible in production

### Third-party
- [ ] Stripe webhook signature verified
- [ ] Stripe API key not hardcoded
- [ ] Brevo API key not hardcoded
- [ ] Database credentials not hardcoded

---

## 🚀 DEPLOYMENT CHECKLIST

### Before Deploy
- [ ] **Backup database** (if prod exists)
- [ ] **Rollback plan documented** (how to revert)
- [ ] **Deployment steps documented** (step-by-step)
- [ ] **All tests passing** (CI/CD green)

### During Deploy
- [ ] **Monitor logs** (watch for errors)
- [ ] **Health check** (verify services up)
- [ ] **Smoke tests** (quick manual checks)

### After Deploy
- [ ] **Verify API working** (test endpoints)
- [ ] **Verify email sending** (test verification)
- [ ] **Verify payments** (test Stripe)
- [ ] **Monitor errors** (check error tracking)
- [ ] **Monitor performance** (check dashboards)

---

## 📋 MONITORING & OBSERVABILITY

- [ ] **Error tracking:** Sentry (or similar) configured
- [ ] **Logging:** Centralized (not just console)
- [ ] **Metrics:** Request count, latency, errors
- [ ] **Alerts:** Critical errors → Slack/email
- [ ] **Health checks:** Database, Brevo, Stripe
- [ ] **Slow queries:** Logged and monitored

---

## 📚 DOCUMENTATION

- [ ] **README:** Up-to-date with setup/deploy steps
- [ ] **API docs:** Endpoint documentation
- [ ] **Database schema:** Documented
- [ ] **Architecture:** Diagram present
- [ ] **Environment variables:** .env.example complete
- [ ] **Troubleshooting:** Common issues documented

---

## ✅ FINAL SIGN-OFF

- [ ] **Product Owner:** Approves feature set
- [ ] **Tech Lead:** Approves architecture
- [ ] **Security:** Approves security measures
- [ ] **DevOps:** Approves deployment plan
- [ ] **QA:** Signs off on testing

---

## 🎯 SUMMARY

- **Total Items:** 50+
- **Est. Time:** 4-5 hours
- **Status:** Start with CRITIQUES (45 mins), then IMPORTANTS

**Once ALL items checked, you're ready to deploy! 🚀**
