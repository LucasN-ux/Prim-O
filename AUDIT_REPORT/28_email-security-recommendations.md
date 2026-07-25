# Email Security - Recommendations & Improvements

## Status: Currently EXCELLENT ✅

The email injection surface is secure. This document outlines optional defense-in-depth improvements.

---

## 1. Improve Brevo Error Logging (Priority: LOW)

**Location:** `/home/mateo/prim-o/backend/src/lib/mail.ts:36-39`

**Current Code:**
```typescript
if (!res.ok) {
  const body = await res.text();
  throw new Error(`BREVO_SEND_FAILED: ${res.status} ${body}`);
}
```

**Issue:**
- If Brevo returns verbose error message, it could leak API configuration
- Example: `BREVO_SEND_FAILED: 401 Invalid API key: sk_...`

**Recommendation:**
```typescript
if (!res.ok) {
  // Log full error for debugging (backend logs only)
  console.error(
    `[mail] Brevo API error ${res.status}`,
    { endpoint: BREVO_ENDPOINT, status: res.status }
  );
  
  // Throw generic error (safe for error handlers & logging)
  throw new Error(`BREVO_SEND_FAILED: ${res.status}`);
}
```

**Benefit:** Generic errors prevent accidental credential leakage in logs/monitoring

---

## 2. Add Email HTML Sanitization (Priority: VERY LOW)

**Location:** `/home/mateo/prim-o/backend/src/lib/mail.ts:46-51, 59-64`

**Current Code:**
```typescript
const html = `
  <p>Bienvenue sur Prim'O !</p>
  <p>Confirme ton adresse email en cliquant sur ce lien :</p>
  <p><a href="${link}">Vérifier mon adresse email</a></p>
  <p>Ce lien expire dans 24 heures.</p>
`;
```

**Why it's safe now:**
- HTML is hardcoded
- Only variable: `link` (server-generated + encodeURIComponent)
- No user input concatenated

**Defense-in-Depth (Future-Proofing):**
```typescript
import sanitizeHtml from 'sanitize-html'; // Already a dependency!

export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  // Sanitize HTML as extra layer (defensive)
  const sanitizedHtml = sanitizeHtml(html, {
    allowedTags: ['p', 'a', 'br', 'b', 'i', 'u', 'strong', 'em'],
    allowedAttributes: { a: ['href'] },
    selfClosing: ['br'],
  });

  // ... rest of code ...
}
```

**Trade-off:**
- Minimal performance impact (HTML is small)
- Adds defense-in-depth if future code changes
- 100% compatible with current hardcoded templates

**Status:** Nice-to-have, not critical

---

## 3. Structured Logging for Audit Trail (Priority: MEDIUM)

**Location:** `/home/mateo/prim-o/backend/src/lib/mail.ts` + Services

**Current State:**
```typescript
console.log(`[mail:dev] BREVO_API_KEY absente → email NON envoyé à ${to}`);
```

**Improvement:**
```typescript
// In sendEmail()
async function sendEmail({ to, subject, html }: SendEmailInput): Promise<void> {
  const emailId = crypto.randomUUID(); // Track this send attempt
  
  const logContext = {
    emailId,
    timestamp: new Date().toISOString(),
    recipient: to,
    subject,
    size: html.length,
  };

  if (!config.BREVO_API_KEY) {
    console.log('[mail:dev] Email not sent', logContext);
    return;
  }

  try {
    // ... Brevo API call ...
    console.log('[mail:sent] Email sent successfully', { ...logContext, status: 200 });
  } catch (error) {
    console.error('[mail:error] Email send failed', {
      ...logContext,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// In services (auth.service.ts)
export async function register(input: RegisterInput) {
  // ... user creation ...
  
  try {
    await sendVerificationEmail(user.email, raw);
    console.log('[auth:email:sent] Verification email queued', {
      userId: user.id,
      recipient: user.email,
    });
  } catch (error) {
    console.error('[auth:email:failed] Verification email failed', {
      userId: user.id,
      recipient: user.email,
    });
    // Note: We don't throw - signup succeeds even if email fails
  }
}
```

**Benefits:**
- Email delivery audit trail
- Email ID to trace through logs
- Structured format for log aggregation (ELK, CloudWatch, etc)
- Helps detect patterns (spam, brute force)

---

## 4. Add Email Validation Tests (Priority: HIGH)

**Location:** Create `/home/mateo/prim-o/backend/tests/integration/auth.email-security.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('Email Security & Injection Prevention', () => {
  describe('BCC/CC Injection', () => {
    it('should reject BCC injection in registration email', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'attacker@example.com\r\nBCC: hacker@hacker.com',
          password: 'SecurePass123',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('should reject CC injection in forgot-password', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({
          email: 'victim@example.com\r\nCC: attacker@example.com',
        });

      expect(res.status).toBe(400);
    });

    it('should reject newline in email address', async () => {
      const patterns = [
        'user@example.com\r\n',
        'user@example.com\n',
        'user@example.com\r',
      ];

      for (const email of patterns) {
        const res = await request(app)
          .post('/api/auth/register')
          .send({
            email,
            password: 'SecurePass123',
            firstName: 'Test',
            lastName: 'User',
          });
        
        expect(res.status).toBe(400);
      }
    });
  });

  describe('Multiple Recipients', () => {
    it('should reject comma-separated emails', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'user1@example.com, user2@example.com',
          password: 'SecurePass123',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('Anti-Enumeration', () => {
    it('resend-verification should return same response for existing and non-existing emails', async () => {
      // Assume admin@example.com exists
      const resExisting = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'admin@example.com' });

      const resNonExisting = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'definitely-not-exists-12345@example.com' });

      expect(resExisting.status).toBe(resNonExisting.status);
      expect(resExisting.body.message).toBe(resNonExisting.body.message);
    });

    it('forgot-password should return same response for all emails', async () => {
      const emails = [
        'admin@example.com',
        'user@example.com',
        'nonexistent@example.com',
      ];

      const responses = await Promise.all(
        emails.map((email) =>
          request(app)
            .post('/api/auth/forgot-password')
            .send({ email })
        )
      );

      // All should have identical status and message
      const [status, message] = [responses[0].status, responses[0].body.message];
      responses.forEach((res) => {
        expect(res.status).toBe(status);
        expect(res.body.message).toBe(message);
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limit on resend-verification', async () => {
      const email = 'test@example.com';
      
      // Make 5 valid requests
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/resend-verification')
          .send({ email });
        expect(res.status).toBe(200);
      }
      
      // 6th request should be rate-limited
      const res = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email });
      expect(res.status).toBe(429);
    });

    it('should enforce rate limit on forgot-password', async () => {
      const email = 'test@example.com';
      
      for (let i = 0; i < 5; i++) {
        const res = await request(app)
          .post('/api/auth/forgot-password')
          .send({ email });
        expect(res.status).toBe(200);
      }
      
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email });
      expect(res.status).toBe(429);
    });
  });
});
```

**Run Tests:**
```bash
npm run test -- auth.email-security.test.ts
```

---

## 5. Monitor for SMTP Header Injection Patterns (Priority: LOW)

**Location:** Create `/home/mateo/prim-o/backend/src/middleware/emailSecurityMonitor.ts`

```typescript
/**
 * Monitoring middleware to detect suspicious email patterns
 * Logs potential attacks for security review
 */

import type { Request, Response, NextFunction } from 'express';

const SMTP_INJECTION_PATTERNS = [
  /\r\n/g,           // CRLF
  /[\r\n]/g,         // CR or LF
  /^.*(?:bcc|cc|to):/mi, // Header-like patterns
];

export function emailSecurityMonitor(req: Request, res: Response, next: NextFunction) {
  const email = req.body?.email;
  
  if (!email || typeof email !== 'string') {
    return next();
  }

  for (const pattern of SMTP_INJECTION_PATTERNS) {
    if (pattern.test(email)) {
      console.warn('[security] Potential SMTP injection attempted', {
        endpoint: req.path,
        email: email.substring(0, 50), // Log partial email for security
        pattern: pattern.toString(),
        ip: req.ip,
        timestamp: new Date().toISOString(),
      });
      
      // Continue processing (Zod will reject anyway)
      break;
    }
  }
  
  next();
}

// In app setup (server.ts)
app.use(emailSecurityMonitor);
```

**Purpose:**
- Early warning system for attack attempts
- Alert security team if patterns spike
- Integrates with monitoring/alerting

---

## 6. Email Configuration Validation at Startup (Priority: MEDIUM)

**Location:** `/home/mateo/prim-o/backend/src/config.ts` + New validation function

**Current:**
```typescript
BREVO_SENDER_EMAIL: z.string().email().default('noreply@primo.local'),
BREVO_SENDER_NAME: z.string().default("Prim'O"),
```

**Enhancement:**
```typescript
// In config.ts
export const config = envSchema.parse(process.env);

// New validation function
export async function validateEmailConfig(): Promise<void> {
  // 1. Check Brevo API key is present in production
  if (config.NODE_ENV === 'production' && !config.BREVO_API_KEY) {
    throw new Error(
      'FATAL: BREVO_API_KEY is required in production. ' +
      'Set it in environment variables before starting the server.'
    );
  }

  // 2. Validate sender email is not generic
  if (config.BREVO_SENDER_EMAIL === 'noreply@primo.local') {
    console.warn(
      'WARNING: Using default sender email. ' +
      'Set BREVO_SENDER_EMAIL for production use.'
    );
  }

  // 3. Test Brevo connectivity
  if (config.BREVO_API_KEY) {
    try {
      const testRes = await fetch('https://api.brevo.com/v3/account', {
        headers: { 'api-key': config.BREVO_API_KEY },
      });
      if (!testRes.ok) {
        throw new Error(`Brevo API returned ${testRes.status}`);
      }
      console.log('[config] Brevo API connectivity verified');
    } catch (error) {
      console.error('[config] Brevo API validation failed:', error);
      if (config.NODE_ENV === 'production') {
        throw new Error('Brevo API unavailable. Cannot start in production.');
      }
    }
  }
}

// In server.ts, before starting server
import { validateEmailConfig } from './config';

async function startServer() {
  await validateEmailConfig();
  // ... rest of startup ...
}
```

**Benefits:**
- Fails fast if Brevo isn't configured
- Prevents silent email failures in production
- Validates sender email is realistic

---

## 7. Implement Email Delivery Webhooks (Priority: LOW)

**Location:** New file `/home/mateo/prim-o/backend/src/controllers/brevoWebhook.controller.ts`

```typescript
/**
 * Brevo Webhooks for email delivery tracking
 * Webhook events:
 * - sent: Email sent
 * - delivered: Email delivered to recipient
 * - failed: Email send failed
 * - bounced: Email bounced
 * - complaint: Email marked as spam
 */

import type { Request, Response } from 'express';
import { prisma } from '../lib/db';

interface BrevoWebhookEvent {
  email: string;
  event: 'sent' | 'delivered' | 'failed' | 'bounced' | 'complaint';
  timestamp: number;
  id?: number;
  reason?: string;
}

export async function handleBrevoWebhook(req: Request, res: Response) {
  const events: BrevoWebhookEvent[] = req.body.events || [];

  for (const event of events) {
    console.log('[brevo:webhook]', {
      email: event.email,
      event: event.event,
      timestamp: new Date(event.timestamp * 1000).toISOString(),
    });

    // Track bounces/complaints for future email suppression
    if (event.event === 'bounced' || event.event === 'complaint') {
      // Optionally: store in database to avoid re-sending to bad emails
      await prisma.emailSuppression.upsert({
        where: { email: event.email },
        update: {
          lastEvent: event.event,
          updatedAt: new Date(),
          count: { increment: 1 },
        },
        create: {
          email: event.email,
          type: event.event === 'bounced' ? 'HARD_BOUNCE' : 'COMPLAINT',
          lastEvent: event.event,
          count: 1,
        },
      });

      console.warn('[email:suppression]', {
        email: event.email,
        reason: event.event,
      });
    }
  }

  res.status(200).json({ success: true });
}
```

**Setup in Routes:**
```typescript
// routes/brevoWebhook.routes.ts
router.post('/brevo-webhook', handleBrevoWebhook);
```

**Brevo Configuration:**
1. Log into Brevo dashboard
2. Settings → Webhooks
3. Add webhook URL: `https://api.prim-o.com/webhooks/brevo-webhook`
4. Select events: sent, delivered, failed, bounced, complaint

**Benefits:**
- Track email delivery success rate
- Suppress invalid emails automatically
- Detect abuse patterns (high bounce/complaint rates)

---

## Implementation Roadmap

| Priority | Task | Effort | Impact | Owner |
|----------|------|--------|--------|-------|
| **DONE** ✅ | Base email injection prevention | - | Critical | - |
| LOW | Improve Brevo error logging | 30min | Security | - |
| VERY LOW | Add HTML sanitization | 20min | Defense-in-depth | - |
| MEDIUM | Structured logging | 2h | Observability | - |
| HIGH | Email security tests | 3h | Quality | - |
| LOW | SMTP injection monitoring | 1h | Detection | - |
| MEDIUM | Config validation at startup | 1h | Reliability | - |
| LOW | Brevo webhooks | 4h | Analytics | - |

---

## Security Baseline (Current)

- [x] Email validation (RFC 5322)
- [x] BCC/CC injection prevention
- [x] Subject injection prevention
- [x] SMTP header injection prevention
- [x] Rate limiting
- [x] Anti-enumeration
- [x] Parameterized queries
- [x] Server-side token generation
- [x] URL encoding

## Recommended Next Steps

1. **Immediate (this sprint):**
   - Add email security tests (HIGH priority)
   - Improve error logging (LOW priority)

2. **Next sprint:**
   - Structured logging for audit trail
   - Email config validation at startup

3. **Nice-to-have:**
   - HTML sanitization
   - SMTP injection monitoring
   - Brevo webhooks for delivery tracking

---

## Testing Checklist

Before deployment:
- [ ] BCC/CC injection tests pass
- [ ] Rate limiting tests pass
- [ ] Anti-enumeration tests pass
- [ ] Email sends successfully in staging
- [ ] Email sends successfully in production (Brevo configured)
- [ ] Logs show email delivery events
- [ ] Error handling doesn't leak credentials

---

## References

- OWASP: [Email Header Injection](https://owasp.org/www-community/attacks/Email_Header_Injection)
- RFC 5322: Internet Message Format
- Brevo API Docs: https://developers.brevo.com/reference/sendtransacemail
- Zod Email Validation: https://zod.dev/?id=strings

---

## Conclusion

Current implementation is **production-ready** for email injection security.

Recommendations are **optional enhancements** for:
- Better observability
- Automated testing
- Early attack detection
- Delivery tracking

No critical security changes required.
