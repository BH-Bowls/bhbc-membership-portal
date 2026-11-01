// src/lib/xero-journal-csv.ts
// The Xero Manual Journal import CSV format, shared by the bar export
// (src/lib/xero-export.ts) and the renewals export (src/lib/renewals-xero.ts).
// The treasurer imports the bar journal into Xero with these headings, so both exports
// use them unchanged — fix the format here and it's fixed for both.

export interface JournalLine {
  narration: string;
  date: string;          // YYYY-MM-DD
  description: string;
  accountCode: string;
  debitPence: number;
  creditPence: number;
}

export const XERO_JOURNAL_HEADER = ['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Debit', '*Credit'];

export function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function pounds(pence: number): string {
  return (pence / 100).toFixed(2);
}

/** Appends one CSV row per journal line. */
export function pushJournalRows(rows: string[], lines: JournalLine[], taxRate: string = 'No VAT'): void {
  for (const l of lines) {
    rows.push([
      csvEscape(l.narration),
      l.date,
      csvEscape(l.description),
      csvEscape(l.accountCode),
      csvEscape(taxRate),
      l.debitPence ? pounds(l.debitPence) : '',
      l.creditPence ? pounds(l.creditPence) : '',
    ].join(','));
  }
}
