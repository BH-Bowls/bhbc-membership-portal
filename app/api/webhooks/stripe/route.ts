// app/api/webhooks/stripe/route.ts
// POST — Stripe's webhook (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11.4). Public (no
// session or PIN — see proxy.ts); every request must carry a valid Stripe-Signature for
// STRIPE_WEBHOOK_SECRET, or it gets 400 and is ignored.
//
// Payments are recorded only here, never on the browser's return from Stripe. Stripe
// retries a webhook until it gets a 2xx, and recording is idempotent per session, so a
// failure returns 500 to make Stripe try again.

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripe, getStripeWebhookSecret } from '@/lib/stripe';
import { handleCheckoutCompleted, handleCheckoutExpired } from '@/lib/stripe-payments';

export async function POST(request: NextRequest) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  // The raw body — the signature is over the exact bytes Stripe sent
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, getStripeWebhookSecret());
  } catch (err) {
    console.error('Stripe webhook signature check failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    let note = 'ignored';
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      note = await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === 'checkout.session.expired') {
      note = await handleCheckoutExpired(event.data.object as Stripe.Checkout.Session);
    }
    console.log(`Stripe webhook ${event.type} ${event.id}: ${note}`);
    return NextResponse.json({ received: true });
  } catch (err) {
    console.error(`Stripe webhook ${event.type} ${event.id} failed:`, err);
    return NextResponse.json({ error: 'Failed to process' }, { status: 500 });
  }
}
