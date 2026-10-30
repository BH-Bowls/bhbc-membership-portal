// src/lib/stripe-payments.ts
// Paying renewals online through Stripe Checkout (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §11).
//
// Two routes in:
//   - "Pay online" on My Account (§11.3): pays the outstanding amount on one or more
//     submitted renewals (a buddy can pay for the members they manage in one go).
//     metadata.purpose = 'renewal'.
//   - "Submit and pay online" on the renewal form (§11.3a): the draft is held while the
//     Checkout page is open, and the webhook submits it and records the payment together.
//     metadata.purpose = 'renewal_submit'.
//
// Amounts always come from the database, never the browser. A payment is recorded only
// by the webhook (handleCheckoutCompleted), never on the success redirect, through the
// renewals_record_stripe_payment() function in 0086, which is all or nothing and safe
// to call twice for the same session.

import type Stripe from 'stripe';
import { getStripe } from './stripe';
import { getSupabaseClient } from './supabase';
import { getAllUsers, getUserByUsername } from './members-supabase';
import {
  getCurrentSeasonYear,
  getRenewalByUsername,
  sendRenewalConfirmation,
  type FeeBreakdown,
} from './renewals-supabase';
import { getAppUrl } from './app-url';
import { toUkDate } from './renewals-xero';
import { claimPickedNumbers } from './renewals-200-club';

// Stripe's minimum is 30 minutes; anything longer just holds a draft for longer
const CHECKOUT_MINUTES = 30;

interface CheckoutItem {
  username: string;
  amount: number;   // pounds
}

function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

async function fullNames(): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const u of await getAllUsers()) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }
  return names;
}

async function payerEmail(userName: string): Promise<string | undefined> {
  const user = await getUserByUsername(userName);
  if (user && user.emailAddress) return user.emailAddress;
  return undefined;
}

// ============================================================================
// MY ACCOUNT — pay what's outstanding (§11.3)
// ============================================================================

/**
 * Create a Checkout session for the outstanding amount on each renewal. The caller has
 * already checked the payer may pay for every one of them. Throws with a message fit to
 * show the member if any of them can't be paid.
 */
export async function createOutstandingCheckout(payer: string, userNames: string[]): Promise<string> {
  if (userNames.length === 0) throw new Error('Choose at least one renewal to pay.');
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();
  const { data, error } = await supabase
    .from('renewals')
    .select('username, submitted_at, voided_at, renewing_membership, outstanding')
    .eq('season_year', seasonYear);
  if (error) throw new Error(`Failed to load renewals: ${error.message}`);

  const rows = new Map<string, Record<string, unknown>>();
  for (const row of data || []) rows.set(String(row.username).toLowerCase(), row);
  const names = await fullNames();

  const items: CheckoutItem[] = [];
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  for (const userName of userNames) {
    const row = rows.get(userName.toLowerCase());
    const name = names.get(userName.toLowerCase()) || userName;
    if (!row || !row.submitted_at || row.voided_at || row.renewing_membership !== true) {
      throw new Error(`${name} has no submitted ${seasonYear} renewal to pay.`);
    }
    const outstanding = Number(row.outstanding) || 0;
    if (outstanding <= 0) {
      throw new Error(`${name}'s ${seasonYear} renewal is already paid.`);
    }
    items.push({ username: String(row.username), amount: outstanding });
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: toPence(outstanding),
        product_data: { name: `${seasonYear} membership — ${name}` },
      },
    });
  }

  const appUrl = await getAppUrl();
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: await payerEmail(payer),
    expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
    success_url: `${appUrl}/account?payment=processing&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/account`,
    metadata: {
      purpose: 'renewal',
      season: String(seasonYear),
      payer: payer,
      items: JSON.stringify(items),
    },
  });
  if (!session.url) throw new Error('Stripe did not return a payment page.');
  return session.url;
}

// ============================================================================
// RENEWAL FORM — submit and pay (§11.3a)
// ============================================================================

/**
 * Create a Checkout session for a draft renewal's whole fee, and hold the draft while it's
 * open. The renewals route has already saved the form and run every Submit check.
 * memberParam: added to the return URLs so an Admin comes back to the same member.
 */
export async function createSubmitCheckout(opts: {
  payer: string;
  userName: string;
  memberParam: string | null;
}): Promise<string> {
  const renewal = await getRenewalByUsername(opts.userName);
  if (renewal.submittedAt) throw new Error('This renewal has already been submitted.');
  if (renewal.renewingMembership !== true) throw new Error('Only a renewing membership can be paid online.');
  const total = renewal.totalPayment;
  if (total <= 0) throw new Error('There is nothing to pay on this renewal.');

  const seasonYear = getCurrentSeasonYear();
  const names = await fullNames();
  const name = names.get(opts.userName.toLowerCase()) || opts.userName;
  const appUrl = await getAppUrl();
  let memberQuery = '';
  if (opts.memberParam) memberQuery = `&member=${encodeURIComponent(opts.memberParam)}`;
  const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60;

  const items: CheckoutItem[] = [{ username: renewal.userName, amount: total }];
  const session = await getStripe().checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: toPence(total),
        product_data: { name: `${seasonYear} membership — ${name}` },
      },
    }],
    customer_email: await payerEmail(opts.userName),
    expires_at: expiresAt,
    success_url: `${appUrl}/renewals?payment=processing&session_id={CHECKOUT_SESSION_ID}${memberQuery}`,
    // Stripe doesn't fill in {CHECKOUT_SESSION_ID} here — the page cancels by member
    cancel_url: `${appUrl}/renewals?payment=cancelled${memberQuery}`,
    metadata: {
      purpose: 'renewal_submit',
      season: String(seasonYear),
      payer: opts.payer,
      items: JSON.stringify(items),
    },
  });
  if (!session.url) throw new Error('Stripe did not return a payment page.');

  // Hold the draft — only while it's still a draft
  const supabase = getSupabaseClient();
  const { error, count } = await supabase
    .from('renewals')
    .update({
      pending_checkout_session_id: session.id,
      pending_checkout_expires_at: new Date(expiresAt * 1000).toISOString(),
    }, { count: 'exact' })
    .ilike('username', opts.userName)
    .eq('season_year', seasonYear)
    .is('submitted_at', null);
  if (error || !count) {
    await getStripe().checkout.sessions.expire(session.id).catch(() => {});
    throw new Error('Could not start the payment — please try again.');
  }
  return session.url;
}

/**
 * Cancel whatever "Submit and pay online" page is holding this member's draft. Looked up
 * from the renewal rather than taken from the return URL — Stripe only fills in
 * {CHECKOUT_SESSION_ID} on the success URL, not the cancel one. The caller has already
 * checked the user may manage this member. If Stripe shows it was paid after all, it's
 * recorded instead.
 */
export async function cancelHeldCheckoutForMember(userName: string): Promise<CheckoutStatus | 'none'> {
  const renewal = await getRenewalByUsername(userName);
  const sessionId = renewal.pendingCheckoutSessionId;
  if (!sessionId || renewal.submittedAt) return 'none';

  const outcome = await reconcileCheckoutSession(sessionId);
  if (outcome !== 'waiting') return outcome;

  // Fails if it's already closed — fine, as long as it wasn't paid in the meantime,
  // which the check below catches
  await getStripe().checkout.sessions.expire(sessionId).catch(() => {});
  const after = await reconcileCheckoutSession(sessionId);
  if (after === 'recorded') return 'recorded';
  await releaseHold(sessionId);
  return 'expired';
}

async function releaseHold(sessionId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('renewals')
    .update({ pending_checkout_session_id: null, pending_checkout_expires_at: null })
    .eq('pending_checkout_session_id', sessionId);
  if (error) throw new Error(`Failed to release the held renewal: ${error.message}`);
}

/** True while a "Submit and pay online" page is open for this renewal. */
export function isCheckoutHeld(pendingSessionId: string | null | undefined, expiresAt: string | null | undefined): boolean {
  if (!pendingSessionId || !expiresAt) return false;
  return new Date(expiresAt).getTime() > Date.now();
}

// ============================================================================
// WEBHOOK
// ============================================================================

function parseItems(session: Stripe.Checkout.Session): CheckoutItem[] {
  const items: CheckoutItem[] = [];
  if (!session.metadata || !session.metadata.items) return items;
  const parsed = JSON.parse(session.metadata.items);
  if (!Array.isArray(parsed)) return items;
  for (const p of parsed) {
    if (p && typeof p.username === 'string' && typeof p.amount === 'number') {
      items.push({ username: p.username, amount: p.amount });
    }
  }
  return items;
}

/**
 * checkout.session.completed: record the payment (and, for §11.3a, the submission).
 * Returns a short note for the webhook log.
 */
export async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<string> {
  const metadata = session.metadata || {};
  if (metadata.purpose !== 'renewal' && metadata.purpose !== 'renewal_submit') {
    return `ignored: purpose ${metadata.purpose || '(none)'}`;
  }
  if (session.payment_status !== 'paid') {
    return `ignored: payment_status ${session.payment_status}`;
  }

  const items = parseItems(session);
  if (items.length === 0) throw new Error(`Session ${session.id} has no renewal items`);
  let expectedPence = 0;
  for (const item of items) expectedPence += toPence(item.amount);
  if (session.amount_total !== expectedPence) {
    throw new Error(`Session ${session.id} paid ${session.amount_total}p but its renewals add up to ${expectedPence}p`);
  }

  const isSubmit = metadata.purpose === 'renewal_submit';
  let paymentIntentId: string | null = null;
  if (typeof session.payment_intent === 'string') paymentIntentId = session.payment_intent;
  else if (session.payment_intent) paymentIntentId = session.payment_intent.id;

  const supabase = getSupabaseClient();
  const { data: recorded, error } = await supabase.rpc('renewals_record_stripe_payment', {
    p_session_id: session.id,
    p_payment_intent_id: paymentIntentId,
    p_paid_date: toUkDate(new Date().toISOString()),
    p_season_year: Number(metadata.season),
    p_payer: metadata.payer || 'stripe',
    p_items: items,
    p_submit: isSubmit,
  });
  if (error) throw new Error(`Failed to record Stripe session ${session.id}: ${error.message}`);
  if (!recorded) return `already recorded: ${session.id}`;

  // The confirmation email that Submit would have sent, saying it's paid
  if (isSubmit) {
    const userName = items[0].username;
    let renewal = await getRenewalByUsername(userName);

    // Give out the 200 Club numbers they picked (§9). They've paid, so this can't fail the
    // Submit: any number taken while they were on the payment page becomes an "Any number"
    // entry for GMC to allocate, and the renewal's picks are trimmed to match.
    const picks = renewal.club200PickedNumbers || [];
    if (picks.length > 0) {
      try {
        const claim = await claimPickedNumbers(userName, picks, true);
        if (claim.taken.length > 0) {
          console.error(`200 Club numbers ${claim.taken.join(', ')} for ${userName} were taken while they paid — left for GMC to allocate`);
          const kept: string[] = [];
          for (const p of picks) {
            if (claim.taken.indexOf(p) === -1) kept.push(p);
          }
          const { error: trimError } = await supabase.from('renewals')
            .update({ club_200_picked_numbers: kept })
            .eq('username', userName)
            .eq('season_year', Number(metadata.season));
          if (trimError) console.error(`Failed to update 200 Club picks for ${userName}:`, trimError.message);
          renewal = await getRenewalByUsername(userName);
        }
      } catch (err) {
        console.error(`Failed to give 200 Club numbers to ${userName} — GMC can allocate them by hand:`, err);
      }
    }

    const fees: FeeBreakdown = {
      membershipFee: renewal.playingFees + renewal.socialFees,
      compsFee: renewal.compsFee,
      club200Fee: renewal.fee200Club,
      total: renewal.totalPayment,
    };
    let manager: string | undefined = undefined;
    if (metadata.payer && metadata.payer.toLowerCase() !== userName.toLowerCase()) manager = metadata.payer;
    const emailResult = await sendRenewalConfirmation(userName, renewal, fees, manager, { paidOnline: true });
    if (!emailResult.success) {
      console.error(`Renewal for ${userName} submitted and paid online, but the confirmation email failed:`, emailResult.error);
    }
  }
  return `recorded ${recorded} renewal(s) for ${session.id}`;
}

/** checkout.session.expired: release a held draft (§11.3a step 5). */
export async function handleCheckoutExpired(session: Stripe.Checkout.Session): Promise<string> {
  if (!session.metadata || session.metadata.purpose !== 'renewal_submit') return 'ignored';
  await releaseHold(session.id);
  return `released ${session.id}`;
}

// ============================================================================
// STATUS — polled by the page the member returns to
// ============================================================================

export type CheckoutStatus = 'recorded' | 'waiting' | 'expired';

async function isSessionRecorded(sessionId: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewal_payments')
    .select('payment_id')
    .eq('stripe_session_id', sessionId)
    .limit(1);
  if (error) throw new Error(error.message);
  return !!data && data.length > 0;
}

/**
 * Catch up on a Checkout session the webhook hasn't told us about — the webhook can be
 * delayed, or never arrive (found in testing 27 Oct 2026). Asks Stripe directly, with
 * the secret key, so it can't be faked from the browser: a paid session is recorded
 * exactly as the webhook would (idempotent — whichever gets there first wins), and an
 * expired one releases its held draft.
 */
export async function reconcileCheckoutSession(sessionId: string): Promise<CheckoutStatus> {
  if (await isSessionRecorded(sessionId)) return 'recorded';

  const session = await getStripe().checkout.sessions.retrieve(sessionId);
  if (session.status === 'complete' && session.payment_status === 'paid') {
    const note = await handleCheckoutCompleted(session);
    console.log(`Stripe session ${sessionId} reconciled without the webhook: ${note}`);
    return 'recorded';
  }
  if (session.status === 'expired') {
    if (session.metadata && session.metadata.purpose === 'renewal_submit') {
      await releaseHold(sessionId);
    }
    return 'expired';
  }
  return 'waiting';
}

export async function getCheckoutStatus(sessionId: string): Promise<CheckoutStatus> {
  return reconcileCheckoutSession(sessionId);
}
