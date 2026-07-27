import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app, login, auth, sendStripeEvent } from './helpers';

// The webhook is the only path that puts tokens into a pool, and the money has already left
// the customer's account by the time it fires. A silent failure here is a customer charged
// for nothing, so every branch gets its own test.
describe('Webhook Stripe - le pool suit reellement l argent', () => {
  let ownerToken: string;
  let companyId: string;
  let ownerId: string;

  const poolOf = async (): Promise<number> => {
    const res = await request(app).get('/api/company').set(auth(ownerToken));
    return res.body.company.tokenBalance;
  };

  const metadata = () => ({
    companyId,
    createdById: ownerId,
    tokenAmount: '250',
  });

  beforeAll(async () => {
    ownerToken = await login('boss@acme.fr');
    const company = await request(app).get('/api/company').set(auth(ownerToken));
    companyId = company.body.company.id;
    const me = await request(app).get('/api/auth/me').set(auth(ownerToken));
    ownerId = me.body.user.id;
  });

  it('un paiement par carte credite le pool', async () => {
    const before = await poolOf();
    const status = await sendStripeEvent('checkout.session.completed', {
      id: `cs_test_card_${Date.now()}`,
      metadata: metadata(),
    });
    expect(status).toBe(200);
    expect((await poolOf()) - before).toBe(250);
  });

  it('un paiement confirme en differe credite le pool', async () => {
    // Avec un moyen de paiement qui se confirme plus tard, checkout.session.completed arrive
    // avec un statut non paye et ne credite rien, ce qui est correct : l'argent n'est pas
    // encore la. La capture est annoncee par un second evenement, plusieurs jours apres.
    // Personne ne l'ecoutait : l'entreprise etait debitee et son pool restait a zero.
    const before = await poolOf();
    const sessionId = `cs_test_async_${Date.now()}`;

    const pending = await sendStripeEvent('checkout.session.completed', {
      id: sessionId,
      payment_status: 'unpaid',
      metadata: metadata(),
    });
    expect(pending).toBe(200);
    expect(await poolOf()).toBe(before);

    const captured = await sendStripeEvent('checkout.session.async_payment_succeeded', {
      id: sessionId,
      metadata: metadata(),
    });
    expect(captured).toBe(200);
    expect((await poolOf()) - before).toBe(250);
  });

  it('rejouer le meme paiement ne credite pas deux fois', async () => {
    // Stripe rejoue un evenement des qu'il doute de sa livraison. Sans l'unicite sur
    // stripeSessionId, chaque rejeu fabriquerait des tokens.
    const sessionId = `cs_test_replay_${Date.now()}`;
    await sendStripeEvent('checkout.session.completed', { id: sessionId, metadata: metadata() });

    const after = await poolOf();
    await sendStripeEvent('checkout.session.completed', { id: sessionId, metadata: metadata() });
    await sendStripeEvent('checkout.session.async_payment_succeeded', { id: sessionId, metadata: metadata() });
    expect(await poolOf()).toBe(after);
  });

  it('un paiement differe qui echoue ne credite rien et repond 200', async () => {
    // Repondre 200 est volontaire : il n'y a rien a reessayer, rien n'a ete credite.
    const before = await poolOf();
    const status = await sendStripeEvent('checkout.session.async_payment_failed', {
      id: `cs_test_failed_${Date.now()}`,
      metadata: metadata(),
    });
    expect(status).toBe(200);
    expect(await poolOf()).toBe(before);
  });

  it('des metadonnees inexploitables font echouer bruyamment, sans rien crediter', async () => {
    // Stripe doit reessayer plus tard, d'ou le 500. Le 200 silencieux d'avant faisait
    // disparaitre le paiement sans laisser de trace.
    const before = await poolOf();
    const status = await sendStripeEvent('checkout.session.completed', {
      id: `cs_test_nometa_${Date.now()}`,
      metadata: {},
    });
    expect(status).toBe(500);
    expect(await poolOf()).toBe(before);
  });

  it('une signature invalide est refusee avant tout traitement', async () => {
    const before = await poolOf();
    const res = await request(app)
      .post('/api/stripe/webhook')
      .set('content-type', 'application/json')
      .set('stripe-signature', 't=1,v1=signature_bidon')
      .send(JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_test_forge', payment_status: 'paid', metadata: metadata() } },
      }));
    expect(res.status).toBe(400);
    expect(await poolOf()).toBe(before);
  });
});
