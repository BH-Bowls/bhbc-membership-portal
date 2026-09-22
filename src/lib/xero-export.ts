// src/lib/xero-export.ts
// Builds a Xero Manual Journal import CSV from a batch of bar Day End records.
// Double-entry shape follows the plan in specs/ACCOUNTS_SYSTEM_DESIGN.md ("bar
// first" stage): top-ups are a liability until spent, sales revenue is split by
// nominal code (product -> category -> default), refunds reverse the liability,
// and any cash-count variance posts against a dedicated variance account.
//
// NOT verified against a live Xero org. Before relying on this for a real
// import, pull the current template from Accounting -> Advanced -> Manual
// Journals -> Import in Xero and confirm the column headers below match --
// Xero has changed this format before, and the *TaxRate value here ('No VAT')
// is a guess, not a confirmed rate name from your org's chart of accounts.

import { getDayEndRevenueByNominalCode, type BarDayEnd } from './bar-supabase';

export interface BarNominalConfig {
  cashAccount: string;
  cardAccount: string;
  walletLiabilityAccount: string;
  discountsAccount: string;
  cashVarianceAccount: string;
  defaultSalesAccount: string;
}

interface JournalLine {
  narration: string;
  date: string;
  description: string;
  accountCode: string;
  debitPence: number;
  creditPence: number;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

async function buildJournalLines(dayEnd: BarDayEnd, config: BarNominalConfig): Promise<JournalLine[]> {
  const date = dayEnd.createdAt.slice(0, 10);
  const narration = `Bar reconciliation ${date} (${dayEnd.staff})`;
  const lines: JournalLine[] = [];
  const push = (description: string, accountCode: string, debitPence: number, creditPence: number) => {
    if (debitPence === 0 && creditPence === 0) return;
    lines.push({ narration, date, description, accountCode, debitPence, creditPence });
  };
  // Posts a signed amount to one side or the other of one account. positiveIsDebit
  // says which side a positive pence normally belongs on for that account; a
  // negative pence (e.g. a Cash Movement removal, which can make a "sales" total
  // negative) simply lands on the opposite side instead of going negative itself --
  // every caller posts the same pence to two accounts with opposite positiveIsDebit,
  // so each pair always balances regardless of sign.
  const postSigned = (description: string, accountCode: string, pence: number, positiveIsDebit: boolean) => {
    if (pence === 0) return;
    const abs = Math.abs(pence);
    const isDebit = (pence > 0) === positiveIsDebit;
    push(description, accountCode, isDebit ? abs : 0, isDebit ? 0 : abs);
  };

  // Top-ups: cash/card comes in, a matching liability is created (not revenue --
  // it isn't earned until the member actually spends it).
  postSigned('Cash top-ups', config.cashAccount, dayEnd.cashTopupsPence, true);
  postSigned('Cash top-ups', config.walletLiabilityAccount, dayEnd.cashTopupsPence, false);
  postSigned('Card top-ups', config.cardAccount, dayEnd.cardTopupsPence, true);
  postSigned('Card top-ups', config.walletLiabilityAccount, dayEnd.cardTopupsPence, false);

  // Sales revenue, split by nominal code (product override -> category -> default).
  // Includes Cash Movements (see 0064_bar_cash_movements.sql) posted through the
  // 'cash' method as an ordinary, possibly negative, sale -- postSigned handles a
  // net-negative total (more removed than sold) the same way as any other sign.
  const salesByMethod: { method: 'wallet' | 'cash' | 'card'; totalPence: number; debitAccount: string }[] = [
    { method: 'wallet', totalPence: dayEnd.walletSalesPence, debitAccount: config.walletLiabilityAccount },
    { method: 'cash', totalPence: dayEnd.cashSalesPence, debitAccount: config.cashAccount },
    { method: 'card', totalPence: dayEnd.cardSalesPence, debitAccount: config.cardAccount },
  ];
  for (const { method, totalPence, debitAccount } of salesByMethod) {
    if (totalPence === 0) continue;
    const byCode = await getDayEndRevenueByNominalCode(dayEnd.id, method);
    postSigned(`${method} sales`, debitAccount, totalPence, true);
    for (const { nominalCode, pence } of byCode) {
      postSigned(`${method} sales`, nominalCode || config.defaultSalesAccount, pence, false);
    }
  }

  // Refunds: cash paid back out of a member's wallet.
  postSigned('Refunds', config.walletLiabilityAccount, dayEnd.refundsPence, true);
  postSigned('Refunds', config.cashAccount, dayEnd.refundsPence, false);

  // Cash-count variance: expected vs. what was actually removed from the till.
  // Positive = shortfall (less removed than expected), negative = surplus.
  const variance = dayEnd.cashExpectedPence - dayEnd.cashRemovedPence;
  postSigned('Cash variance', config.cashVarianceAccount, variance, true);
  postSigned('Cash variance', config.cashAccount, variance, false);

  return lines;
}

export async function buildXeroManualJournalCsv(dayEnds: BarDayEnd[], config: BarNominalConfig): Promise<string> {
  const header = ['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Debit', '*Credit'];
  const rows: string[] = [header.join(',')];
  for (const dayEnd of dayEnds) {
    const lines = await buildJournalLines(dayEnd, config);
    for (const l of lines) {
      rows.push([
        csvEscape(l.narration),
        l.date,
        csvEscape(l.description),
        csvEscape(l.accountCode),
        'No VAT',
        l.debitPence ? pounds(l.debitPence) : '',
        l.creditPence ? pounds(l.creditPence) : '',
      ].join(','));
    }
  }
  return rows.join('\n');
}
