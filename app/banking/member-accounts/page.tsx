// app/banking/member-accounts/page.tsx
// Treasurer Member Accounts report — every bar wallet (including £0 ones) with
// its opening balance, top-ups, spend, refunds, adjustments and closing balance
// for a chosen date range, plus the current balance. Click a member to drill
// into their individual ledger rows for the same range. Both the summary and
// a member's transactions export to CSV.

'use client';

import { useState, useEffect, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import type { MemberAccountSummary, BarLedgerEntry } from '@/lib/bar-supabase';

const fmt = (pence: number) => `${pence < 0 ? '-' : ''}£${(Math.abs(pence) / 100).toFixed(2)}`;
const csvMoney = (pence: number) => (pence / 100).toFixed(2);
const csvText = (s: string) => `"${s.replace(/"/g, '""')}"`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB');
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Local-midnight instant for a YYYY-MM-DD date input, optionally shifted by whole days. */
function boundaryIso(dateStr: string, addDays = 0): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d + addDays).toISOString();
}

const TYPE_LABELS: Record<BarLedgerEntry['type'], string> = {
  topup: 'Top-up',
  purchase: 'Purchase',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

function entryDetail(e: BarLedgerEntry): string {
  const parts: string[] = [];
  if (e.type === 'topup' && e.paymentMethod) parts.push(e.paymentMethod === 'card' ? 'Card' : 'Cash');
  if (e.type === 'purchase' && e.discountPence) parts.push(`${fmt(e.discountPence)} member discount`);
  if (e.note) parts.push(e.note);
  return parts.join(' · ');
}

function downloadCsv(lines: string[], filename: string) {
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

type TotalKey = 'openingPence' | 'topupsPence' | 'purchasesPence' | 'refundsPence' | 'adjustmentsPence' | 'closingPence' | 'currentPence';
const TOTAL_KEYS: TotalKey[] = ['openingPence', 'topupsPence', 'purchasesPence', 'refundsPence', 'adjustmentsPence', 'closingPence', 'currentPence'];

export default function MemberAccountsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

  const [fromDate, setFromDate] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [toDate, setToDate] = useState(() => ymd(new Date()));
  // The range the currently shown figures were loaded for — export/drill-down use
  // this, not the inputs, so editing a date without reloading can't mislabel them.
  const [loadedRange, setLoadedRange] = useState<{ from: string; to: string } | null>(null);
  const [accounts, setAccounts] = useState<MemberAccountSummary[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<BarLedgerEntry[] | null>(null);
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => {
    if (status === 'loading') return;
    if (!canAccess) { router.push('/'); return; }
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canAccess]);

  async function loadReport() {
    if (!fromDate || !toDate) { setError('Choose both dates'); return; }
    if (fromDate > toDate) { setError('The From date must be on or before the To date'); return; }
    setLoading(true);
    setError('');
    setExpandedUser(null);
    setTransactions(null);
    try {
      const params = new URLSearchParams({ from: boundaryIso(fromDate), to: boundaryIso(toDate, 1) });
      const res = await fetch(`/api/banking/member-accounts?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load member accounts');
      setAccounts(data.accounts || []);
      setLoadedRange({ from: fromDate, to: toDate });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function toggleMember(userName: string) {
    if (expandedUser === userName) { setExpandedUser(null); setTransactions(null); return; }
    if (!loadedRange) return;
    setExpandedUser(userName);
    setTransactions(null);
    setTxLoading(true);
    try {
      const params = new URLSearchParams({ userName, from: boundaryIso(loadedRange.from), to: boundaryIso(loadedRange.to, 1) });
      const res = await fetch(`/api/banking/member-accounts/transactions?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load transactions');
      setTransactions(data.transactions || []);
    } catch (err: any) {
      setError(err.message);
      setExpandedUser(null);
    } finally {
      setTxLoading(false);
    }
  }

  const searchLower = search.trim().toLowerCase();
  const shown = searchLower
    ? accounts.filter((a) => a.fullName.toLowerCase().includes(searchLower) || a.userName.toLowerCase().includes(searchLower))
    : accounts;
  const totals = Object.fromEntries(TOTAL_KEYS.map((k) => [k, shown.reduce((sum, a) => sum + a[k], 0)])) as Record<TotalKey, number>;

  function exportSummary() {
    if (!loadedRange) return;
    const lines = [
      `Member Accounts (bar wallets) ${loadedRange.from} to ${loadedRange.to}`,
      'Member,Username,Opening Balance,Top-ups,Spent,Refunds,Adjustments,Closing Balance,Current Balance',
      ...shown.map((a) => [
        csvText(a.fullName), csvText(a.userName),
        ...TOTAL_KEYS.map((k) => csvMoney(a[k])),
      ].join(',')),
      [csvText(`TOTAL (${shown.length} accounts)`), '', ...TOTAL_KEYS.map((k) => csvMoney(totals[k]))].join(','),
    ];
    downloadCsv(lines, `member-accounts-${loadedRange.from}-to-${loadedRange.to}.csv`);
  }

  function exportTransactions(account: MemberAccountSummary) {
    if (!loadedRange || !transactions) return;
    const lines = [
      `${account.fullName} bar wallet ${loadedRange.from} to ${loadedRange.to}`,
      'Date,Type,Detail,Amount,Balance After,Served By',
      ['', csvText('Opening balance'), '', '', csvMoney(account.openingPence), ''].join(','),
      ...transactions.map((t) => [
        csvText(fmtDate(t.createdAt)), csvText(TYPE_LABELS[t.type]), csvText(entryDetail(t)),
        csvMoney(t.amountPence), csvMoney(t.balanceAfterPence), csvText(t.staff || ''),
      ].join(',')),
      ['', csvText('Closing balance'), '', '', csvMoney(account.closingPence), ''].join(','),
    ];
    downloadCsv(lines, `bar-wallet-${account.userName}-${loadedRange.from}-to-${loadedRange.to}.csv`);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!canAccess) return null;

  const moneyCell = 'px-3 py-2 text-right tabular-nums whitespace-nowrap';

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Member Accounts</h1>
          <p className="text-sm text-gray-500">Bar wallet balances and movements per member. Click a member to see their transactions.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}

        <section className="bg-white rounded-lg shadow p-4 flex flex-wrap items-end gap-3">
          <label className="text-sm text-gray-700">
            <span className="block mb-1">From</span>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
          </label>
          <label className="text-sm text-gray-700">
            <span className="block mb-1">To</span>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
          </label>
          <button onClick={loadReport} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm">
            {loading ? 'Loading…' : 'Load'}
          </button>
          <label className="text-sm text-gray-700 ml-auto">
            <span className="block mb-1">Search</span>
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Member name" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" />
          </label>
          <button onClick={exportSummary} disabled={loading || shown.length === 0} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-sm">
            Export CSV
          </button>
        </section>

        {!loading && (
          <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Held in wallets now</div>
              <div className="text-xl font-semibold text-gray-900">{fmt(totals.currentPence)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Top-ups in range</div>
              <div className="text-xl font-semibold text-gray-900">{fmt(totals.topupsPence)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Spent in range</div>
              <div className="text-xl font-semibold text-gray-900">{fmt(totals.purchasesPence)}</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-xs text-gray-500">Accounts</div>
              <div className="text-xl font-semibold text-gray-900">{shown.length}</div>
            </div>
          </section>
        )}

        <section className="bg-white rounded-lg shadow overflow-x-auto">
          {loading ? (
            <div className="text-center py-12 text-gray-600">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="text-center py-12 text-gray-600">{accounts.length === 0 ? 'No bar wallets yet.' : 'No members match your search.'}</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Member</th>
                  <th className="px-3 py-2 text-right font-medium">Opening</th>
                  <th className="px-3 py-2 text-right font-medium">Top-ups</th>
                  <th className="px-3 py-2 text-right font-medium">Spent</th>
                  <th className="px-3 py-2 text-right font-medium">Refunds</th>
                  <th className="px-3 py-2 text-right font-medium">Adjustments</th>
                  <th className="px-3 py-2 text-right font-medium">Closing</th>
                  <th className="px-3 py-2 text-right font-medium">Current</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((a) => (
                  <Fragment key={a.userName}>
                    <tr onClick={() => toggleMember(a.userName)} className={`cursor-pointer hover:bg-gray-50 ${expandedUser === a.userName ? 'bg-blue-50' : ''}`}>
                      <td className="px-3 py-2 text-gray-900">
                        <span className="text-gray-400 mr-1">{expandedUser === a.userName ? '▾' : '▸'}</span>
                        {a.fullName}
                      </td>
                      <td className={moneyCell}>{fmt(a.openingPence)}</td>
                      <td className={moneyCell}>{fmt(a.topupsPence)}</td>
                      <td className={moneyCell}>{fmt(a.purchasesPence)}</td>
                      <td className={moneyCell}>{fmt(a.refundsPence)}</td>
                      <td className={moneyCell}>{fmt(a.adjustmentsPence)}</td>
                      <td className={`${moneyCell} font-medium`}>{fmt(a.closingPence)}</td>
                      <td className={moneyCell}>{fmt(a.currentPence)}</td>
                    </tr>
                    {expandedUser === a.userName && (
                      <tr>
                        <td colSpan={8} className="px-3 py-3 bg-gray-50">
                          {txLoading || !transactions ? (
                            <div className="text-gray-600 py-2">Loading transactions…</div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-gray-700">
                                  {transactions.length} transaction{transactions.length === 1 ? '' : 's'} between {loadedRange?.from} and {loadedRange?.to}
                                </div>
                                <button onClick={() => exportTransactions(a)} className="text-sm text-blue-600 hover:text-blue-800">Export CSV</button>
                              </div>
                              {transactions.length > 0 && (
                                <table className="min-w-full text-sm bg-white border border-gray-200 rounded">
                                  <thead className="text-gray-700">
                                    <tr>
                                      <th className="px-3 py-1.5 text-left font-medium">Date</th>
                                      <th className="px-3 py-1.5 text-left font-medium">Type</th>
                                      <th className="px-3 py-1.5 text-left font-medium">Detail</th>
                                      <th className="px-3 py-1.5 text-right font-medium">Amount</th>
                                      <th className="px-3 py-1.5 text-right font-medium">Balance after</th>
                                      <th className="px-3 py-1.5 text-left font-medium">Served by</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-100">
                                    {transactions.map((t) => (
                                      <tr key={t.id}>
                                        <td className="px-3 py-1.5 whitespace-nowrap">{fmtDate(t.createdAt)}</td>
                                        <td className="px-3 py-1.5">{TYPE_LABELS[t.type]}</td>
                                        <td className="px-3 py-1.5 text-gray-700">{entryDetail(t)}</td>
                                        <td className={`px-3 py-1.5 text-right tabular-nums ${t.amountPence < 0 ? 'text-red-700' : 'text-green-700'}`}>{fmt(t.amountPence)}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">{fmt(t.balanceAfterPence)}</td>
                                        <td className="px-3 py-1.5 text-gray-700">{t.staff || ''}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-medium text-gray-900">
                <tr>
                  <td className="px-3 py-2">Total ({shown.length})</td>
                  {TOTAL_KEYS.map((k) => <td key={k} className={moneyCell}>{fmt(totals[k])}</td>)}
                </tr>
              </tfoot>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}
