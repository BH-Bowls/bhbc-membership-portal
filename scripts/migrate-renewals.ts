/**
 * migrate-renewals.ts
 *
 * Reads the live Renewals + RenewalPayments sheets (Members spreadsheet) and writes them
 * into the new Postgres renewals/renewal_payments tables. Same "refresh Dev, rerun for the
 * real Prod cutover" pattern as migrate-rotas.ts.
 *
 * The Sheets Renewals tab has no year column — it's a single current-cycle sheet, wiped and
 * reused by hand each season. The new Postgres table is real multi-year history
 * (supabase/migrations/0031_renewals.sql), so every migrated row is stamped with the
 * CURRENT calendar year (matches renewals-supabase.ts's getCurrentSeasonYear()) — running
 * this script again later in the same season safely re-migrates the same season_year row
 * (upsert on the username+season_year unique constraint), it does not create a duplicate.
 *
 * renewing_membership: the Sheets column overloaded a third sentinel value ('X', meaning
 * "an admin has locked this member's renewal") alongside Y/N. Replicates the live app's
 * exact current behaviour — getRenewalByUsername's original getBool() treated anything
 * that wasn't Y/Yes/TRUE as false, including 'X' and blank — so renewing_membership is
 * migrated as a plain true/false (never null), with the 'X' sentinel split out into the
 * new renewals_closed column instead.
 *
 * RenewalPayments.date and Renewals.date_paid are real Postgres `date` columns now —
 * converted via parseUKDate (same tolerant UK/ISO parsing banking-supabase.ts's
 * toISODate() uses), not passed through as raw sheet strings.
 *
 * Username validation: leavers already live in the same Postgres `users` table as active
 * members (is_active=false, not a separate table), so the renewals.username FK is
 * satisfied by a leaver just as much as an active member — validates against ALL usernames
 * in `users` directly (not members-supabase.ts's getAllUsers(), which filters to
 * is_active=true only and would wrongly skip every leaver's real historical renewal row).
 *
 * Run with:
 *   npx dotenv -e .env.local -- npx tsx scripts/migrate-renewals.ts
 */

import { getGoogleSheetsClient, getSpreadsheetId, getColumnMap } from '../src/lib/sheets';
import { getSupabaseClient } from '../src/lib/supabase';
import { parseUKDate } from '../src/lib/date-utils';

const RENEWALS_SHEET = 'Renewals';
const PAYMENTS_SHEET = 'RenewalPayments';

function getBool(val: string): boolean {
  return val === 'Y' || val === 'Yes' || val === 'yes' || val === 'TRUE' || val === 'true';
}

function getNumber(val: string): number {
  if (!val) return 0;
  const cleaned = val.replace(/[£$,\s]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

/** Returns null (not empty string) for a blank/unparseable date — real Postgres date columns need null, not ''. */
function toISODateOrNull(val: string): string | null {
  if (!val || !val.trim()) return null;
  const parsed = parseUKDate(val);
  if (isNaN(parsed.getTime())) {
    console.warn(`   !! Could not parse date "${val}" — left null`);
    return null;
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface RawRenewalRow {
  userName: string;
  renewingRaw: string;
  playingFee: number;
  socialFee: number;
  compsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number | null;
  banking: number | null;
  donations: number | null;
  difference: number | null;
  bankTransfer: number | null;
  cardMachine: number | null;
  cheque: number | null;
  cash: number | null;
  paymentIds: string;
  paymentNotes: string;
  datePaid: string;
  club200Entries: number;
  club200PreferredNumbers: string;
  cleaningDatesToAvoid: string;
  teaDatesToAvoid: string;
  mensChampionship: boolean;
  ladiesMaynard: boolean;
  mensTwoWood: boolean;
  ladiesTwoWood: boolean;
  marriedPairs: boolean;
  drawnPairs: boolean;
  australianPairs: boolean;
  drawnTriples: boolean;
  handicap: boolean;
  oldlands: boolean;
  veterans: boolean;
  drawnPairsSub: boolean;
  australianPairsSub: boolean;
  drawnTriplesSub: boolean;
  confirmationEmailDate: string;
  createdAt: string;
}

interface RawPaymentRow {
  paymentId: string;
  date: string;
  type: string;
  reference: string;
  amount: number;
  status: string;
  matchedUsers: string;
}

async function fetchRenewals(): Promise<RawRenewalRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(RENEWALS_SHEET, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${RENEWALS_SHEET}!A2:AP`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  const entries: RawRenewalRow[] = [];
  for (const row of rows) {
    const userName = get(row, 'user_name');
    if (!userName) continue;

    entries.push({
      userName,
      renewingRaw: get(row, 'renewing_membership'),
      playingFee: getNumber(get(row, 'playing_fee')),
      socialFee: getNumber(get(row, 'social_fee')),
      compsFee: getNumber(get(row, 'competitions_fee')),
      club200Fee: getNumber(get(row, 'club_200_fee')),
      totalFeeDue: getNumber(get(row, 'total_fee_due')),
      outstanding: get(row, 'outstanding') ? getNumber(get(row, 'outstanding')) : null,
      banking: get(row, 'banking') ? getNumber(get(row, 'banking')) : null,
      donations: get(row, 'donations') ? getNumber(get(row, 'donations')) : null,
      difference: get(row, 'difference') ? getNumber(get(row, 'difference')) : null,
      bankTransfer: get(row, 'bank_transfer') ? getNumber(get(row, 'bank_transfer')) : null,
      cardMachine: get(row, 'card_machine') ? getNumber(get(row, 'card_machine')) : null,
      cheque: get(row, 'cheque') ? getNumber(get(row, 'cheque')) : null,
      cash: get(row, 'cash') ? getNumber(get(row, 'cash')) : null,
      paymentIds: get(row, 'payment_ids'),
      paymentNotes: get(row, 'payment_notes'),
      datePaid: get(row, 'date_paid'),
      club200Entries: getNumber(get(row, 'club_200_entries')),
      club200PreferredNumbers: get(row, 'club_200_preferred_numbers'),
      cleaningDatesToAvoid: get(row, 'cleaning_dates_to_avoid'),
      teaDatesToAvoid: get(row, 'tea_dates_to_avoid'),
      mensChampionship: getBool(get(row, 'comp_mens_championship')),
      ladiesMaynard: getBool(get(row, 'comp_ladies_maynard')),
      mensTwoWood: getBool(get(row, 'comp_mens_two_wood')),
      ladiesTwoWood: getBool(get(row, 'comp_ladies_two_wood')),
      marriedPairs: getBool(get(row, 'comp_married_pairs')),
      drawnPairs: getBool(get(row, 'comp_drawn_pairs')),
      australianPairs: getBool(get(row, 'comp_australian_pairs')),
      drawnTriples: getBool(get(row, 'comp_drawn_triples')),
      handicap: getBool(get(row, 'comp_handicap')),
      oldlands: getBool(get(row, 'comp_oldlands')),
      veterans: getBool(get(row, 'comp_veterans')),
      drawnPairsSub: getBool(get(row, 'sub_drawn_pairs')),
      australianPairsSub: getBool(get(row, 'sub_australian_pairs')),
      drawnTriplesSub: getBool(get(row, 'sub_drawn_triples')),
      confirmationEmailDate: get(row, 'confirmation_email_date'),
      createdAt: get(row, 'created_at'),
    });
  }
  return entries;
}

async function fetchPayments(): Promise<RawPaymentRow[]> {
  const spreadsheetId = getSpreadsheetId();
  const sheets = getGoogleSheetsClient();
  const colMap = await getColumnMap(PAYMENTS_SHEET, spreadsheetId);

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${PAYMENTS_SHEET}!A2:G`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values ?? [];
  const get = (row: any[], field: string): string => {
    const idx = colMap[field];
    return idx !== undefined ? (row[idx] || '').toString().trim() : '';
  };

  const entries: RawPaymentRow[] = [];
  for (const row of rows) {
    const paymentId = get(row, 'payment_id');
    if (!paymentId) continue;
    entries.push({
      paymentId,
      date: get(row, 'date'),
      type: get(row, 'type'),
      reference: get(row, 'reference'),
      amount: getNumber(get(row, 'amount')),
      status: get(row, 'status') || 'Unmatched',
      matchedUsers: get(row, 'matched_users'),
    });
  }
  return entries;
}

async function main() {
  console.log('1. Reading live Renewals + RenewalPayments sheets + all usernames (active + leavers)...');
  const supabase = getSupabaseClient();
  const [renewals, payments, allUsersResult] = await Promise.all([
    fetchRenewals(),
    fetchPayments(),
    supabase.from('users').select('username'),
  ]);
  if (allUsersResult.error) throw new Error(`Failed to fetch usernames: ${allUsersResult.error.message}`);
  console.log(`   -> ${renewals.length} renewal rows, ${payments.length} payment rows`);

  const usernames = new Set((allUsersResult.data ?? []).map((u) => (u.username as string).toLowerCase()));
  const seasonYear = new Date().getFullYear();

  console.log(`2. Wiping existing renewals for season ${seasonYear} + all renewal_payments...`);
  const { error: wipeRenewalsError } = await supabase
    .from('renewals')
    .delete()
    .eq('season_year', seasonYear);
  if (wipeRenewalsError) throw new Error(`Failed to wipe renewals: ${wipeRenewalsError.message}`);

  const { error: wipePaymentsError } = await supabase
    .from('renewal_payments')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (wipePaymentsError) throw new Error(`Failed to wipe renewal_payments: ${wipePaymentsError.message}`);

  console.log(`3. Inserting renewals rows (season_year = ${seasonYear})...`);
  let renewalsSkipped = 0;
  const renewalsToInsert = [];
  for (const r of renewals) {
    if (!usernames.has(r.userName.toLowerCase())) {
      console.warn(`   !! renewals: "${r.userName}" doesn't match any current username — row skipped`);
      renewalsSkipped++;
      continue;
    }
    renewalsToInsert.push({
      username: r.userName,
      season_year: seasonYear,
      renewing_membership: getBool(r.renewingRaw),
      renewals_closed: r.renewingRaw === 'X',
      playing_fee: r.playingFee,
      social_fee: r.socialFee,
      competitions_fee: r.compsFee,
      club_200_fee: r.club200Fee,
      total_fee_due: r.totalFeeDue,
      comp_mens_championship: r.mensChampionship,
      comp_ladies_maynard: r.ladiesMaynard,
      comp_mens_two_wood: r.mensTwoWood,
      comp_ladies_two_wood: r.ladiesTwoWood,
      comp_married_pairs: r.marriedPairs,
      comp_drawn_pairs: r.drawnPairs,
      comp_australian_pairs: r.australianPairs,
      comp_drawn_triples: r.drawnTriples,
      comp_handicap: r.handicap,
      comp_oldlands: r.oldlands,
      comp_veterans: r.veterans,
      sub_drawn_pairs: r.drawnPairsSub,
      sub_australian_pairs: r.australianPairsSub,
      sub_drawn_triples: r.drawnTriplesSub,
      club_200_entries: r.club200Entries,
      club_200_preferred_numbers: r.club200PreferredNumbers || null,
      cleaning_dates_to_avoid: r.cleaningDatesToAvoid || null,
      tea_dates_to_avoid: r.teaDatesToAvoid || null,
      outstanding: r.outstanding,
      banking: r.banking,
      donations: r.donations,
      difference: r.difference,
      bank_transfer: r.bankTransfer,
      card_machine: r.cardMachine,
      cheque: r.cheque,
      cash: r.cash,
      payment_ids: r.paymentIds || null,
      payment_notes: r.paymentNotes || null,
      date_paid: toISODateOrNull(r.datePaid),
      confirmation_email_date: r.confirmationEmailDate || null,
      created_at: r.createdAt || new Date().toISOString(),
    });
  }
  if (renewalsToInsert.length > 0) {
    const { error } = await supabase.from('renewals').insert(renewalsToInsert);
    if (error) throw new Error(`renewals insert failed: ${error.message}`);
  }
  console.log(`   -> ${renewalsToInsert.length} renewals rows inserted${renewalsSkipped > 0 ? ` (${renewalsSkipped} skipped — unmatched username)` : ''}`);

  console.log('4. Inserting renewal_payments rows...');
  const paymentsToInsert = payments.map((p) => ({
    payment_id: p.paymentId,
    date: toISODateOrNull(p.date) ?? new Date().toISOString().slice(0, 10),
    type: p.type,
    reference: p.reference || null,
    amount: p.amount,
    status: p.status,
    matched_users: p.matchedUsers || null,
  }));
  if (paymentsToInsert.length > 0) {
    const { error } = await supabase.from('renewal_payments').insert(paymentsToInsert);
    if (error) throw new Error(`renewal_payments insert failed: ${error.message}`);
  }
  console.log(`   -> ${paymentsToInsert.length} renewal_payments rows inserted`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('MIGRATION FAILED:', err.message);
  process.exit(1);
});
