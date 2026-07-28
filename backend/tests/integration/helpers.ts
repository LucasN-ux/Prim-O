import crypto from 'crypto';
import request from 'supertest';
import app from '../../src/app';
import { config } from '../../src/config';

export { app };

// Mot de passe commun du seed.
export const SEED_PASSWORD = 'password123';

export async function login(email: string, password: string = SEED_PASSWORD): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`login ${email} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

// Force isEmailVerified=true via the test route (mounted outside production).
export async function verifyEmail(email: string): Promise<void> {
  const res = await request(app).post('/api/test/verify-email').send({ email });
  if (res.status !== 200) {
    throw new Error(`verify-email ${email} -> ${res.status} ${JSON.stringify(res.body)}`);
  }
}

export const auth = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
});

export interface Member {
  id: string;
  email: string;
  token: string;
}

// Sends a Stripe event the way Stripe does, signed with the real webhook secret so
// constructEvent accepts it. Lets a test reach the fulfilment path without a card.
export async function sendStripeEvent(
  type: string,
  session: { id: string; payment_status?: string; metadata?: Record<string, string> },
): Promise<number> {
  const payload = JSON.stringify({
    id: `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    data: { object: { payment_status: 'paid', ...session } },
  });
  const t = Math.floor(Date.now() / 1000);
  const signature = crypto
    .createHmac('sha256', config.STRIPE_WEBHOOK_SECRET)
    .update(`${t}.${payload}`)
    .digest('hex');

  const res = await request(app)
    .post('/api/stripe/webhook')
    .set('content-type', 'application/json')
    .set('stripe-signature', `t=${t},v1=${signature}`)
    .send(payload);
  return res.status;
}

// Tops the caller's pool up through the real purchase path. Tests must not depend on whatever
// the seed happens to leave in the pool, nor on what the files running before them consumed:
// these suites share one database, in series.
export async function topUpPool(ownerToken: string, amount: number): Promise<void> {
  const company = await request(app).get('/api/company').set(auth(ownerToken));
  const me = await request(app).get('/api/auth/me').set(auth(ownerToken));

  const status = await sendStripeEvent('checkout.session.completed', {
    id: `cs_test_topup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    metadata: {
      companyId: company.body.company.id,
      createdById: me.body.user.id,
      tokenAmount: String(amount),
    },
  });
  if (status !== 200) throw new Error(`top-up -> ${status}`);
}

// Creates a throwaway member of the caller's company, through the real signup path: register,
// verify, redeem an invite code, log in. Tests that delete or demote someone need their own
// victim, otherwise they destroy fixtures the other files rely on.
export async function createMember(
  ownerToken: string,
  role: 'EMPLOYEE' | 'MANAGER' = 'EMPLOYEE',
): Promise<Member> {
  const email = `tmp-${role.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;

  const invite = await request(app).post('/api/invites/generate')
    .set(auth(ownerToken)).send({ role, maxUses: 1, expiresInHours: 1 });
  if (invite.status !== 201) {
    throw new Error(`invite ${role} -> ${invite.status} ${JSON.stringify(invite.body)}`);
  }

  const register = await request(app).post('/api/auth/register')
    .send({ firstName: 'Tmp', lastName: role, email, password: SEED_PASSWORD });
  if (register.status !== 201) {
    throw new Error(`register ${email} -> ${register.status} ${JSON.stringify(register.body)}`);
  }

  await verifyEmail(email);
  let token = await login(email);

  const join = await request(app).post('/api/auth/join-company')
    .set(auth(token)).send({ code: invite.body.code ?? invite.body.invite?.code });
  if (join.status !== 200) {
    throw new Error(`join-company ${email} -> ${join.status} ${JSON.stringify(join.body)}`);
  }
  // join-company mints a fresh token: the previous one still says role null.
  token = join.body.accessToken;

  const me = await request(app).get('/api/auth/me').set(auth(token));
  return { id: me.body.user.id, email, token };
}
