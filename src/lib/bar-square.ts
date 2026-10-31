// src/lib/bar-square.ts
// Card payments on the Square Terminal from the bar till (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10).
//
// 1. startTerminalCheckout() works out the amount on the server (a basket at current prices,
//    a top-up, or a renewal's amount due), sends it to the Terminal, and stores what to
//    record in square_checkouts (0091).
// 2. The till polls refreshTerminalCheckout(); Square's webhook calls it too. When Square
//    says COMPLETED, recordCheckout() records the sale / top-up / membership fee exactly
//    once, with Square's payment id.
// 3. CANCELED (customer cancelled, staff cancelled, timed out) records nothing.
//
// A checkout that's paid but can't be recorded (e.g. the renewal was paid by bank
// transfer in the meantime) keeps record_error and shows on /admin/bar-devices to sort out.

import crypto from 'crypto';
import { getSupabaseClient } from './supabase';
import { getConfig, updateConfig } from './config-supabase';
import { topUp, visitorSale, type BasketItem } from './bar-supabase';
import { getTillRenewalsDue, recordTillRenewalPayment } from './renewals-till';
import {
  isSquareConfigured, isSquareSandbox, createTerminalCheckout, getTerminalCheckout,
  cancelTerminalCheckout, isFinalStatus,
} from './square';

export type TerminalKind = 'sale' | 'topup' | 'membership';

export interface TerminalSetup {
  enabled: boolean;      // configured and a Terminal is paired — the till uses it for card
  configured: boolean;   // env vars set
  sandbox: boolean;
  deviceId: string;
  deviceName: string;
}

export async function getTerminalSetup(): Promise<TerminalSetup> {
  const configured = isSquareConfigured();
  const config = await getConfig();
  const deviceId = config.square_device_id || '';
  return {
    enabled: configured && deviceId !== '',
    configured: configured,
    sandbox: isSquareSandbox(),
    deviceId: deviceId,
    deviceName: config.square_device_name || '',
  };
}

export async function setTerminalDevice(deviceId: string, deviceName: string): Promise<void> {
  await updateConfig({ square_device_id: deviceId, square_device_name: deviceName });
}

/** What the till sees while it waits. */
export interface TerminalCheckoutView {
  id: string;
  kind: TerminalKind;
  amountPence: number;
  status: string;              // PENDING, IN_PROGRESS, CANCEL_REQUESTED, CANCELED, COMPLETED
  cancelReason: string | null;
  recorded: boolean;           // the sale / top-up / fee has been recorded
  recordError: string | null;  // paid, but not recorded (recorded false) or recorded with a problem
  result: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

function mapRow(r: any): TerminalCheckoutView {
  return {
    id: r.id,
    kind: r.kind,
    amountPence: r.amount_pence,
    status: r.status,
    cancelReason: r.cancel_reason || null,
    recorded: !!r.recorded_at,
    recordError: r.record_error || null,
    result: r.result || null,
    payload: r.payload || {},
    createdAt: r.created_at,
  };
}

async function getRow(id: string): Promise<any | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('square_checkouts').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Failed to load the Terminal payment: ${error.message}`);
  return data;
}

/** The checkout the Terminal is still working on, if any (so a refreshed till can pick it up). */
export async function getOpenCheckout(): Promise<TerminalCheckoutView | null> {
  const supabase = getSupabaseClient();
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from('square_checkouts').select('*')
    .not('status', 'in', '("COMPLETED","CANCELED")')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Failed to load Terminal payments: ${error.message}`);
  if (!data || data.length === 0) return null;
  return refreshTerminalCheckout(data[0].id);
}

export class TerminalBusyError extends Error {
  checkout: TerminalCheckoutView;
  constructor(checkout: TerminalCheckoutView) {
    super(`The Terminal is already waiting for £${(checkout.amountPence / 100).toFixed(2)} — finish or cancel that first.`);
    this.checkout = checkout;
  }
}

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * Send a card payment to the Terminal. expectedPence is what the till showed — if the
 * server works out a different amount (prices changed, renewal part-paid since), it's
 * refused so the customer is never asked for the wrong amount.
 */
export async function startTerminalCheckout(opts: {
  kind: TerminalKind;
  expectedPence: number;
  staff: string;
  userName?: string;
  items?: BasketItem[];
  createdBy: string;
}): Promise<TerminalCheckoutView> {
  const setup = await getTerminalSetup();
  if (!setup.enabled) throw new Error('The Square Terminal is not set up');

  const open = await getOpenCheckout();
  if (open) throw new TerminalBusyError(open);

  const supabase = getSupabaseClient();
  let amountPence = 0;
  let payload: Record<string, unknown> = {};
  let referenceId = '';
  let note = '';

  if (opts.kind === 'sale') {
    const items = opts.items || [];
    if (items.length === 0) throw new Error('The basket is empty');
    const { data, error } = await supabase.rpc('bar_quote_sale', {
      p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      p_user_name: opts.userName || null,
    });
    if (error) throw new Error(error.message);
    amountPence = Number(data);
    payload = { items: items, userName: opts.userName || null, staff: opts.staff };
    referenceId = opts.userName ? `BAR ${opts.userName}` : 'BAR SALE';
    note = `Bar sale ${pounds(amountPence)}`;
  } else if (opts.kind === 'topup') {
    if (!opts.userName) throw new Error('Choose a member');
    amountPence = Math.round(opts.expectedPence);
    payload = { userName: opts.userName, staff: opts.staff };
    referenceId = `TOPUP ${opts.userName}`;
    note = `Bar account top-up ${pounds(amountPence)}`;
  } else {
    if (!opts.userName) throw new Error('Choose a member');
    const due = await getTillRenewalsDue();
    let found = null;
    for (const r of due) {
      if (r.userName.toLowerCase() === opts.userName.toLowerCase()) found = r;
    }
    if (!found) throw new Error('This renewal has nothing to pay now');
    amountPence = Math.round(found.outstanding * 100);
    payload = { userName: found.userName, staff: opts.staff };
    referenceId = `SUBS ${found.userName}`;
    note = `Membership fees ${pounds(amountPence)}`;
  }

  if (!Number.isFinite(amountPence) || amountPence <= 0) throw new Error('A positive amount is required');
  if (amountPence !== Math.round(opts.expectedPence)) {
    throw new Error(`The amount has changed to ${pounds(amountPence)} — check it and try again.`);
  }

  const checkout = await createTerminalCheckout({
    idempotencyKey: crypto.randomUUID(),
    amountPence: amountPence,
    deviceId: setup.deviceId,
    referenceId: referenceId,
    note: note,
  });

  const { data: row, error: insertError } = await supabase.from('square_checkouts').insert({
    id: checkout.id,
    kind: opts.kind,
    payload: payload,
    amount_pence: amountPence,
    device_id: setup.deviceId,
    status: checkout.status,
    created_by: opts.createdBy,
  }).select('*').single();
  if (insertError) {
    // Don't leave the Terminal asking for money we'd never record
    try { await cancelTerminalCheckout(checkout.id); } catch { /* best effort */ }
    throw new Error(`Failed to save the Terminal payment: ${insertError.message}`);
  }
  return mapRow(row);
}

/** Ask Square for the latest status and, if it's been paid, record it (once). */
export async function refreshTerminalCheckout(id: string): Promise<TerminalCheckoutView> {
  let row = await getRow(id);
  if (!row) throw new Error('Terminal payment not found');

  if (!isFinalStatus(row.status)) {
    const checkout = await getTerminalCheckout(id);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.from('square_checkouts').update({
      status: checkout.status,
      cancel_reason: checkout.cancelReason,
      square_payment_id: checkout.paymentId,
      updated_at: new Date().toISOString(),
    }).eq('id', id).select('*').single();
    if (error) throw new Error(`Failed to update the Terminal payment: ${error.message}`);
    row = data;
  }

  if (row.status === 'COMPLETED' && !row.recorded_at) {
    row = await recordCheckout(row);
  }
  return mapRow(row);
}

/** Staff pressed Cancel on the till. Square may say it's too late (already paid). */
export async function cancelCheckout(id: string): Promise<TerminalCheckoutView> {
  try {
    await cancelTerminalCheckout(id);
  } catch {
    // Already completed or cancelled — the refresh below shows which
  }
  return refreshTerminalCheckout(id);
}

/**
 * Record a COMPLETED checkout. Claims the row first (recorded_at), so the till's poll and
 * Square's webhook can't both record it. If the recording itself fails, nothing was
 * written, so the claim is released and the error kept — the next poll tries again, and
 * /admin/bar-devices lists it until it's sorted.
 */
async function recordCheckout(row: any): Promise<any> {
  const supabase = getSupabaseClient();
  const { data: claimed, error: claimError } = await supabase.from('square_checkouts')
    .update({ recorded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', row.id).is('recorded_at', null)
    .select('*');
  if (claimError) throw new Error(`Failed to record the Terminal payment: ${claimError.message}`);
  if (!claimed || claimed.length === 0) {
    // Someone else (the webhook, another poll) has it
    return (await getRow(row.id)) || row;
  }

  const payload = row.payload || {};
  const paymentId: string = row.square_payment_id || '';
  const staff = String(payload.staff || '');
  let result: Record<string, unknown> = {};
  let recordError: string | null = null;

  try {
    if (row.kind === 'sale') {
      const sale = await visitorSale('card', payload.items || [], staff, payload.userName || undefined);
      result = { saleId: sale.saleId, totalPence: sale.totalPence };
      if (sale.totalPence !== row.amount_pence) {
        recordError = `Sale recorded at ${pounds(sale.totalPence)} but ${pounds(row.amount_pence)} was taken on the Terminal (prices changed while paying).`;
      }
      const { error } = await supabase.from('bar_sales').update({ square_payment_id: paymentId || null }).eq('id', sale.saleId);
      if (error) console.error('[bar-square] could not save the Square payment id on the sale', error.message);
    } else if (row.kind === 'topup') {
      const note = paymentId ? `Square ${paymentId}` : 'Square Terminal';
      const balancePence = await topUp(String(payload.userName), row.amount_pence, staff, note, 'card');
      result = { balancePence: balancePence };
    } else {
      const renewalPaymentId = await recordTillRenewalPayment({
        userName: String(payload.userName),
        method: 'card',
        amount: row.amount_pence / 100,
        staff: staff,
        recordedBy: row.created_by,
      });
      result = { paymentId: renewalPaymentId };
      if (paymentId) {
        const { error } = await supabase.from('renewal_payments')
          .update({ reference: `TILL ${payload.userName} SQ ${paymentId}` })
          .eq('payment_id', renewalPaymentId);
        if (error) console.error('[bar-square] could not add the Square payment id to the renewal payment', error.message);
      }
    }
  } catch (err) {
    // Nothing was recorded — release the claim so it can be retried, and keep the reason
    const message = err instanceof Error ? err.message : 'Could not record the payment';
    const { data } = await supabase.from('square_checkouts').update({
      recorded_at: null,
      record_error: `Paid on the Terminal but not recorded: ${message}`,
      updated_at: new Date().toISOString(),
    }).eq('id', row.id).select('*').single();
    return data || row;
  }

  const { data, error } = await supabase.from('square_checkouts').update({
    result: result,
    record_error: recordError,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).select('*').single();
  if (error) console.error('[bar-square] could not save the result', error.message);
  return data || row;
}

/** Paid on the Terminal but not (cleanly) recorded — listed on /admin/bar-devices. */
export async function getCheckoutsNeedingAttention(): Promise<TerminalCheckoutView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('square_checkouts').select('*')
    .eq('status', 'COMPLETED')
    .not('record_error', 'is', null)
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to load Terminal payments: ${error.message}`);
  const list: TerminalCheckoutView[] = [];
  for (const r of data || []) list.push(mapRow(r));
  return list;
}

/** Admin has sorted it out by hand (e.g. refunded, or recorded in Banking). */
export async function markCheckoutDealtWith(id: string, by: string): Promise<void> {
  const supabase = getSupabaseClient();
  const row = await getRow(id);
  if (!row) throw new Error('Terminal payment not found');
  const result = Object.assign({}, row.result || {}, { dealtWithBy: by, dealtWithAt: new Date().toISOString(), previousError: row.record_error });
  const { error } = await supabase.from('square_checkouts').update({
    recorded_at: row.recorded_at || new Date().toISOString(),
    record_error: null,
    result: result,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw new Error(`Failed to update the Terminal payment: ${error.message}`);
}
