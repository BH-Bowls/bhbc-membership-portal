// app/banking/report/page.tsx
// Banking Report, for one year (?year=), in two tabs (?tab=):
//   Subs        — Paid / Unpaid Subs and the payments allocated to that season's renewals
//   Rowland Cup — Paid / Owing club entries and their payments (bank and cash)
// Unallocated payments have no year until they're matched, so both tabs show them.

'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import { YearSelect } from '@/components/YearSelect';

interface RenewalReportRow {
  userName: string;
  fullName: string;
  renewingMembership: string;
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
  stripe: number;
}

interface PaymentReportRow {
  paymentId: string;
  date: string;
  type: 'TRF' | 'CDM' | 'CHQ' | 'CSH' | 'STR';
  reference: string;
  amount: number;
  status: string;
  matchedUsers: string;
}

interface ReportTotals {
  playingFee: number;
  socialFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFeeDue: number;
  outstanding: number;
  banking: number;
  difference: number;
  donations: number;
  cardMachine: number;
  bankTransfer: number;
  cheque: number;
  cash: number;
  stripe: number;
  count: number;
}

interface PaymentTotals {
  TRF: { amount: number; count: number };
  CDM: { amount: number; count: number };
  CHQ: { amount: number; count: number };
  CSH: { amount: number; count: number };
  STR: { amount: number; count: number };
  total: { amount: number; count: number };
}

interface RowlandReportRow {
  entryId: string;
  clubName: string;
  teams: number;
  due: number;
  received: number;
  outstanding: number;
  status: 'Unpaid' | 'Partial' | 'Paid';
  paidAt: string | null;
}

interface RowlandTotals {
  count: number;
  teams: number;
  due: number;
  received: number;
  outstanding: number;
}

interface PaymentList {
  rows: PaymentReportRow[];
  totals: PaymentTotals;
}

interface ReportData {
  year: number;
  currentYear: number;
  years: number[];
  paidSubs: { rows: RenewalReportRow[]; totals: ReportTotals };
  unpaidSubs: { rows: RenewalReportRow[]; totals: ReportTotals };
  allocatedPayments: PaymentList;
  allocatedUnknownYear: PaymentList;
  unallocatedPayments: PaymentList;
  rowland: {
    paid: { rows: RowlandReportRow[]; totals: RowlandTotals };
    owing: { rows: RowlandReportRow[]; totals: RowlandTotals };
    payments: PaymentList;
  };
}

type Tab = 'subs' | 'rowland';

// Format currency
const formatCurrency = (amount: number) => `£${amount.toFixed(2)}`;

// Get payment types used by a member
const getPaymentTypes = (row: RenewalReportRow): string => {
  const types: string[] = [];
  if (row.bankTransfer > 0) types.push('TRF');
  if (row.cardMachine > 0) types.push('CDM');
  if (row.cheque > 0) types.push('CHQ');
  if (row.cash > 0) types.push('CSH');
  if (row.stripe > 0) types.push('STR');
  return types.join(', ') || '-';
};

const PAYMENT_TYPES: { key: keyof Omit<PaymentTotals, 'total'>; label: string }[] = [
  { key: 'TRF', label: 'Bank Transfer' },
  { key: 'CDM', label: 'Card Machine' },
  { key: 'CHQ', label: 'Cheque' },
  { key: 'CSH', label: 'Cash' },
  { key: 'STR', label: 'Online (Stripe)' },
];

/**
 * The unallocated payments that belong on a tab, by reference: "SUBS" for Subs,
 * "EGR" (the Rowland Cup entry reference) for Rowland Cup.
 */
function unallocatedForTab(list: PaymentList, tab: Tab): PaymentList {
  const pattern = tab === 'rowland' ? /\bEGR\b/i : /SUBS/i;
  const totals: PaymentTotals = {
    TRF: { amount: 0, count: 0 },
    CDM: { amount: 0, count: 0 },
    CHQ: { amount: 0, count: 0 },
    CSH: { amount: 0, count: 0 },
    STR: { amount: 0, count: 0 },
    total: { amount: 0, count: 0 },
  };
  const rows: PaymentReportRow[] = [];
  for (const row of list.rows) {
    if (!pattern.test(row.reference)) continue;
    rows.push(row);
    if (totals[row.type]) {
      totals[row.type].amount += row.amount;
      totals[row.type].count += 1;
    }
    totals.total.amount += row.amount;
    totals.total.count += 1;
  }
  return { rows, totals };
}

/** CSV lines for a payments list: rows, then totals by type. */
function paymentsCsv(title: string, list: PaymentList, withMatched: boolean): string {
  let csv = `${title}\n`;
  csv += withMatched ? 'Payment ID,Date,Type,Reference,Amount,Matched To\n' : 'Payment ID,Date,Type,Reference,Amount\n';
  for (const row of list.rows) {
    csv += `${row.paymentId},${row.date},${row.type},"${row.reference}",${row.amount}`;
    csv += withMatched ? `,"${row.matchedUsers}"\n` : '\n';
  }
  for (const t of PAYMENT_TYPES) {
    csv += `"${t.label}",,,,${list.totals[t.key].amount},"${list.totals[t.key].count} records"\n`;
  }
  csv += `"GRAND TOTAL",,,,${list.totals.total.amount},"${list.totals.total.count} records"\n\n`;
  return csv;
}

/** A collapsible report section: a heading row with a total, a summary, and detail rows. */
function Section({
  title,
  colour,
  countLabel,
  total,
  expanded,
  onToggle,
  summary,
  children,
}: {
  title: string;
  colour: string;
  countLabel: string;
  total: number;
  expanded: boolean;
  onToggle: () => void;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-lg shadow">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex justify-between items-center hover:bg-gray-50 print:hover:bg-white"
      >
        <div className="flex items-center space-x-3">
          <span className={`transform transition-transform ${expanded ? 'rotate-90' : ''} print:hidden`}>▶</span>
          <h2 className={`text-lg font-semibold ${colour}`}>{title}</h2>
          <span className="text-sm text-gray-700">({countLabel})</span>
        </div>
        <span className={`text-lg font-bold ${colour}`}>{formatCurrency(total)}</span>
      </button>
      {summary && <div className="px-6 pb-4 border-t">{summary}</div>}
      {expanded && (
        <div className="border-t max-h-96 overflow-y-auto print:max-h-none print:overflow-visible">{children}</div>
      )}
    </div>
  );
}

/** Totals by payment type, with a grand total. */
function PaymentTypeTotals({ totals, colour }: { totals: PaymentTotals; colour: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-4 py-4 text-sm">
      {PAYMENT_TYPES.map(t => (
        <div key={t.key}>
          <span className="text-gray-700">{t.label}</span>
          <div className="font-semibold">{formatCurrency(totals[t.key].amount)}</div>
          <div className="text-xs text-gray-700">{totals[t.key].count} records</div>
        </div>
      ))}
      <div className="border-l pl-4">
        <span className="text-gray-700 font-medium">Grand Total</span>
        <div className={`font-bold ${colour}`}>{formatCurrency(totals.total.amount)}</div>
        <div className="text-xs text-gray-700">{totals.total.count} records</div>
      </div>
    </div>
  );
}

/** The detail table for a payments list. */
function PaymentsTable({ rows, withMatched, badge }: { rows: PaymentReportRow[]; withMatched: boolean; badge: string }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 sticky top-0">
        <tr>
          <th className="px-4 py-2 text-left">ID</th>
          <th className="px-2 py-2 text-left">Date</th>
          <th className="px-2 py-2 text-left">Type</th>
          <th className="px-2 py-2 text-left">Reference</th>
          <th className="px-2 py-2 text-right">Amount</th>
          {withMatched && <th className="px-4 py-2 text-left">Matched To</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.paymentId}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
            <td className="px-4 py-2 font-mono text-xs">{row.paymentId || '—'}</td>
            <td className="px-2 py-2">{row.date}</td>
            <td className="px-2 py-2">
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${badge}`}>{row.type}</span>
            </td>
            <td className="px-2 py-2 truncate max-w-xs">{row.reference}</td>
            <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.amount)}</td>
            {withMatched && <td className="px-4 py-2 text-gray-700 truncate max-w-xs">{row.matchedUsers}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The detail table for Rowland Cup entries. */
function RowlandTable({ rows, owing }: { rows: RowlandReportRow[]; owing: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-gray-50 sticky top-0">
        <tr>
          <th className="px-4 py-2 text-left">Club</th>
          <th className="px-2 py-2 text-right">Teams</th>
          <th className="px-2 py-2 text-right">Due</th>
          <th className="px-2 py-2 text-right">Received</th>
          {owing ? (
            <>
              <th className="px-2 py-2 text-right">Outstanding</th>
              <th className="px-4 py-2 text-left">Status</th>
            </>
          ) : (
            <th className="px-4 py-2 text-left">Paid</th>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.entryId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
            <td className="px-4 py-2">{row.clubName}</td>
            <td className="px-2 py-2 text-right">{row.teams}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(row.due)}</td>
            <td className="px-2 py-2 text-right">{formatCurrency(row.received)}</td>
            {owing ? (
              <>
                <td className="px-2 py-2 text-right font-semibold text-red-600">{formatCurrency(row.outstanding)}</td>
                <td className="px-4 py-2">{row.status}</td>
              </>
            ) : (
              <td className="px-4 py-2">{row.paidAt ? new Date(row.paidAt).toLocaleDateString('en-GB') : ''}</td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BankingReportPage() {
  return (
    <Suspense>
      <BankingReport />
    </Suspense>
  );
}

function BankingReport() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const yearParam = searchParams.get('year') || '';
  const tab: Tab = searchParams.get('tab') === 'rowland' ? 'rowland' : 'subs';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [data, setData] = useState<ReportData | null>(null);

  // Collapsible section states
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});

  // Check authorization
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

  useEffect(() => {
    if (status === 'authenticated') {
      if (!canAccess) {
        router.push('/');
      } else {
        loadReport();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canAccess, yearParam]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError('');

      const res = await fetch(`/api/banking/report${yearParam ? `?year=${encodeURIComponent(yearParam)}` : ''}`);
      if (!res.ok) {
        throw new Error('Failed to load report');
      }

      const reportData = await res.json();
      setData(reportData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const setParams = (year: string, newTab: Tab) => {
    const params = new URLSearchParams();
    if (year) params.set('year', year);
    if (newTab === 'rowland') params.set('tab', 'rowland');
    const query = params.toString();
    router.replace(`/banking/report${query ? `?${query}` : ''}`);
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Print functionality
  const handlePrint = () => {
    window.print();
  };

  // CSV Export — the tab on show, for the year on show
  const handleExportCSV = () => {
    if (!data) return;

    let csv = '';

    if (tab === 'subs') {
      csv += `SUBS ${data.year}\n\n`;

      // Paid Subs section
      csv += 'PAID SUBS\n';
      csv += 'Member,Playing Fee,Social Fee,Competitions Fee,Club 200 Fee,Total Fee Due,Outstanding,Banking,Difference,Donations,Card Machine,Bank Transfer,Cheque,Cash,Stripe\n';
      for (const row of data.paidSubs.rows) {
        csv += `"${row.fullName}",${row.playingFee},${row.socialFee},${row.competitionsFee},${row.club200Fee},${row.totalFeeDue},${row.outstanding},${row.banking},${row.difference},${row.donations},${row.cardMachine},${row.bankTransfer},${row.cheque},${row.cash},${row.stripe}\n`;
      }
      const pt = data.paidSubs.totals;
      csv += `"TOTAL (${pt.count} records)",${pt.playingFee},${pt.socialFee},${pt.competitionsFee},${pt.club200Fee},${pt.totalFeeDue},${pt.outstanding},${pt.banking},${pt.difference},${pt.donations},${pt.cardMachine},${pt.bankTransfer},${pt.cheque},${pt.cash},${pt.stripe}\n`;
      csv += '\n';

      // Unpaid Subs section
      csv += 'UNPAID SUBS\n';
      csv += 'Member,Playing Fee,Social Fee,Competitions Fee,Club 200 Fee,Total Fee Due,Outstanding\n';
      for (const row of data.unpaidSubs.rows) {
        csv += `"${row.fullName}",${row.playingFee},${row.socialFee},${row.competitionsFee},${row.club200Fee},${row.totalFeeDue},${row.outstanding}\n`;
      }
      const ut = data.unpaidSubs.totals;
      csv += `"TOTAL (${ut.count} records)",${ut.playingFee},${ut.socialFee},${ut.competitionsFee},${ut.club200Fee},${ut.totalFeeDue},${ut.outstanding}\n`;
      csv += '\n';

      csv += paymentsCsv('ALLOCATED PAYMENTS', data.allocatedPayments, true);
      if (data.allocatedUnknownYear.rows.length > 0) {
        csv += paymentsCsv('ALLOCATED PAYMENTS - YEAR NOT KNOWN', data.allocatedUnknownYear, true);
      }
    } else {
      csv += `ROWLAND CUP ${data.year}\n\n`;
      const rowlandCsv = (title: string, rows: RowlandReportRow[], totals: RowlandTotals) => {
        let out = `${title}\nClub,Teams,Due,Received,Outstanding,Status\n`;
        for (const r of rows) {
          out += `"${r.clubName}",${r.teams},${r.due},${r.received},${r.outstanding},${r.status}\n`;
        }
        out += `"TOTAL (${totals.count} clubs)",${totals.teams},${totals.due},${totals.received},${totals.outstanding},\n\n`;
        return out;
      };
      csv += rowlandCsv('PAID ENTRIES', data.rowland.paid.rows, data.rowland.paid.totals);
      csv += rowlandCsv('UNPAID AND PART PAID ENTRIES', data.rowland.owing.rows, data.rowland.owing.totals);
      csv += paymentsCsv('ROWLAND CUP PAYMENTS', data.rowland.payments, true);
    }

    csv += paymentsCsv(
      tab === 'rowland' ? 'UNALLOCATED EGR PAYMENTS (ANY YEAR)' : 'UNALLOCATED SUBS PAYMENTS (ANY YEAR)',
      unallocatedForTab(data.unallocatedPayments, tab),
      false
    );

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `banking-report-${tab === 'rowland' ? 'rowland-cup' : 'subs'}-${data.year}-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (status === 'loading' || (loading && !data)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-700">Loading report...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) {
    return null;
  }

  const shownYear = data ? data.year : yearParam;

  // Unallocated payments for this tab only: SUBS references on Subs, EGR on Rowland Cup
  const unallocated = data ? unallocatedForTab(data.unallocatedPayments, tab) : null;
  const unallocatedSection = unallocated && (
    <Section
      title="Unallocated Payments"
      colour="text-orange-700"
      countLabel={`${unallocated.totals.total.count} payments with ${tab === 'rowland' ? 'EGR' : 'SUBS'} in the reference, any year`}
      total={unallocated.totals.total.amount}
      expanded={!!expandedSections.unallocatedPayments}
      onToggle={() => toggleSection('unallocatedPayments')}
      summary={<PaymentTypeTotals totals={unallocated.totals} colour="text-orange-700" />}
    >
      <PaymentsTable rows={unallocated.rows} withMatched={false} badge="bg-orange-100 text-orange-700" />
    </Section>
  );

  return (
    <div className="min-h-screen bg-gray-50">

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6 print:mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Banking Report{' '}
              <span className="hidden print:inline">
                — {tab === 'rowland' ? 'Rowland Cup' : 'Subs'} {shownYear}
              </span>
            </h1>
            <p className="text-sm text-gray-700">Generated: {new Date().toLocaleDateString('en-GB')}</p>
          </div>

          <div className="flex flex-wrap items-center gap-3 print:hidden">
            {data && (
              <YearSelect
                years={data.years}
                value={data.year}
                onChange={(year) => setParams(year, tab)}
              />
            )}
            <button
              onClick={() => router.push('/banking')}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Back to Banking
            </button>
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
              Download CSV
            </button>
            <button
              onClick={handlePrint}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Print
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-6 print:hidden">
          {([['subs', 'Subs'], ['rowland', 'Rowland Cup']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setParams(yearParam, key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                tab === key ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              {label} {shownYear}
            </button>
          ))}
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {data && tab === 'subs' && (
          <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
            {/* Paid Subs Section */}
            <Section
              title="Paid Subs"
              colour="text-green-700"
              countLabel={`${data.paidSubs.totals.count} members`}
              total={data.paidSubs.totals.totalFeeDue}
              expanded={!!expandedSections.paidSubs}
              onToggle={() => toggleSection('paidSubs')}
              summary={
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 py-4 text-sm">
                    {([
                      ['Playing Fee', data.paidSubs.totals.playingFee],
                      ['Social Fee', data.paidSubs.totals.socialFee],
                      ['Competitions', data.paidSubs.totals.competitionsFee],
                      ['Club 200', data.paidSubs.totals.club200Fee],
                      ['Banking', data.paidSubs.totals.banking],
                      ['Donations', data.paidSubs.totals.donations],
                      ['Difference', data.paidSubs.totals.difference],
                    ] as const).map(([label, value]) => (
                      <div key={label}>
                        <span className="text-gray-700">{label}</span>
                        <div className="font-semibold">{formatCurrency(value)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 pt-2 border-t text-sm">
                    {([
                      ['Bank Transfer', data.paidSubs.totals.bankTransfer],
                      ['Card Machine', data.paidSubs.totals.cardMachine],
                      ['Cheque', data.paidSubs.totals.cheque],
                      ['Cash', data.paidSubs.totals.cash],
                      ['Online (Stripe)', data.paidSubs.totals.stripe],
                    ] as const).map(([label, value]) => (
                      <div key={label}>
                        <span className="text-gray-700">{label}</span>
                        <div className="font-semibold">{formatCurrency(value)}</div>
                      </div>
                    ))}
                  </div>
                </>
              }
            >
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-2 py-2 text-right">Playing</th>
                    <th className="px-2 py-2 text-right">Social</th>
                    <th className="px-2 py-2 text-right">Comp</th>
                    <th className="px-2 py-2 text-right">Club 200</th>
                    <th className="px-2 py-2 text-right">Total</th>
                    <th className="px-2 py-2 text-right">Banking</th>
                    <th className="px-2 py-2 text-right">Diff</th>
                    <th className="px-2 py-2 text-right">Donations</th>
                    <th className="px-2 py-2 text-center">Payment Type</th>
                  </tr>
                </thead>
                <tbody>
                  {data.paidSubs.rows.map((row, index) => (
                    <tr key={row.userName} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2">
                        {row.fullName}
                        {row.renewingMembership === 'N' && (
                          <span className="ml-1 text-orange-600 text-xs">(leaving)</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.playingFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.socialFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.competitionsFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.club200Fee)}</td>
                      <td className="px-2 py-2 text-right font-semibold">{formatCurrency(row.totalFeeDue)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.banking)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.difference)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.donations)}</td>
                      <td className="px-2 py-2 text-center">{getPaymentTypes(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Unpaid Subs Section */}
            <Section
              title="Unpaid Subs"
              colour="text-red-700"
              countLabel={`${data.unpaidSubs.totals.count} members`}
              total={data.unpaidSubs.totals.outstanding}
              expanded={!!expandedSections.unpaidSubs}
              onToggle={() => toggleSection('unpaidSubs')}
              summary={
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 py-4 text-sm">
                  {([
                    ['Playing Fee', data.unpaidSubs.totals.playingFee],
                    ['Social Fee', data.unpaidSubs.totals.socialFee],
                    ['Competitions', data.unpaidSubs.totals.competitionsFee],
                    ['Club 200', data.unpaidSubs.totals.club200Fee],
                    ['Total Fee Due', data.unpaidSubs.totals.totalFeeDue],
                  ] as const).map(([label, value]) => (
                    <div key={label}>
                      <span className="text-gray-700">{label}</span>
                      <div className="font-semibold">{formatCurrency(value)}</div>
                    </div>
                  ))}
                  <div>
                    <span className="text-gray-700">Outstanding</span>
                    <div className="font-semibold text-red-600">{formatCurrency(data.unpaidSubs.totals.outstanding)}</div>
                  </div>
                </div>
              }
            >
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">Member</th>
                    <th className="px-2 py-2 text-right">Playing</th>
                    <th className="px-2 py-2 text-right">Social</th>
                    <th className="px-2 py-2 text-right">Comp</th>
                    <th className="px-2 py-2 text-right">Club 200</th>
                    <th className="px-2 py-2 text-right">Total Due</th>
                    <th className="px-2 py-2 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {data.unpaidSubs.rows.map((row, index) => (
                    <tr key={row.userName} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="px-4 py-2">{row.fullName}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.playingFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.socialFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.competitionsFee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.club200Fee)}</td>
                      <td className="px-2 py-2 text-right">{formatCurrency(row.totalFeeDue)}</td>
                      <td className="px-2 py-2 text-right font-semibold text-red-600">{formatCurrency(row.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>

            {/* Allocated Payments Section */}
            <Section
              title="Allocated Payments"
              colour="text-blue-700"
              countLabel={`${data.allocatedPayments.totals.total.count} payments`}
              total={data.allocatedPayments.totals.total.amount}
              expanded={!!expandedSections.allocatedPayments}
              onToggle={() => toggleSection('allocatedPayments')}
              summary={<PaymentTypeTotals totals={data.allocatedPayments.totals} colour="text-blue-700" />}
            >
              <PaymentsTable rows={data.allocatedPayments.rows} withMatched badge="bg-blue-100 text-blue-700" />
            </Section>

            {/* Matched renewal payments whose season couldn't be worked out */}
            {data.allocatedUnknownYear.rows.length > 0 && (
              <Section
                title="Allocated Payments, year not known"
                colour="text-gray-900"
                countLabel={`${data.allocatedUnknownYear.totals.total.count} payments, not linked to a renewal year`}
                total={data.allocatedUnknownYear.totals.total.amount}
                expanded={!!expandedSections.allocatedUnknownYear}
                onToggle={() => toggleSection('allocatedUnknownYear')}
              >
                <PaymentsTable rows={data.allocatedUnknownYear.rows} withMatched badge="bg-gray-100 text-gray-700" />
              </Section>
            )}

            {unallocatedSection}
          </div>
        )}

        {data && tab === 'rowland' && (
          <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
            {(['paid', 'owing'] as const).map(key => {
              const part = data.rowland[key];
              const paid = key === 'paid';
              return (
                <Section
                  key={key}
                  title={paid ? 'Paid Entries' : 'Unpaid and Part Paid Entries'}
                  colour={paid ? 'text-green-700' : 'text-red-700'}
                  countLabel={`${part.totals.count} club${part.totals.count === 1 ? '' : 's'}, ${part.totals.teams} team${part.totals.teams === 1 ? '' : 's'}`}
                  total={paid ? part.totals.received : part.totals.outstanding}
                  expanded={!!expandedSections[`rowland-${key}`]}
                  onToggle={() => toggleSection(`rowland-${key}`)}
                  summary={
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 text-sm">
                      <div>
                        <span className="text-gray-700">Teams</span>
                        <div className="font-semibold">{part.totals.teams}</div>
                      </div>
                      <div>
                        <span className="text-gray-700">Due</span>
                        <div className="font-semibold">{formatCurrency(part.totals.due)}</div>
                      </div>
                      <div>
                        <span className="text-gray-700">Received</span>
                        <div className="font-semibold">{formatCurrency(part.totals.received)}</div>
                      </div>
                      <div>
                        <span className="text-gray-700">Outstanding</span>
                        <div className={`font-semibold ${paid ? '' : 'text-red-600'}`}>{formatCurrency(part.totals.outstanding)}</div>
                      </div>
                    </div>
                  }
                >
                  <RowlandTable rows={part.rows} owing={!paid} />
                </Section>
              );
            })}

            <Section
              title="Rowland Cup Payments"
              colour="text-blue-700"
              countLabel={`${data.rowland.payments.totals.total.count} payments`}
              total={data.rowland.payments.totals.total.amount}
              expanded={!!expandedSections.rowlandPayments}
              onToggle={() => toggleSection('rowlandPayments')}
              summary={<PaymentTypeTotals totals={data.rowland.payments.totals} colour="text-blue-700" />}
            >
              <PaymentsTable rows={data.rowland.payments.rows} withMatched badge="bg-blue-100 text-blue-700" />
            </Section>

            {unallocatedSection}
          </div>
        )}
      </main>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: auto;
            margin: 10mm;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:inline {
            display: inline !important;
          }
          .print\\:max-h-none {
            max-height: none !important;
          }
          .print\\:overflow-visible {
            overflow: visible !important;
          }
          .print\\:mb-4 {
            margin-bottom: 1rem !important;
          }
          .print\\:hover\\:bg-white:hover {
            background-color: white !important;
          }
          body {
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }
          /* Ensure tables can shrink */
          table {
            font-size: 9pt;
          }
        }
      `}</style>
    </div>
  );
}
