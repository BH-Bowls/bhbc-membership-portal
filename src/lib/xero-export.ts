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

  // Top-ups: cash/card comes in, a matching liability is created (not revenue --
  // it isn't earned until the member actually spends it).
  push('Cash top-ups', config.cashAccount, dayEnd.cashTopupsPence, 0);
  push('Cash top-ups', config.walletLiabilityAccount, 0, dayEnd.cashTopupsPence);
  push('Card top-ups', config.cardAccount, dayEnd.cardTopupsPence, 0);
  push('Card top-ups', config.walletLiabilityAccount, 0, dayEnd.cardTopupsPence);

  // Sales revenue, split by nominal code (product override -> category -> default).
  const salesByMethod: { method: 'wallet' | 'cash' | 'card'; totalPence: number; debitAccount: string }[] = [
    { method: 'wallet', totalPence: dayEnd.walletSalesPence, debitAccount: config.walletLiabilityAccount },
    { method: 'cash', totalPence: dayEnd.cashSalesPence, debitAccount: config.cashAccount },
    { method: 'card', totalPence: dayEnd.cardSalesPence, debitAccount: config.cardAccount },
  ];
  for (const { method, totalPence, debitAccount } of salesByMethod) {
    if (totalPence === 0) continue;
    const byCode = await getDayEndRevenueByNominalCode(dayEnd.id, method);
    push(`${method} sales`, debitAccount, totalPence, 0);
    for (const { nominalCode, pence } of byCode) {
      if (pence === 0) continue;
      push(`${method} sales`, nominalCode || config.defaultSalesAccount, 0, pence);
    }
  }

  // Refunds: cash paid back out of a member's wallet.
  push('Refunds', config.walletLiabilityAccount, dayEnd.refundsPence, 0);
  push('Refunds', config.cashAccount, 0, dayEnd.refundsPence);

  // Cash-count variance: expected vs. what was actually removed from the till.
  const variance = dayEnd.cashExpectedPence - dayEnd.cashRemovedPence;
  if (variance > 0) {
    // Less cash removed than expected -- a shortfall, write cash-in-hand down.
    push('Cash variance (short)', config.cashVarianceAccount, variance, 0);
    push('Cash variance (short)', config.cashAccount, 0, variance);
  } else if (variance < 0) {
    // More cash removed than expected -- a surplus.
    push('Cash variance (over)', config.cashAccount, -variance, 0);
    push('Cash variance (over)', config.cashVarianceAccount, 0, -variance);
  }

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
