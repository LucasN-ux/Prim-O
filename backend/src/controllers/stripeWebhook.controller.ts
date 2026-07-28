import type { Request, Response } from 'express';
import { stripe } from '../lib/stripe';
import { config } from '../config';
import { fulfillCheckout, type CheckoutSession } from '../services/stripeWebhook.service';

export async function stripeWebhookController(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];

  let event: ReturnType<typeof stripe.webhooks.constructEvent>;
  try {
    // req.body is a raw Buffer (express.raw() on this route) - required for Stripe signature
    // verification.
    event = stripe.webhooks.constructEvent(
      req.body,
      signature as string,
      config.STRIPE_WEBHOOK_SECRET,
    );
  } catch {
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  // Two different events can carry a captured payment, and we were only listening to one.
  //
  // With a card the money is taken on the spot, so checkout.session.completed already says
  // paid and the pool is credited straight away. With a payment method that confirms later,
  // that same event arrives unpaid: fulfillCheckout returns without crediting, correctly,
  // since the money is not there yet. The capture is then announced by a second event,
  // async_payment_succeeded, which nothing here handled. It fell through to the 200 below,
  // Stripe considered it delivered and never retried, and the company stayed at zero after
  // being charged. Nothing was written anywhere either, so the only symptom was a customer
  // saying they had paid and received nothing.
  //
  // Handling both is safe: fulfillCheckout is idempotent, the unique stripeSessionId turns a
  // second attempt on the same session into a no-op.
  if (
    event.type === 'checkout.session.completed' ||
    event.type === 'checkout.session.async_payment_succeeded'
  ) {
    try {
      await fulfillCheckout(event.data.object as CheckoutSession);
    } catch (err) {
      console.error('Stripe fulfillment failed:', {
        eventType: event.type,
        sessionId: event.data.object.id,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: 'fulfillment failed' });
      return;
    }
  }

  // A delayed payment can also fail days after the customer left the checkout. There is
  // nothing to undo, since nothing was ever credited, but without this line nobody can tell
  // the difference between a top-up that failed and one that was never attempted.
  if (event.type === 'checkout.session.async_payment_failed') {
    const session = event.data.object as CheckoutSession;
    console.warn('Stripe async payment failed:', {
      sessionId: session.id,
      companyId: session.metadata?.companyId,
      tokenAmount: session.metadata?.tokenAmount,
    });
  }

  res.status(200).json({ received: true });
}
