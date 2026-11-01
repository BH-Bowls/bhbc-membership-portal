// src/lib/square.ts
// Square Terminal API client (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10). Plain fetch calls
// to Square's REST API — no SDK — server-side only.
//
// Env (.env.dev.local / Vercel):
//   SQUARE_ENVIRONMENT          'sandbox' or 'production' (default sandbox)
//   SQUARE_ACCESS_TOKEN         the application's access token for that environment
//   SQUARE_LOCATION_ID          the location the Terminal is paired to
//   SQUARE_WEBHOOK_SIGNATURE_KEY  from the webhook subscription (Developer Console)
//   SQUARE_WEBHOOK_URL          the exact notification URL registered with Square —
//                               it's part of the signature, so it must match exactly
//
// The paired Terminal's device id lives in the config table (square_device_id), not env,
// so it can be paired from /admin/bar-devices without a redeploy.

import crypto from 'crypto';

const SQUARE_VERSION = '2026-09-16';

/** True when the access token and location are set — otherwise the till uses the tick box. */
export function isSquareConfigured(): boolean {
  return !!process.env.SQUARE_ACCESS_TOKEN && !!process.env.SQUARE_LOCATION_ID;
}

export function isSquareSandbox(): boolean {
  return process.env.SQUARE_ENVIRONMENT !== 'production';
}

function getAccessToken(): string {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN is not set — add it to .env.dev.local');
  return token;
}

export function getSquareLocationId(): string {
  const id = process.env.SQUARE_LOCATION_ID;
  if (!id) throw new Error('SQUARE_LOCATION_ID is not set — add it to .env.dev.local');
  return id;
}

function baseUrl(): string {
  return isSquareSandbox() ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
}

async function squareFetch(path: string, method: 'GET' | 'POST', body?: unknown): Promise<any> {
  const res = await fetch(baseUrl() + path, {
    method,
    headers: {
      'Square-Version': SQUARE_VERSION,
      'Authorization': `Bearer ${getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    if (Array.isArray(data.errors) && data.errors.length > 0) {
      const first = data.errors[0];
      detail = first.detail || first.code || detail;
    }
    throw new Error(`Square: ${detail}`);
  }
  return data;
}

// ── Terminal checkouts ───────────────────────────────────────────────────────

/** Square's checkout statuses: PENDING, IN_PROGRESS, CANCEL_REQUESTED, CANCELED, COMPLETED. */
export interface TerminalCheckout {
  id: string;
  status: string;
  amountPence: number;
  cancelReason: string | null;   // BUYER_CANCELED, SELLER_CANCELED, TIMED_OUT
  paymentId: string | null;
}

function mapCheckout(c: any): TerminalCheckout {
  let paymentId: string | null = null;
  if (Array.isArray(c.payment_ids) && c.payment_ids.length > 0) paymentId = String(c.payment_ids[0]);
  return {
    id: String(c.id),
    status: String(c.status || ''),
    amountPence: c.amount_money ? Number(c.amount_money.amount) || 0 : 0,
    cancelReason: c.cancel_reason ? String(c.cancel_reason) : null,
    paymentId: paymentId,
  };
}

export function isFinalStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'CANCELED';
}

/** Send an amount to the Terminal. referenceId shows in the Square Dashboard; note on the Terminal. */
export async function createTerminalCheckout(opts: {
  idempotencyKey: string;
  amountPence: number;
  deviceId: string;
  referenceId: string;
  note: string;
}): Promise<TerminalCheckout> {
  const data = await squareFetch('/v2/terminals/checkouts', 'POST', {
    idempotency_key: opts.idempotencyKey,
    checkout: {
      amount_money: { amount: opts.amountPence, currency: 'GBP' },
      reference_id: opts.referenceId.slice(0, 40),
      note: opts.note.slice(0, 250),
      device_options: { device_id: opts.deviceId },
      // Long enough for a busy bar, short enough that a forgotten one doesn't linger
      deadline_duration: 'PT5M',
    },
  });
  return mapCheckout(data.checkout);
}

export async function getTerminalCheckout(checkoutId: string): Promise<TerminalCheckout> {
  const data = await squareFetch(`/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}`, 'GET');
  return mapCheckout(data.checkout);
}

export async function cancelTerminalCheckout(checkoutId: string): Promise<TerminalCheckout> {
  const data = await squareFetch(`/v2/terminals/checkouts/${encodeURIComponent(checkoutId)}/cancel`, 'POST', {});
  return mapCheckout(data.checkout);
}

// ── Refunds ──────────────────────────────────────────────────────────────────

/** Refund (part of) a card payment back to the card. Status: PENDING, COMPLETED, REJECTED, FAILED.
 * The idempotency key makes a retry return the same refund rather than refunding twice. */
export async function refundPayment(opts: { idempotencyKey: string; paymentId: string; amountPence: number; reason: string }): Promise<{ id: string; status: string }> {
  const data = await squareFetch('/v2/refunds', 'POST', {
    idempotency_key: opts.idempotencyKey,
    payment_id: opts.paymentId,
    amount_money: { amount: opts.amountPence, currency: 'GBP' },
    reason: opts.reason,
  });
  return { id: data.refund.id, status: data.refund.status };
}

// ── Pairing a Terminal (Devices API) ─────────────────────────────────────────

/** Status: UNPAIRED (waiting for the code to be entered), PAIRED, EXPIRED. */
export interface DeviceCode {
  id: string;
  code: string;
  status: string;
  deviceId: string | null;
  pairBy: string | null;
}

function mapDeviceCode(d: any): DeviceCode {
  return {
    id: String(d.id),
    code: String(d.code || ''),
    status: String(d.status || ''),
    deviceId: d.device_id ? String(d.device_id) : null,
    pairBy: d.pair_by ? String(d.pair_by) : null,
  };
}

export async function createDeviceCode(name: string): Promise<DeviceCode> {
  const data = await squareFetch('/v2/devices/codes', 'POST', {
    idempotency_key: crypto.randomUUID(),
    device_code: { name: name, product_type: 'TERMINAL_API', location_id: getSquareLocationId() },
  });
  return mapDeviceCode(data.device_code);
}

export async function getDeviceCode(codeId: string): Promise<DeviceCode> {
  const data = await squareFetch(`/v2/devices/codes/${encodeURIComponent(codeId)}`, 'GET');
  return mapDeviceCode(data.device_code);
}

// ── Sandbox test devices ─────────────────────────────────────────────────────
// The sandbox can't pair a real Terminal. These device ids simulate one
// (developer.squareup.com/docs/devtools/sandbox/testing). Sandbox card checkouts
// are only approved up to 25.00 — larger amounts stay PENDING until they time out.

export const SANDBOX_TEST_DEVICES: { id: string; name: string }[] = [
  { id: '9fa747a2-25ff-48ee-b078-04381f7c828f', name: 'Test: card payment succeeds' },
  { id: '841100b9-ee60-4537-9bcf-e30b2ba5e215', name: 'Test: customer cancels on the Terminal' },
  { id: '0a956d49-619a-4530-8e5e-8eac603ffc5e', name: 'Test: Square times the checkout out' },
  { id: 'da40d603-c2ea-4a65-8cfd-f42e36dab0c7', name: 'Test: Terminal offline (never picks it up)' },
];

// ── Webhook signature ────────────────────────────────────────────────────────

/** Square signs base64(HMAC-SHA256(key, notificationUrl + rawBody)) in x-square-hmacsha256-signature. */
export function verifySquareWebhook(rawBody: string, signature: string | null, requestUrl: string): boolean {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key || !signature) return false;
  const url = process.env.SQUARE_WEBHOOK_URL || requestUrl;
  const expected = crypto.createHmac('sha256', key).update(url + rawBody).digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
