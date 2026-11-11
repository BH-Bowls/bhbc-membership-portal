// src/lib/bar-card.ts
// Membership card QR codes and bar PINs — proof that a member is really at the till
// before their bar account is charged or topped up (see 0093_bar_card_pin.sql).
//
// One token per member (card_token), 32 random hex characters — far too many to guess.
// It appears in two kinds of code:
//   * BHBC1.<user id, no dashes>.<card_token> — the member's phone QR on My Account (and
//     the older named printed cards).
//   * BHBC2.<card_token> — a blank printed bar card, with no name. A blank card means
//     nothing until it's assigned to a member (assignCard, at the till or in Admin
//     Members): its token then becomes their card_token, so the old card stops working
//     and their phone QR carries on with the new token. No card history is kept; a
//     replaced blank card is just a blank card again.
// Resetting the token (My Account / Admin Members) stops every card working. No secrets:
// the tokens live in the database, so a copy of production restored to dev keeps every
// card working there. The till checks scans offline against SHA-256s of each member's
// current codes (getTillCards).
//
// A PIN (4 to 6 digits) typed at the till is sent with each payment and checked here
// every time. The bar person serving uses their own card or PIN the same way — to
// approve an account payment for a member who can't show theirs, and before a Day End,
// Void, Refund or Cash Movement (bar_staff_proof). Their approvals are logged in
// bar_staff_approvals.
//
// Server only.

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { getSupabaseClient } from './supabase';
import { getConfig } from './config-supabase';
import { getAllUsers } from './members-supabase';

const CARD_PREFIX = 'BHBC1';
const BLANK_CARD_PREFIX = 'BHBC2';
const PIN_MAX_FAILURES = 5;

export type AccountProofMode = 'off' | 'testing' | 'all';

/** One person's card scan or typed PIN. */
export interface PersonProof {
  cardCode?: string;
  pin?: string;
}

/** What the till sends with Pay by Account / Top Up. */
export interface AccountProof extends PersonProof {
  // The bar person serving approving it with their own card or PIN, instead of the member
  serverApproval?: PersonProof;
  // Set by the till when syncing a sale it queued while offline — a card that has been
  // reset since still counts.
  offlineReplay?: boolean;
}

interface CardUserRow {
  id: string;
  username: string;
  card_token: string;
  bar_pin_hash: string | null;
  bar_pin_failures: number;
  card_issued_at: string | null;
  card_issued_by: string | null;
}

const CARD_USER_COLUMNS = 'id, username, card_token, bar_pin_hash, bar_pin_failures, card_issued_at, card_issued_by';

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

function buildBlankCardCode(token: string): string {
  return `${BLANK_CARD_PREFIX}.${token}`;
}

/**
 * A card code's token, and the user id it carries (null for a blank card, BHBC2), or
 * null if it isn't a card code at all.
 */
function parseCardCode(code: string): { userId: string | null; token: string } | null {
  const parts = code.trim().toLowerCase().split('.');
  if (parts.length === 2 && parts[0] === BLANK_CARD_PREFIX.toLowerCase()) {
    if (!/^[0-9a-f]{32}$/.test(parts[1])) return null;
    return { userId: null, token: parts[1] };
  }
  if (parts.length !== 3 || parts[0] !== CARD_PREFIX.toLowerCase()) return null;
  const id = parts[1];
  const token = parts[2];
  if (!/^[0-9a-f]{32}$/.test(id) || !/^[0-9a-f]{32}$/.test(token)) return null;
  return { userId: expandId(id), token: token };
}

async function getCardUser(column: 'id' | 'username' | 'card_token', value: string): Promise<CardUserRow | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select(CARD_USER_COLUMNS)
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

export type CardCheck = {
  // current: it's userName's current card (or phone QR). replaced: an old phone QR or
  // named card of userName's. unassigned: a blank card nobody has (new, or replaced
  // since). invalid: not a card code, or the member no longer exists.
  status: 'current' | 'replaced' | 'unassigned' | 'invalid';
  userName: string | null;
  blank: boolean;   // a blank printed card (BHBC2), as opposed to a phone QR / named card
};

/** Whose card a scanned code is, and whether it's the current one. */
export async function checkCard(code: string): Promise<CardCheck> {
  const parsed = parseCardCode(code);
  if (!parsed) return { status: 'invalid', userName: null, blank: false };
  if (parsed.userId === null) {
    const holder = await getCardUser('card_token', parsed.token);
    if (!holder) return { status: 'unassigned', userName: null, blank: true };
    return { status: 'current', userName: holder.username, blank: true };
  }
  const user = await getCardUser('id', parsed.userId);
  if (!user) return { status: 'invalid', userName: null, blank: false };
  return { status: user.card_token === parsed.token ? 'current' : 'replaced', userName: user.username, blank: false };
}

/** When the member's current card was assigned, and by whom (username) — null if never. */
export interface CardIssued {
  issuedAt: string | null;
  issuedBy: string | null;
}

/**
 * Give a member a blank card: its token becomes theirs, so their previous card stops
 * working and their phone QR switches to the new token. issuedBy is the username of
 * the bar person or admin doing it. Throws a message fit to show if the card can't be
 * used (not a blank card, already this member's, or someone else's).
 */
export async function assignCard(userName: string, code: string, issuedBy: string): Promise<CardIssued> {
  const parsed = parseCardCode(code);
  if (!parsed) throw new Error('That isn’t a bar card.');
  if (parsed.userId !== null) throw new Error('That’s a phone or named card — scan one of the blank bar cards.');
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  if (user.card_token === parsed.token) throw new Error('That’s already their card — nothing to change.');
  const holder = await getCardUser('card_token', parsed.token);
  if (holder) throw new Error(`That card belongs to ${await memberName(holder.username)}. Give them a new card first if it’s moving.`);
  const issuedAt = new Date().toISOString();
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('users')
    .update({ card_token: parsed.token, card_issued_at: issuedAt, card_issued_by: issuedBy })
    .eq('id', user.id);
  if (error) {
    // The unique index — the card is held by a member who has left
    if (error.code === '23505') throw new Error('That card belongs to a former member — use another card.');
    throw new Error(`Failed to assign the card: ${error.message}`);
  }
  return { issuedAt: issuedAt, issuedBy: issuedBy };
}

/** A member's full name for messages, or the username if it can't be found. */
export async function memberName(userName: string): Promise<string> {
  try {
    for (const u of await getAllUsers()) {
      if (u.userName === userName) return u.fullName || userName;
    }
  } catch { /* fall back to the username */ }
  return userName;
}

export async function getCardIssued(userName: string): Promise<CardIssued> {
  const user = await getCardUser('username', userName);
  if (!user) throw new Error('Member not found');
  return { issuedAt: user.card_issued_at, issuedBy: user.card_issued_by };
}

// ── PINs ──────────────────────────────────────────────────────────────────────

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4,6}$/.test(pin);
}

export async function setPin(userName: string, pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error('The PIN must be 4 to 6 digits');
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

function modeFrom(value: string | undefined): AccountProofMode {
  return value === 'testing' || value === 'all' ? value : 'off';
}

export async function getProofMode(): Promise<AccountProofMode> {
  return modeFrom((await getConfig()).bar_account_proof);
}

async function getRoles(userId: string): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
  if (error) throw new Error(`Failed to load roles: ${error.message}`);
  return (data ?? []).map((r: { role: string }) => r.role);
}

/**
 * Checks one person's card or PIN. Null if it's good, otherwise why not. A wrong PIN
 * counts towards their lockout; a current card clears it.
 */
async function checkPersonProof(user: CardUserRow, proof: PersonProof | undefined, offlineReplay: boolean): Promise<string | null> {
  if (proof && typeof proof.cardCode === 'string') {
    const parsed = parseCardCode(proof.cardCode);
    // A blank card only says whose it is through the token itself
    if (parsed && parsed.userId === null) {
      if (parsed.token === user.card_token) {
        if (user.bar_pin_failures > 0) await updateCardUser(user.id, { bar_pin_failures: 0 });
        return null;
      }
      // Queued offline when it was their card, and replaced since — fine, unless it's
      // now someone else's
      if (offlineReplay && !(await getCardUser('card_token', parsed.token))) return null;
      return 'This card isn’t theirs (or has been replaced) — scan their current card or enter the PIN.';
    }
    if (parsed && parsed.userId === user.id) {
      if (parsed.token === user.card_token) {
        if (user.bar_pin_failures > 0) await updateCardUser(user.id, { bar_pin_failures: 0 });
        return null;
      }
      if (offlineReplay) return null;
      return 'This card has been replaced — scan the current card or enter the PIN.';
    }
  }
  if (proof && typeof proof.pin === 'string') {
    const result = await verifyPin(user.username, proof.pin);
    if (result.ok) return null;
    if (result.reason === 'locked') return 'The PIN is locked after too many wrong tries — scan the card instead.';
    if (result.reason === 'no_pin') return 'No PIN has been set — scan the card instead.';
    return 'Wrong PIN — enter it again.';
  }
  return 'Scan the card or enter the PIN first.';
}

/**
 * May the till charge or top up this member's account? Checked by every route that does
 * (purchase, topup, Square top-up), so the till screen isn't the only thing in the way.
 * Passes with the member's own card or PIN, or — when they can't show either — with the
 * bar person serving (staff) approving it with theirs; approvedBy then says how, for
 * logApproval.
 */
export async function checkAccountProof(
  userName: string,
  proof: AccountProof | undefined,
  staff: string,
): Promise<{ error: string | null; approvedBy?: 'pin' | 'card' }> {
  const mode = await getProofMode();
  if (mode === 'off') return { error: null };
  const user = await getCardUser('username', userName);
  if (!user) return { error: 'Member not found' };
  if (mode === 'testing' && !(await getRoles(user.id)).includes('Testing')) return { error: null };
  return checkMemberOrServerProof(user, proof, staff);
}

/**
 * The member's own card or PIN, or the bar person serving (staff) approving with theirs.
 * approvedBy says how the server approved, if they did.
 */
async function checkMemberOrServerProof(
  user: CardUserRow,
  proof: AccountProof | undefined,
  staff: string,
): Promise<{ error: string | null; approvedBy?: 'pin' | 'card' }> {
  const offlineReplay = !!(proof && proof.offlineReplay);
  if (proof && proof.serverApproval) {
    if (!staff) return { error: 'Select who’s serving first.' };
    const server = await getCardUser('username', staff);
    if (!server) return { error: 'The bar person serving wasn’t found.' };
    const error = await checkPersonProof(server, proof.serverApproval, offlineReplay);
    if (error) return { error: `Approval by the person serving: ${error}` };
    return { error: null, approvedBy: proof.serverApproval.cardCode ? 'card' : 'pin' };
  }
  const error = await checkPersonProof(user, proof, offlineReplay);
  return { error: error };
}

/**
 * Assigning a blank card at the till: whatever the bar_account_proof setting, the member
 * shows their phone QR (or current card, or PIN), or the bar person serving approves
 * with their own card or PIN. Not for offline use.
 */
export async function checkCardAssignProof(userName: string, proof: AccountProof | undefined, staff: string): Promise<string | null> {
  const user = await getCardUser('username', userName);
  if (!user) return 'Member not found';
  const plain: AccountProof | undefined = proof ? { cardCode: proof.cardCode, pin: proof.pin, serverApproval: proof.serverApproval } : undefined;
  return (await checkMemberOrServerProof(user, plain, staff)).error;
}

export async function getStaffProofMode(): Promise<AccountProofMode> {
  return modeFrom((await getConfig()).bar_staff_proof);
}

/**
 * Before a Day End, Void, Refund or Cash Movement: the bar person serving (staff)
 * confirms with their own card or PIN, when the bar_staff_proof setting says they must.
 * method is how they confirmed (for logApproval), or null if they didn't need to.
 */
export async function checkStaffProof(
  staff: string,
  proof: PersonProof | undefined,
): Promise<{ error: string | null; method: 'pin' | 'card' | null }> {
  const mode = await getStaffProofMode();
  if (mode === 'off') return { error: null, method: null };
  if (!staff) return { error: 'Select who’s serving first.', method: null };
  const server = await getCardUser('username', staff);
  if (!server) return { error: 'The bar person serving wasn’t found.', method: null };
  if (mode === 'testing' && !(await getRoles(server.id)).includes('Testing')) return { error: null, method: null };
  const error = await checkPersonProof(server, proof, false);
  if (error) return { error: error, method: null };
  return { error: null, method: proof && proof.cardCode ? 'card' : 'pin' };
}

/** Records a bar person's approval (see 0095_bar_staff_approvals.sql). Never throws. */
export async function logApproval(entry: {
  kind: 'account' | 'day_end' | 'void' | 'refund' | 'cash_movement';
  staff: string;
  method: 'pin' | 'card';
  userName?: string;
  amountPence?: number;
  saleId?: string;
  note?: string;
}): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('bar_staff_approvals').insert({
      kind: entry.kind,
      staff: entry.staff,
      method: entry.method,
      user_name: entry.userName ?? null,
      amount_pence: entry.amountPence ?? null,
      sale_id: entry.saleId ?? null,
      note: entry.note ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error('[bar-card] Failed to log a staff approval:', err);
  }
}

/** Sale ids (of those given) that the bar person serving approved — for the till's Sales list. */
export async function getApprovedSaleIds(saleIds: string[]): Promise<Set<string>> {
  if (saleIds.length === 0) return new Set();
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('bar_staff_approvals').select('sale_id').eq('kind', 'account').in('sale_id', saleIds);
  if (error) throw new Error(`Failed to load approvals: ${error.message}`);
  return new Set((data ?? []).map((r: { sale_id: string }) => r.sale_id));
}

export interface TillCard {
  userName: string;
  userId: string;        // no dashes, as in the card code
  cardHash: string;      // SHA-256 of the current phone QR code (BHBC1)
  blankCardHash: string; // SHA-256 of the same token as a blank card code (BHBC2)
  cardIssuedAt: string | null;  // when their current blank card was assigned (null = never)
  cardIssuedBy: string | null;  // who assigned it (username)
  hasPin: boolean;
  pinLocked: boolean;
  proofRequired: boolean;       // as a member: for Pay by Account / Top Up
  staffProofRequired: boolean;  // as the bar person serving: for Day End, Void, Refund, Cash Movement
}

/**
 * Everything the till needs to check scans (including offline) and know who needs a
 * card or PIN. Holds no secrets: the hashes can't be turned back into card codes.
 */
export async function getTillCards(): Promise<{ cards: TillCard[] }> {
  const config = await getConfig();
  const mode = modeFrom(config.bar_account_proof);
  const staffMode = modeFrom(config.bar_staff_proof);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('users')
    .select(`${CARD_USER_COLUMNS}, user_roles(role)`)
    .eq('is_active', true);
  if (error) throw new Error(`Failed to load cards: ${error.message}`);
  const rows = (data ?? []) as (CardUserRow & { user_roles: { role: string }[] | null })[];
  const cards = rows.map((row) => {
    const testing = (row.user_roles ?? []).some((r) => r.role === 'Testing');
    return {
      userName: row.username,
      userId: compactId(row.id),
      cardHash: hashCode(buildCardCode(row.id, row.card_token)),
      blankCardHash: hashCode(buildBlankCardCode(row.card_token)),
      cardIssuedAt: row.card_issued_at,
      cardIssuedBy: row.card_issued_by,
      hasPin: !!row.bar_pin_hash,
      pinLocked: row.bar_pin_failures >= PIN_MAX_FAILURES,
      proofRequired: mode === 'all' || (mode === 'testing' && testing),
      staffProofRequired: staffMode === 'all' || (staffMode === 'testing' && testing),
    };
  });
  return { cards: cards };
}
