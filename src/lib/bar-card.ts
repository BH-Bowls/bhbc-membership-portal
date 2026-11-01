// src/lib/bar-card.ts
// Membership card QR codes and bar PINs — proof that a member is really at the till
// before their bar account is charged or topped up (see 0093_bar_card_pin.sql).
//
// A card code is BHBC1.<user id, no dashes>.<card_token>. One token per member, 32
// random hex characters — far too many to guess, so a code can't be made up from a
// username. Resetting it stops every old card working; scanning a found card can make
// its token current again. No secrets: the tokens live in the database, so a copy of
// production restored to dev keeps every card working there. The till checks scans
// offline against a SHA-256 of each member's current code (getTillCards).
//
// A PIN typed at the till is sent with each payment and checked here every time.
//
// Server only.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSupabaseClient } from './supabase';
import { getConfig } from './config-supabase';

const CARD_PREFIX = 'BHBC1';
const PIN_MAX_FAILURES = 5;

export type AccountProofMode = 'off' | 'testing' | 'all';

/** What the till sends with Pay by Account / Top Up. */
export interface AccountProof {
  cardCode?: string;
  pin?: string;
  // Set by the till when syncing a sale it queued while offline — a card of this
  // member's that has been reset since still counts.
  offlineReplay?: boolean;
}

interface CardUserRow {
  id: string;
  username: string;
  card_token: string;
  bar_pin_hash: string | null;
  bar_pin_failures: number;
}

function compactId(userId: string): string {
  return userId.replace(/-/g, '');
}

function expandId(compact: string): string {
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

function buildCardCode(userId: string, token: string): string {
  return `${CARD_PREFIX}.${compactId(userId)}.${token}`;
}

/** SHA-256 hex of a card code — what the till compares a scan against. */
function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

/** A card code's user id and token, or null if it isn't one. */
function parseCardCode(code: string): { userId: string; token: string } | null {
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== CARD_PREFIX) return null;
  const [, id, token] = parts;
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{32}$/.test(token)) return null;
  return { userId: expandId(id), token: token };
}

async function getCardUser(column: 'id' | 'username', value: string): Promise<CardUserRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, username, card_token, bar_pin_hash, bar_pin_failures')
    .eq('is_active', true)
    .eq(column, value)
    .maybeSingle();
  if (error) throw new Error(`Failed to load member: ${error.message}`);
  return data as CardUserRow | null;
}

async function updateCardUser(userId: string, updates: Partial<Omit<CardUserRow, 'id' | 'username'>>): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('users').update(updates).eq('id', userId);
  if (error) throw new Error(`Failed to update member: ${error.message}`);
}

// ── Cards ─────────────────────────────────────────────────────────────────────

/** The member's current card code (for the My Account QR and printed labels). */
export async function getCardCode(userName: string): Promise<string> {
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  return buildCardCode(user.id, user.card_token);
}

/** Current card codes for many members at once, keyed by lower-case username. */
export async function getCardCodes(): Promise<Map<string, string>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('users').select('id, username, card_token').eq('is_active', true);
  if (error) throw new Error(`Failed to load cards: ${error.message}`);
  const codes = new Map<string, string>();
  for (const row of data ?? []) codes.set(row.username.toLowerCase(), buildCardCode(row.id, row.card_token));
  return codes;
}

/** New token — every existing card (and screenshot) for the member stops working. */
export async function resetCard(userName: string): Promise<string> {
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  const token = crypto.randomBytes(16).toString('hex');
  await updateCardUser(user.id, { card_token: token });
  return buildCardCode(user.id, token);
}

/**
 * Whose card a scanned code is, and whether it's the current one. 'invalid' means it
 * isn't a membership card code, or the member no longer exists.
 */
export async function checkCard(code: string): Promise<{ status: 'current' | 'replaced' | 'invalid'; userName: string | null }> {
  const parsed = parseCardCode(code);
  if (!parsed) return { status: 'invalid', userName: null };
  const user = await getCardUser('id', parsed.userId);
  if (!user) return { status: 'invalid', userName: null };
  return { status: user.card_token === parsed.token ? 'current' : 'replaced', userName: user.username };
}

/**
 * Make a found card the member's current one again (it must be theirs). Any card
 * issued since it was replaced stops working.
 */
export async function restoreCard(userName: string, code: string): Promise<void> {
  const parsed = parseCardCode(code);
  if (!parsed) throw new Error('That isn’t a membership card');
  const user = await getCardUser('username', userName);
  if (!user || user.id !== parsed.userId) throw new Error('That card belongs to a different member');
  await updateCardUser(user.id, { card_token: parsed.token });
}

// ── PINs ──────────────────────────────────────────────────────────────────────

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

export async function setPin(userName: string, pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('The PIN must be 4 digits');
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  await updateCardUser(user.id, { bar_pin_hash: await bcrypt.hash(pin, 10), bar_pin_failures: 0 });
}

/** Removes the PIN (and any lockout) — the member sets a new one in My Account or at the till. */
export async function clearPin(userName: string): Promise<void> {
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  await updateCardUser(user.id, { bar_pin_hash: null, bar_pin_failures: 0 });
}

export async function getPinStatus(userName: string): Promise<{ hasPin: boolean; locked: boolean }> {
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  return { hasPin: !!user.bar_pin_hash, locked: user.bar_pin_failures >= PIN_MAX_FAILURES };
}

export type PinCheckResult =
  | { ok: true }
  | { ok: false; reason: 'no_pin' | 'locked' | 'wrong'; attemptsLeft?: number };

/**
 * Check a PIN typed at the till — when it's first typed, and again with each payment.
 * Wrong counts towards the lockout.
 */
export async function verifyPin(userName: string, pin: string): Promise<PinCheckResult> {
  const user = await getCardUser('username', userName);
  if (!user || !user.bar_pin_hash) return { ok: false, reason: 'no_pin' };
  if (user.bar_pin_failures >= PIN_MAX_FAILURES) return { ok: false, reason: 'locked' };
  if (isValidPin(pin) && await bcrypt.compare(pin, user.bar_pin_hash)) {
    if (user.bar_pin_failures > 0) await updateCardUser(user.id, { bar_pin_failures: 0 });
    return { ok: true };
  }
  const failures = user.bar_pin_failures + 1;
  await updateCardUser(user.id, { bar_pin_failures: failures });
  if (failures >= PIN_MAX_FAILURES) return { ok: false, reason: 'locked' };
  return { ok: false, reason: 'wrong', attemptsLeft: PIN_MAX_FAILURES - failures };
}

// ── Proof at the till ─────────────────────────────────────────────────────────

export async function getProofMode(): Promise<AccountProofMode> {
  const value = (await getConfig()).bar_account_proof;
  return value === 'testing' || value === 'all' ? value : 'off';
}

async function getRoles(userId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (error) throw new Error(`Failed to load roles: ${error.message}`);
  return (data ?? []).map((r: { role: string }) => r.role);
}

/**
 * Null if the till may charge or top up this member's account, otherwise the reason it
 * can't — checked by every route that does (purchase, topup, Square top-up), so the
 * till screen isn't the only thing standing in the way.
 */
export async function checkAccountProof(userName: string, proof: AccountProof | undefined): Promise<string | null> {
  const mode = await getProofMode();
  if (mode === 'off') return null;
  const user = await getCardUser('username', userName);
  if (!user) return 'Member not found';
  if (mode === 'testing' && !(await getRoles(user.id)).includes('Testing')) return null;

  if (proof && typeof proof.cardCode === 'string') {
    const parsed = parseCardCode(proof.cardCode);
    if (parsed && parsed.userId === user.id) {
      if (parsed.token === user.card_token) {
        // Scanning the card also clears a PIN lockout
        if (user.bar_pin_failures > 0) await updateCardUser(user.id, { bar_pin_failures: 0 });
        return null;
      }
      if (proof.offlineReplay) return null;
      return 'This card has been replaced — scan the member’s current card or enter their PIN.';
    }
  }
  if (proof && typeof proof.pin === 'string') {
    const result = await verifyPin(user.username, proof.pin);
    if (result.ok) return null;
    if (result.reason === 'locked') return 'The PIN is locked after too many wrong tries — scan the member’s card.';
    if (result.reason === 'no_pin') return 'This member has no PIN — scan their card.';
    return 'Wrong PIN — enter it again.';
  }
  return 'Scan the member’s card or enter their PIN first.';
}

export interface TillCard {
  userName: string;
  userId: string;        // no dashes, as in the card code
  cardHash: string;      // SHA-256 of the current card code
  hasPin: boolean;
  pinLocked: boolean;
  proofRequired: boolean;
}

/**
 * Everything the till needs to check scans (including offline) and know who needs a
 * card or PIN. Holds no secrets: the hashes can't be turned back into card codes.
 */
export async function getTillCards(): Promise<{ mode: AccountProofMode; cards: TillCard[] }> {
  const mode = await getProofMode();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select('id, username, card_token, bar_pin_hash, bar_pin_failures, user_roles(role)')
    .eq('is_active', true);
  if (error) throw new Error(`Failed to load cards: ${error.message}`);
  const rows = (data ?? []) as (Omit<CardUserRow, 'bar_pin_failures'> & { bar_pin_failures: number; user_roles: { role: string }[] | null })[];
  const cards = rows.map((row) => {
    const roles = (row.user_roles ?? []).map((r) => r.role);
    return {
      userName: row.username,
      userId: compactId(row.id),
      cardHash: hashCode(buildCardCode(row.id, row.card_token)),
      hasPin: !!row.bar_pin_hash,
      pinLocked: row.bar_pin_failures >= PIN_MAX_FAILURES,
      proofRequired: mode === 'all' || (mode === 'testing' && roles.includes('Testing')),
    };
  });
  return { mode: mode, cards: cards };
}
