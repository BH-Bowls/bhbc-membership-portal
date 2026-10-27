// src/lib/stripe.ts
// Stripe client and settings (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11.9). Server-only.
//
// Test-mode keys on dev and preview, live keys on production only. Online payments also
// need config stripe_payments_enabled = 'true' (Admin config → Renewals), so the code can
// be deployed before it's switched on.

import Stripe from 'stripe';
import { getConfig } from './config-supabase';

// Pinned, so a Stripe-side default change can't alter what the webhook receives
const STRIPE_API_VERSION = '2026-09-30.endive';

export function getStripeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set — add the Stripe secret key (sk_test_… on dev) to .env.dev.local');
  }
  return key;
}

export function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not set — add the webhook signing secret (whsec_…) to .env.dev.local');
  }
  return secret;
}

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    client = new Stripe(getStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
  }
  return client;
}

/** True when "Pay online" should be offered: switched on in config and a key is set. */
export async function isStripePaymentsEnabled(): Promise<boolean> {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  const config = await getConfig();
  return config.stripe_payments_enabled === 'true';
}
