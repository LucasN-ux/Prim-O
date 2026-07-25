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

  if (event.type === 'checkout.session.completed') {
    try {
      await fulfillCheckout(event.data.object as CheckoutSession);
    } catch (err) {
      console.error('Stripe fulfillment failed:', {
        sessionId: event.data.object.id,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ error: 'fulfillment failed' });
      return;
    }
  }

  res.status(200).json({ received: true });
}
