// src/lib/renewals-xero.ts
// Renewals → Xero summary journal (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §6).
//
// The portal keeps every member-level event. Each event becomes a few "postings" (debit
// or credit, account, amount, member). Xero gets one Manual Journal per day, with the
// postings summed by account — no member names. The debtors report adds up the same
// postings per member, so it always agrees with what was exported.
//
// Events:
//   - a renewal submitted (renewals.submitted_at)  Dr Membership debtors, Cr each fee account
//   - a renewal voided (renewals.voided_at)         the reverse
//   - renewal_transactions rows:
//       payment  Dr clearing (by source), Cr Membership debtors; donation → Cr Donations;
//                Banking's "difference" → Membership debtors against Adjustments
//       charge   Dr Membership debtors, Cr the fee type's account
//       credit   Dr the fee type's account, Cr Membership debtors
//       refund   Dr Membership debtors, Cr Transfers clearing (bank) or Stripe clearing
//
// A renewal voided before its submission was exported is left out altogether — the two
// cancel. Only seasons from config renewals_xero_first_season are exported.

import { getSupabaseClient } from './supabase';
import { getConfig, updateConfig } from './config-supabase';
import { getAllUsers } from './members-supabase';
import { getCurrentSeasonYear } from './renewals-supabase';
import { XERO_JOURNAL_HEADER, pounds, pushJournalRows, type JournalLine } from './xero-journal-csv';

// ============================================================================
// CONFIG
// ============================================================================

/** Account keys, in the order the Settings section lists them. */
export const RENEWALS_ACCOUNT_FIELDS: Array<[string, string, string]> = [
  // [account key, config key, label]
  ['debtors', 'renewals_nominal_debtors_account', 'Membership debtors'],
  ['transfersClearing', 'renewals_nominal_transfers_clearing_account', 'Membership transfers clearing'],
  ['stripeClearing', 'renewals_nominal_stripe_clearing_account', 'Stripe clearing'],
  ['playing', 'renewals_nominal_playing_account', 'Playing membership'],
  ['social', 'renewals_nominal_social_account', 'Social membership'],
  ['competitions', 'renewals_nominal_competitions_account', 'Competition entries'],
  ['club200', 'renewals_nominal_200_club_account', '200 Club entries (liability)'],
  ['donations', 'renewals_nominal_donations_account', 'Donations with renewals'],
  ['adjustments', 'renewals_nominal_adjustments_account', 'Renewal differences and write-offs'],
];

/** The bar's own accounts, shared (set on Admin config → Bar). */
const BAR_ACCOUNT_FIELDS: Array<[string, string, string]> = [
  ['cardClearing', 'bar_nominal_card_account', 'Card clearing'],
  ['cashInHand', 'bar_nominal_cash_account', 'Cash-in-hand'],
];

export const RENEWALS_OTHER_SETTINGS: Array<[string, string]> = [
  ['renewals_xero_tax_rate', 'Tax rate on every line'],
  ['renewals_xero_first_season', 'First season exported to Xero'],
];

export interface RenewalsXeroConfig {
  accounts: Record<string, string>;      // account key → Xero code
  accountNames: Record<string, string>;  // account key → label
  taxRate: string;
  firstSeason: number;
}

export async function getRenewalsXeroConfig(): Promise<RenewalsXeroConfig> {
  const config = await getConfig();
  const accounts: Record<string, string> = {};
  const accountNames: Record<string, string> = {};
  for (const [key, configKey, label] of RENEWALS_ACCOUNT_FIELDS) {
    accounts[key] = (config[configKey] || '').trim();
    accountNames[key] = label;
  }
  for (const [key, configKey, label] of BAR_ACCOUNT_FIELDS) {
    accounts[key] = (config[configKey] || '').trim();
    accountNames[key] = label;
  }
  let firstSeason = parseInt(config.renewals_xero_first_season || '', 10);
  if (isNaN(firstSeason)) firstSeason = 2027;
  return {
    accounts,
    accountNames,
    taxRate: (config.renewals_xero_tax_rate || '').trim() || 'No VAT',
    firstSeason,
  };
}

/** The settings the Settings section shows and edits (only renewals_* keys are writable). */
export async function getRenewalsXeroSettings(): Promise<Record<string, string>> {
  const config = await getConfig();
  const settings: Record<string, string> = {};
  for (const [, configKey] of RENEWALS_ACCOUNT_FIELDS) settings[configKey] = config[configKey] || '';
  for (const [configKey] of RENEWALS_OTHER_SETTINGS) settings[configKey] = config[configKey] || '';
  for (const [, configKey] of BAR_ACCOUNT_FIELDS) settings[configKey] = config[configKey] || '';
  return settings;
}

export async function saveRenewalsXeroSettings(updates: Record<string, string>): Promise<void> {
  const allowed: string[] = [];
  for (const [, configKey] of RENEWALS_ACCOUNT_FIELDS) allowed.push(configKey);
  for (const [configKey] of RENEWALS_OTHER_SETTINGS) allowed.push(configKey);

  const clean: Record<string, string> = {};
  for (const key of Object.keys(updates)) {
    if (allowed.includes(key)) clean[key] = String(updates[key]).trim();
  }
  if (clean.renewals_xero_first_season !== undefined) {
    const year = parseInt(clean.renewals_xero_first_season, 10);
    if (isNaN(year) || year < 2020 || year > 2100) {
      throw new Error('First season must be a year, e.g. 2027');
    }
  }
  await updateConfig(clean);
}

// ============================================================================
// EVENTS → POSTINGS
// ============================================================================

export interface Posting {
  date: string;        // YYYY-MM-DD (UK date)
  label: string;       // what happened, e.g. 'Renewals submitted'
  account: string;     // account key (see RENEWALS_ACCOUNT_FIELDS / BAR_ACCOUNT_FIELDS)
  debitPence: number;
  creditPence: number;
  username: string;
  eventKey: string;    // one event can make several postings; used to count events
}

/** A submission, void or transaction that hasn't been exported yet. */
interface PendingEvent {
  kind: 'submit' | 'void' | 'txn';
  id: string;
  postings: Posting[];
}

function toPence(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Math.round(Number(value) * 100);
}

/** The UK calendar date of a timestamp, as YYYY-MM-DD. */
export function toUkDate(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  let day = '';
  let month = '';
  let year = '';
  for (const p of parts) {
    if (p.type === 'day') day = p.value;
    if (p.type === 'month') month = p.value;
    if (p.type === 'year') year = p.value;
  }
  return `${year}-${month}-${day}`;
}

function post(
  postings: Posting[],
  date: string, label: string, account: string, side: 'Dr' | 'Cr', pence: number,
  username: string, eventKey: string
): void {
  if (pence === 0) return;
  // A negative amount simply lands on the other side
  let isDebit = side === 'Dr';
  if (pence < 0) isDebit = !isDebit;
  const abs = Math.abs(pence);
  postings.push({
    date, label, account,
    debitPence: isDebit ? abs : 0,
    creditPence: isDebit ? 0 : abs,
    username, eventKey,
  });
}

/** The fee lines of a renewal: [account key, pence]. */
function feeLines(row: Record<string, unknown>): Array<[string, number]> {
  return [
    ['playing', toPence(row.playing_fee)],
    ['social', toPence(row.social_fee)],
    ['competitions', toPence(row.competitions_fee)],
    ['club200', toPence(row.club_200_fee)],
  ];
}

function submissionPostings(row: Record<string, unknown>, reverse: boolean): Posting[] {
  const postings: Posting[] = [];
  const username = String(row.username);
  const timestamp = String(reverse ? row.voided_at : row.submitted_at);
  const date = toUkDate(timestamp);
  const label = reverse ? 'Renewals voided' : 'Renewals submitted';
  const eventKey = `${reverse ? 'void' : 'submit'}:${row.id}`;
  let total = 0;
  for (const [account, pence] of feeLines(row)) {
    post(postings, date, label, account, reverse ? 'Dr' : 'Cr', pence, username, eventKey);
    total += pence;
  }
  post(postings, date, label, 'debtors', reverse ? 'Cr' : 'Dr', total, username, eventKey);
  return postings;
}

const FEE_TYPE_ACCOUNT: Record<string, string> = {
  playing: 'playing',
  social: 'social',
  competitions: 'competitions',
  '200_club': 'club200',
};

function paymentClearing(row: Record<string, unknown>): { account: string; label: string } {
  if (row.source === 'till') {
    if (row.method === 'cash') return { account: 'cashInHand', label: 'Cash payments at the bar' };
    return { account: 'cardClearing', label: 'Card payments at the bar' };
  }
  if (row.source === 'stripe') return { account: 'stripeClearing', label: 'Online payments' };
  return { account: 'transfersClearing', label: 'Bank receipts matched' };
}

function transactionPostings(row: Record<string, unknown>): Posting[] {
  const postings: Posting[] = [];
  const username = String(row.username);
  const date = String(row.txn_date);
  const eventKey = `txn:${row.id}`;
  const amount = toPence(row.amount);

  if (row.kind === 'payment') {
    const donation = toPence(row.donation);
    const writeOff = toPence(row.write_off);
    const clearing = paymentClearing(row);
    post(postings, date, clearing.label, clearing.account, 'Dr', amount, username, eventKey);
    post(postings, date, clearing.label, 'debtors', 'Cr', amount - donation, username, eventKey);
    post(postings, date, 'Donations with renewals', 'donations', 'Cr', donation, username, eventKey);
    // write_off is added to what's owed: positive = owed more, negative = written off
    post(postings, date, 'Renewal differences', 'debtors', 'Dr', writeOff, username, eventKey);
    post(postings, date, 'Renewal differences', 'adjustments', 'Cr', writeOff, username, eventKey);
    return postings;
  }

  if (row.kind === 'charge' || row.kind === 'credit') {
    const feeAccount = FEE_TYPE_ACCOUNT[String(row.fee_type)];
    const isCharge = row.kind === 'charge';
    const label = isCharge ? 'Renewal adjustments (extra charge)' : 'Renewal adjustments (credit)';
    post(postings, date, label, 'debtors', isCharge ? 'Dr' : 'Cr', amount, username, eventKey);
    post(postings, date, label, feeAccount, isCharge ? 'Cr' : 'Dr', amount, username, eventKey);
    return postings;
  }

  // refund
  const viaStripe = row.refund_via === 'stripe';
  post(postings, date, 'Renewal refunds', 'debtors', 'Dr', amount, username, eventKey);
  post(postings, date, 'Renewal refunds', viaStripe ? 'stripeClearing' : 'transfersClearing', 'Cr', amount, username, eventKey);
  return postings;
}

// ============================================================================
// LOADING EVENTS
// ============================================================================

const RENEWAL_COLUMNS = 'id, username, season_year, submitted_at, voided_at, renewing_membership, playing_fee, social_fee, competitions_fee, club_200_fee, xero_submit_export_id, xero_void_export_id';

async function fetchAll(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Record<string, unknown>[]> {
  const pageSize = 1000;
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = (data || []) as Record<string, unknown>[];
    for (const r of page) rows.push(r);
    if (page.length < pageSize) break;
  }
  return rows;
}

/** Everything not yet exported. */
async function loadPendingEvents(firstSeason: number): Promise<PendingEvent[]> {
  const supabase = getSupabaseClient();
  const [submits, voids, txns] = await Promise.all([
    fetchAll((from, to) => supabase.from('renewals').select(RENEWAL_COLUMNS)
      .gte('season_year', firstSeason)
      .eq('renewing_membership', true)
      .not('submitted_at', 'is', null)
      .is('voided_at', null)                   // voided before export → left out with its void
      .is('xero_submit_export_id', null)
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('renewals').select(RENEWAL_COLUMNS)
      .gte('season_year', firstSeason)
      .not('voided_at', 'is', null)
      .not('xero_submit_export_id', 'is', null) // only a void of something already in Xero
      .is('xero_void_export_id', null)
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('renewal_transactions').select('*')
      .gte('season_year', firstSeason)
      .is('xero_export_id', null)
      .order('id').range(from, to)),
  ]);

  const events: PendingEvent[] = [];
  for (const row of submits) events.push({ kind: 'submit', id: String(row.id), postings: submissionPostings(row, false) });
  for (const row of voids) events.push({ kind: 'void', id: String(row.id), postings: submissionPostings(row, true) });
  for (const row of txns) events.push({ kind: 'txn', id: String(row.id), postings: transactionPostings(row) });
  return events;
}

/** Every posting already exported to Xero — for the debtors report. */
async function loadExportedPostings(firstSeason: number): Promise<Posting[]> {
  const supabase = getSupabaseClient();
  const [submitted, txns] = await Promise.all([
    fetchAll((from, to) => supabase.from('renewals').select(RENEWAL_COLUMNS)
      .gte('season_year', firstSeason)
      .not('xero_submit_export_id', 'is', null)
      .order('id').range(from, to)),
    fetchAll((from, to) => supabase.from('renewal_transactions').select('*')
      .gte('season_year', firstSeason)
      .not('xero_export_id', 'is', null)
      .order('id').range(from, to)),
  ]);

  const postings: Posting[] = [];
  for (const row of submitted) {
    for (const p of submissionPostings(row, false)) postings.push(p);
    if (row.xero_void_export_id) {
      for (const p of submissionPostings(row, true)) postings.push(p);
    }
  }
  for (const row of txns) {
    for (const p of transactionPostings(row)) postings.push(p);
  }
  return postings;
}

// ============================================================================
// JOURNALS
// ============================================================================

export interface JournalPreviewLine {
  description: string;
  accountKey: string;
  accountName: string;
  accountCode: string;
  debitPence: number;
  creditPence: number;
}

export interface JournalPreview {
  date: string;
  narration: string;
  lines: JournalPreviewLine[];
  totalDebitPence: number;
  totalCreditPence: number;
}

function formatNarrationDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const d = new Date(Number(year), Number(month) - 1, Number(day));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Sum postings into one journal per date, one line per (what happened, account, side). */
function buildJournals(postings: Posting[], config: RenewalsXeroConfig): JournalPreview[] {
  const byDate = new Map<string, Map<string, { label: string; account: string; isDebit: boolean; pence: number; events: Set<string> }>>();
  for (const p of postings) {
    let groups = byDate.get(p.date);
    if (!groups) {
      groups = new Map();
      byDate.set(p.date, groups);
    }
    const isDebit = p.debitPence > 0;
    const key = `${p.label}|${p.account}|${isDebit ? 'Dr' : 'Cr'}`;
    let group = groups.get(key);
    if (!group) {
      group = { label: p.label, account: p.account, isDebit, pence: 0, events: new Set() };
      groups.set(key, group);
    }
    group.pence += isDebit ? p.debitPence : p.creditPence;
    group.events.add(p.eventKey);
  }

  const dates = Array.from(byDate.keys()).sort();
  const journals: JournalPreview[] = [];
  for (const date of dates) {
    const groups = byDate.get(date);
    if (!groups) continue;
    const lines: JournalPreviewLine[] = [];
    let totalDebitPence = 0;
    let totalCreditPence = 0;
    for (const g of groups.values()) {
      const accountName = config.accountNames[g.account] || g.account;
      lines.push({
        description: `${g.label} (${g.events.size}) - ${accountName}`,
        accountKey: g.account,
        accountName,
        accountCode: config.accounts[g.account] || '',
        debitPence: g.isDebit ? g.pence : 0,
        creditPence: g.isDebit ? 0 : g.pence,
      });
      if (g.isDebit) totalDebitPence += g.pence;
      else totalCreditPence += g.pence;
    }
    // Debits first, then credits — the way a journal usually reads
    lines.sort((a, b) => (b.debitPence > 0 ? 1 : 0) - (a.debitPence > 0 ? 1 : 0));
    journals.push({
      date,
      narration: `Membership renewals ${formatNarrationDate(date)}`,
      lines,
      totalDebitPence,
      totalCreditPence,
    });
  }
  return journals;
}

export interface ExportPreview {
  journals: JournalPreview[];
  eventCount: number;
  missingAccounts: string[];   // labels of accounts the pending journals need but have no code
  unbalanced: string[];        // journal dates that don't balance (should never happen)
}

export async function getExportPreview(): Promise<ExportPreview> {
  const config = await getRenewalsXeroConfig();
  const events = await loadPendingEvents(config.firstSeason);
  const postings: Posting[] = [];
  for (const e of events) {
    for (const p of e.postings) postings.push(p);
  }
  const journals = buildJournals(postings, config);

  const missing = new Set<string>();
  const unbalanced: string[] = [];
  for (const j of journals) {
    for (const line of j.lines) {
      if (!line.accountCode) missing.add(line.accountName);
    }
    if (j.totalDebitPence !== j.totalCreditPence) unbalanced.push(j.date);
  }

  return { journals, eventCount: events.length, missingAccounts: Array.from(missing), unbalanced };
}

/**
 * Build the CSV for everything pending and record the export, stamping every event so
 * it's never exported twice. Refuses (nothing saved) if an account code is missing or a
 * journal doesn't balance.
 */
export async function createExport(exportedBy: string): Promise<{ exportId: string; csv: string; fileName: string }> {
  const config = await getRenewalsXeroConfig();
  const events = await loadPendingEvents(config.firstSeason);
  if (events.length === 0) {
    throw new Error('There is nothing to export.');
  }

  const postings: Posting[] = [];
  const submitIds: string[] = [];
  const voidIds: string[] = [];
  const txnIds: string[] = [];
  for (const e of events) {
    for (const p of e.postings) postings.push(p);
    if (e.kind === 'submit') submitIds.push(e.id);
    if (e.kind === 'void') voidIds.push(e.id);
    if (e.kind === 'txn') txnIds.push(e.id);
  }
  const journals = buildJournals(postings, config);

  const missing: string[] = [];
  for (const j of journals) {
    if (j.totalDebitPence !== j.totalCreditPence) {
      throw new Error(`The journal for ${j.date} doesn't balance (debits £${pounds(j.totalDebitPence)}, credits £${pounds(j.totalCreditPence)}). Nothing was exported.`);
    }
    for (const line of j.lines) {
      if (!line.accountCode && !missing.includes(line.accountName)) missing.push(line.accountName);
    }
  }
  if (missing.length > 0) {
    throw new Error(`Set the Xero account code for: ${missing.join(', ')}. Nothing was exported.`);
  }

  const rows: string[] = [XERO_JOURNAL_HEADER.join(',')];
  for (const j of journals) {
    const lines: JournalLine[] = [];
    for (const l of j.lines) {
      lines.push({
        narration: j.narration,
        date: j.date,
        description: l.description,
        accountCode: l.accountCode,
        debitPence: l.debitPence,
        creditPence: l.creditPence,
      });
    }
    pushJournalRows(rows, lines, config.taxRate);
  }
  const csv = rows.join('\n');

  // Zero-fee renewals (e.g. honorary) make no lines but are still stamped, so they
  // stop showing as pending. A batch with no lines at all has no dates.
  const today = toUkDate(new Date().toISOString());
  const fromDate = journals.length > 0 ? journals[0].date : today;
  const toDate = journals.length > 0 ? journals[journals.length - 1].date : today;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('renewals_xero_record_export', {
    p_exported_by: exportedBy,
    p_from_date: fromDate,
    p_to_date: toDate,
    p_journal_count: journals.length,
    p_csv: csv,
    p_submit_ids: submitIds,
    p_void_ids: voidIds,
    p_txn_ids: txnIds,
  });
  if (error) throw new Error(error.message);

  return { exportId: String(data), csv, fileName: `renewals-xero-${fromDate}-to-${toDate}.csv` };
}

export interface ExportSummary {
  id: string;
  exportedAt: string;
  exportedBy: string;
  fromDate: string;
  toDate: string;
  journalCount: number;
}

export async function getExportHistory(): Promise<ExportSummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewal_xero_exports')
    .select('id, exported_at, exported_by, from_date, to_date, journal_count')
    .order('exported_at', { ascending: false });
  if (error) throw new Error(`Failed to load export history: ${error.message}`);
  const history: ExportSummary[] = [];
  for (const row of data || []) {
    history.push({
      id: row.id,
      exportedAt: row.exported_at,
      exportedBy: row.exported_by,
      fromDate: row.from_date,
      toDate: row.to_date,
      journalCount: row.journal_count,
    });
  }
  return history;
}

export async function getExportCsv(exportId: string): Promise<{ csv: string; fileName: string } | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('renewal_xero_exports')
    .select('csv, from_date, to_date')
    .eq('id', exportId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load export: ${error.message}`);
  if (!data) return null;
  return { csv: data.csv, fileName: `renewals-xero-${data.from_date}-to-${data.to_date}.csv` };
}

// ============================================================================
// CHECKS AGAINST XERO (§6.6)
// ============================================================================

export interface DebtorsReport {
  asAt: string;
  totalPence: number;
  members: Array<{ username: string; fullName: string; balancePence: number }>;
  pendingEvents: number;   // not yet exported, so not in Xero (or this report)
}

/** Each member's balance on Membership debtors, from exported events dated on or before asAt. */
export async function getDebtorsReport(asAt: string): Promise<DebtorsReport> {
  const config = await getRenewalsXeroConfig();
  const [postings, pending, users] = await Promise.all([
    loadExportedPostings(config.firstSeason),
    loadPendingEvents(config.firstSeason),
    getAllUsers(),
  ]);

  const balances = new Map<string, number>();
  for (const p of postings) {
    if (p.account !== 'debtors' || p.date > asAt) continue;
    const key = p.username.toLowerCase();
    const current = balances.get(key) || 0;
    balances.set(key, current + p.debitPence - p.creditPence);
  }

  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }

  const members: Array<{ username: string; fullName: string; balancePence: number }> = [];
  let totalPence = 0;
  for (const [username, balancePence] of balances) {
    totalPence += balancePence;
    if (balancePence === 0) continue;
    members.push({ username, fullName: names.get(username) || username, balancePence });
  }
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));

  return { asAt, totalPence, members, pendingEvents: pending.length };
}

export interface UnmatchedReceiptsReport {
  totalPence: number;
  unmatched: Array<{ paymentId: string; date: string; reference: string; amountPence: number }>;
  unmatchedPence: number;
  matchedNotExportedPence: number;
  bankRefundsNotExportedPence: number;
}

/**
 * What should be sitting in Membership transfers clearing in Xero: receipts on the HSBC
 * feed that haven't yet gone through an exported journal — Banking payments still
 * unmatched, plus matched ones not exported yet, less bank refunds not exported yet.
 */
export async function getUnmatchedReceiptsReport(): Promise<UnmatchedReceiptsReport> {
  const config = await getRenewalsXeroConfig();
  const supabase = getSupabaseClient();
  const firstDay = `${config.firstSeason}-01-01`;

  const [payments, txns] = await Promise.all([
    fetchAll((from, to) => supabase.from('renewal_payments')
      .select('payment_id, date, reference, amount, status, source')
      .eq('status', 'Unmatched')
      .eq('source', 'banking')
      .gte('date', firstDay)
      .order('date').range(from, to)),
    fetchAll((from, to) => supabase.from('renewal_transactions')
      .select('kind, source, refund_via, amount')
      .gte('season_year', config.firstSeason)
      .is('xero_export_id', null)
      .order('id').range(from, to)),
  ]);

  const unmatched: Array<{ paymentId: string; date: string; reference: string; amountPence: number }> = [];
  let unmatchedPence = 0;
  for (const p of payments) {
    const amountPence = toPence(p.amount);
    unmatchedPence += amountPence;
    unmatched.push({ paymentId: String(p.payment_id), date: String(p.date), reference: String(p.reference || ''), amountPence });
  }

  let matchedNotExportedPence = 0;
  let bankRefundsNotExportedPence = 0;
  for (const t of txns) {
    if (t.kind === 'payment' && t.source === 'banking') matchedNotExportedPence += toPence(t.amount);
    if (t.kind === 'refund' && t.refund_via === 'bank') bankRefundsNotExportedPence += toPence(t.amount);
  }

  return {
    totalPence: unmatchedPence + matchedNotExportedPence - bankRefundsNotExportedPence,
    unmatched,
    unmatchedPence,
    matchedNotExportedPence,
    bankRefundsNotExportedPence,
  };
}

// ============================================================================
// TRANSACTIONS — payments from Banking, and the treasurer's adjustments (§6.7)
// ============================================================================

/**
 * Record a payment matched to a renewal in Banking, so it goes in the journal.
 * amount = the part of the payment(s) given to this member; donation is the part of that
 * which is a donation; writeOff is Banking's "difference" (added to what's owed).
 */
export async function recordBankingPaymentTransaction(opts: {
  userName: string;
  amount: number;
  donation: number;
  writeOff: number;
  paymentIds: string;
  txnDate: string;   // YYYY-MM-DD
  createdBy: string;
}): Promise<void> {
  if (opts.amount === 0 && opts.writeOff === 0) return;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('renewal_transactions').insert({
    season_year: getCurrentSeasonYear(),
    username: opts.userName,
    kind: 'payment',
    txn_date: opts.txnDate,
    amount: opts.amount,
    donation: opts.donation,
    write_off: opts.writeOff,
    source: 'banking',
    payment_ids: opts.paymentIds,
    created_by: opts.createdBy,
  });
  if (error) throw new Error(`Failed to record the payment for ${opts.userName} for Xero: ${error.message}`);
}

export type AdjustmentKind = 'charge' | 'credit' | 'refund';
export type FeeType = 'playing' | 'social' | 'competitions' | '200_club';

/**
 * Record a treasurer's adjustment on a member's current-season renewal, and change what
 * they owe. Uses Banking's own columns so its "outstanding = fee − banking + donations +
 * difference" formula stays right: a charge or credit goes on difference, a refund comes
 * off banking.
 */
export async function recordAdjustment(opts: {
  userName: string;
  kind: AdjustmentKind;
  feeType: FeeType | null;
  refundVia: 'bank' | 'stripe' | null;
  amount: number;
  reason: string;
  createdBy: string;
}): Promise<void> {
  if (!(opts.amount > 0)) throw new Error('The amount must be more than £0.');
  if (!opts.reason.trim()) throw new Error('Please give a reason.');
  if ((opts.kind === 'charge' || opts.kind === 'credit') && !opts.feeType) throw new Error('Please choose which fee it applies to.');
  if (opts.kind === 'refund' && !opts.refundVia) throw new Error('Please say how the refund was paid.');

  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();
  const { data: renewal, error: readError } = await supabase
    .from('renewals')
    .select('id, submitted_at, voided_at, outstanding, banking, difference')
    .ilike('username', opts.userName)
    .eq('season_year', seasonYear)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!renewal || !renewal.submitted_at) throw new Error('This member has no submitted renewal this season.');
  if (renewal.voided_at) throw new Error('This renewal has been voided.');

  const amountPence = Math.round(opts.amount * 100);
  let outstandingPence = toPence(renewal.outstanding);
  let bankingPence = toPence(renewal.banking);
  let differencePence = toPence(renewal.difference);
  if (opts.kind === 'charge') {
    differencePence += amountPence;
    outstandingPence += amountPence;
  } else if (opts.kind === 'credit') {
    differencePence -= amountPence;
    outstandingPence -= amountPence;
  } else {
    bankingPence -= amountPence;
    outstandingPence += amountPence;
  }

  const { error: insertError } = await supabase.from('renewal_transactions').insert({
    season_year: seasonYear,
    username: opts.userName,
    kind: opts.kind,
    txn_date: toUkDate(new Date().toISOString()),
    amount: amountPence / 100,
    fee_type: opts.kind === 'refund' ? null : opts.feeType,
    refund_via: opts.kind === 'refund' ? opts.refundVia : null,
    reason: opts.reason.trim(),
    created_by: opts.createdBy,
  });
  if (insertError) throw new Error(`Failed to record the adjustment: ${insertError.message}`);

  const { error: updateError } = await supabase
    .from('renewals')
    .update({
      outstanding: outstandingPence / 100,
      banking: bankingPence / 100,
      difference: differencePence / 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', renewal.id);
  if (updateError) throw new Error(`The adjustment was recorded but the renewal couldn't be updated: ${updateError.message}`);
}

export interface MemberAccount {
  userName: string;
  fullName: string;
  submittedAt: string | null;
  voidedAt: string | null;
  feePence: number;
  outstandingPence: number;
  transactions: Array<{
    id: string;
    date: string;
    kind: string;
    description: string;
    amountPence: number;
    reason: string | null;
    exported: boolean;
  }>;
}

/** A member's current-season renewal with every payment and adjustment, for the Adjustments tab. */
export async function getMemberAccount(userName: string): Promise<MemberAccount | null> {
  const supabase = getSupabaseClient();
  const seasonYear = getCurrentSeasonYear();
  const [{ data: renewal, error }, txns, users] = await Promise.all([
    supabase.from('renewals')
      .select('username, submitted_at, voided_at, total_fee_due, outstanding')
      .ilike('username', userName)
      .eq('season_year', seasonYear)
      .maybeSingle(),
    fetchAll((from, to) => supabase.from('renewal_transactions').select('*')
      .ilike('username', userName)
      .eq('season_year', seasonYear)
      .order('created_at').range(from, to)),
    getAllUsers(),
  ]);
  if (error) throw new Error(error.message);
  if (!renewal) return null;

  let fullName = renewal.username;
  for (const u of users) {
    if (u.userName && u.userName.toLowerCase() === String(renewal.username).toLowerCase()) fullName = u.fullName || u.userName;
  }

  const transactions: MemberAccount['transactions'] = [];
  for (const t of txns) {
    let description = '';
    if (t.kind === 'payment') {
      description = `Payment (${paymentClearing(t).label.toLowerCase()})`;
      if (toPence(t.donation) > 0) description += `, incl. £${pounds(toPence(t.donation))} donation`;
      if (toPence(t.write_off) !== 0) description += `, difference £${pounds(toPence(t.write_off))}`;
    } else if (t.kind === 'charge') {
      description = `Extra charge (${t.fee_type})`;
    } else if (t.kind === 'credit') {
      description = `Credit (${t.fee_type})`;
    } else {
      description = `Refund (${t.refund_via === 'stripe' ? 'Stripe' : 'bank'})`;
    }
    transactions.push({
      id: String(t.id),
      date: String(t.txn_date),
      kind: String(t.kind),
      description,
      amountPence: toPence(t.amount),
      reason: t.reason ? String(t.reason) : null,
      exported: !!t.xero_export_id,
    });
  }

  return {
    userName: String(renewal.username),
    fullName: String(fullName),
    submittedAt: renewal.submitted_at,
    voidedAt: renewal.voided_at,
    feePence: toPence(renewal.total_fee_due),
    outstandingPence: toPence(renewal.outstanding),
    transactions,
  };
}

/** Members with a submitted renewal this season, for the Adjustments member picker. */
export async function getSubmittedRenewalMembers(): Promise<Array<{ userName: string; fullName: string }>> {
  const supabase = getSupabaseClient();
  const [rows, users] = await Promise.all([
    fetchAll((from, to) => supabase.from('renewals').select('username')
      .eq('season_year', getCurrentSeasonYear())
      .not('submitted_at', 'is', null)
      .eq('renewing_membership', true)
      .order('id').range(from, to)),
    getAllUsers(),
  ]);
  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }
  const members: Array<{ userName: string; fullName: string }> = [];
  for (const r of rows) {
    const userName = String(r.username);
    members.push({ userName, fullName: names.get(userName.toLowerCase()) || userName });
  }
  members.sort((a, b) => a.fullName.localeCompare(b.fullName));
  return members;
}
