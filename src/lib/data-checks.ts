// src/lib/data-checks.ts
// Data checks — a read-only sanity check of the bar, renewals and Xero data, for the
// Treasurer and Admin (/banking/data-checks). Almost all of it is the data_checks()
// function in Postgres (migration 0096), which returns one row per problem; this adds
// member names, the renewals Xero journal balance check (built in TypeScript, so it's
// checked here with the same code that makes the export), and the list of every check
// so the page can show the ones that passed.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getExportPreview } from './renewals-xero';

export type DataCheckSeverity = 'error' | 'warning' | 'info';

export interface DataCheckProblem {
  area: string;
  check: string;
  severity: DataCheckSeverity;
  detail: string;
  userName: string | null;
  memberName: string | null;
  link: string | null;
}

export interface DataCheckDefinition {
  area: string;
  check: string;
  description: string;
}

export interface DataCheckResults {
  ranAt: string;
  checks: DataCheckDefinition[];
  problems: DataCheckProblem[];
  truncated: boolean;
}

// Every check, in the order shown. The names must match what data_checks() returns.
export const DATA_CHECKS: DataCheckDefinition[] = [
  { area: 'Bar accounts', check: 'Balance matches history', description: 'Each member\'s balance equals the total of their account history.' },
  { area: 'Bar accounts', check: 'Account payment taken from the account', description: 'Every Pay by Account sale took exactly its total from the member\'s account, once.' },
  { area: 'Bar accounts', check: 'Every account purchase has a sale', description: 'Every purchase in an account history belongs to a real Pay by Account sale.' },
  { area: 'Bar accounts', check: 'Voided account sales paid back', description: 'A voided Pay by Account sale put its money back on the account exactly once.' },
  { area: 'Bar accounts', check: 'Money held for leavers', description: 'No money left on the account of a member who has left.' },
  { area: 'Bar accounts', check: 'Manual adjustments (last 30 days)', description: 'Lists corrections made to accounts by hand, for the Treasurer to see.' },
  { area: 'Bar sales', check: 'Sale total matches its items', description: 'Each sale\'s total equals its items (quantity × price).' },
  { area: 'Bar sales', check: 'Full price less discount equals the total', description: 'Full price less the member discount equals what was charged.' },
  { area: 'Bar sales', check: 'Sales with nothing to pay', description: 'No £0.00 sales.' },
  { area: 'Bar sales', check: 'Voided after its Day End', description: 'No sale was voided after the Day End that counted it.' },
  { area: 'Bar sales', check: 'Voided card sale refunded to the card', description: 'A voided Square card sale has its refund to the card recorded.' },
  { area: 'Bar sales', check: 'Product prices', description: 'Member discounts are 0–100%, and no visitor price is below the member price.' },
  { area: 'Day End', check: 'Cash expected adds up', description: 'Cash expected = carried in + cash sales + cash movements + cash top-ups + membership cash − refunds.' },
  { area: 'Day End', check: 'Totals match the sales in it', description: 'Each Day End\'s saved totals equal the sales, top-ups, refunds and membership payments in it.' },
  { area: 'Day End', check: 'Carried forward follows on', description: 'Each cash-up starts from what the one before carried forward, and Config holds the latest figure.' },
  { area: 'Day End', check: 'Everything is in a Day End', description: 'Nothing older than the latest Day End was left out of it.' },
  { area: 'Day End', check: 'Day End done recently', description: 'No sales have been waiting more than 7 days for a Day End.' },
  { area: 'Day End', check: 'Day Ends confirmed', description: 'Day Ends are confirmed within 7 days.' },
  { area: 'Day End', check: 'Cash banked', description: 'Cash taken from the till is in a banking within 21 days.' },
  { area: 'Day End', check: 'Bankings match their Day Ends', description: 'Each banking\'s total equals its confirmed Day Ends.' },
  { area: 'Card payments', check: 'Square payments recorded', description: 'Everything paid on the Square Terminal was recorded, and points to a real sale or payment.' },
  { area: 'Card payments', check: 'Square payments finished', description: 'No Square payment has been left unfinished for more than an hour.' },
  { area: 'Card payments', check: 'Online renewal payments finished', description: 'No online renewal payment was started and never recorded.' },
  { area: 'Renewals', check: 'Fee adds up', description: 'Each fee equals playing + social + competitions + 200 Club.' },
  { area: 'Renewals', check: 'Amount owed adds up', description: 'Amount owed = fee − paid + donations + differences.' },
  { area: 'Renewals', check: 'Payments match what goes to Xero', description: 'What each renewal shows as paid equals the payments, refunds and adjustments recorded for Xero.' },
  { area: 'Renewals', check: 'Overpaid', description: 'Nobody has paid more than they owe.' },
  { area: 'Renewals', check: 'Voided renewals refunded', description: 'Money paid towards a voided renewal has been refunded.' },
  { area: 'Renewals', check: 'Payments and adjustments belong to a renewal', description: 'Every payment and adjustment is for a submitted renewal.' },
  { area: 'Renewals', check: 'Matched payments have a member', description: 'Every matched Banking payment is matched to real members.' },
  { area: 'Renewals', check: 'Payments taken at the bar go to Xero', description: 'Every membership payment taken at the till has its Xero record.' },
  { area: 'Renewals', check: 'Bank payments matched', description: 'No Banking payment has been unmatched for more than 30 days.' },
  { area: 'Xero', check: 'Journals balance', description: 'The renewals journals waiting to be exported balance (debits = credits).' },
  { area: 'Xero', check: 'Export records are consistent', description: 'A renewal is only marked exported if it was submitted, and a void only after the renewal.' },
  { area: 'Xero', check: 'Renewals exported to Xero', description: 'Nothing has waited more than a month to be exported.' },
  { area: 'Xero', check: 'Account codes filled in', description: 'Every bar and renewals Xero account code is set.' },
  { area: '200 Club', check: 'Numbers match the renewal', description: 'Each member holds no more numbers than they paid for, on a submitted renewal.' },
  { area: 'Bar cards', check: 'Cards are unique', description: 'No two members share a membership card code.' },
  { area: 'Bar cards', check: 'Cards are valid', description: 'Every active member has a valid membership card code.' },
  { area: 'Bar cards', check: 'PINs locked', description: 'Lists members whose bar PIN is locked.' },
  { area: 'Bar cards', check: 'Approved by the person serving (last 30 days)', description: 'Lists Pay by Account payments the person serving approved for a member without a card or PIN.' },
];

// PostgREST returns at most this many rows from one call
const MAX_ROWS = 1000;

interface DataCheckRow {
  area: string;
  check_name: string;
  severity: string;
  detail: string;
  member_username: string | null;
  link: string | null;
}

function toSeverity(value: string): DataCheckSeverity {
  if (value === 'error' || value === 'warning' || value === 'info') return value;
  return 'error';
}

export async function runDataChecks(): Promise<DataCheckResults> {
  const supabase = getSupabaseClient();
  const [checksResult, users] = await Promise.all([
    supabase.rpc('data_checks'),
    getAllUsers(),
  ]);
  if (checksResult.error) throw new Error(`The data checks couldn't run: ${checksResult.error.message}`);
  const rows = (checksResult.data || []) as DataCheckRow[];

  const names = new Map<string, string>();
  for (const u of users) {
    if (u.userName) names.set(u.userName.toLowerCase(), u.fullName || u.userName);
  }

  const problems: DataCheckProblem[] = [];
  for (const r of rows) {
    const userName = r.member_username ? r.member_username.trim() : null;
    problems.push({
      area: r.area,
      check: r.check_name,
      severity: toSeverity(r.severity),
      detail: r.detail,
      userName: userName,
      memberName: userName ? names.get(userName.toLowerCase()) || userName : null,
      link: r.link,
    });
  }

  // The renewals journals are built in TypeScript, so they're checked here
  try {
    const preview = await getExportPreview();
    for (const date of preview.unbalanced) {
      problems.push({
        area: 'Xero', check: 'Journals balance', severity: 'error',
        detail: `The renewals journal for ${date} doesn't balance — the export will refuse it`,
        userName: null, memberName: null, link: '/banking/renewals-xero',
      });
    }
  } catch (err) {
    problems.push({
      area: 'Xero', check: 'Journals balance', severity: 'error',
      detail: `This check could not run: ${err instanceof Error ? err.message : String(err)}`,
      userName: null, memberName: null, link: null,
    });
  }

  return {
    ranAt: new Date().toISOString(),
    checks: DATA_CHECKS,
    problems,
    truncated: rows.length >= MAX_ROWS,
  };
}
