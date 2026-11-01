// app/banking/renewals-xero/page.tsx
// Renewals → Xero (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §6). Admin and Treasurer.
//
//   Export       — every renewal event not yet in Xero, as one journal per day (totals
//                  by account, no names); Export downloads the CSV and marks it all
//                  exported. Past exports can be downloaded again.
//   Checks       — Membership debtors as at a date, and receipts that should be in
//                  transfers clearing: compare each with its balance in Xero.
//   Adjustments  — a member's renewal account, and the treasurer's extra charges,
//                  credits and refunds.
//   Settings     — the Xero account codes, tax rate and first season.

'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { hasRole } from '@/lib/role-utils';
import { getAlertClasses, getButtonClasses, getCardClasses, getInputClasses } from '@/config/theme-helpers';

type Tab = 'export' | 'checks' | 'adjustments' | 'settings';

interface PreviewLine { description: string; accountName: string; accountCode: string; debitPence: number; creditPence: number }
interface JournalPreview { date: string; narration: string; lines: PreviewLine[]; totalDebitPence: number; totalCreditPence: number }
interface Preview { journals: JournalPreview[]; eventCount: number; missingAccounts: string[]; unbalanced: string[] }
interface ExportSummary { id: string; exportedAt: string; exportedBy: string; fromDate: string; toDate: string; journalCount: number }
interface DebtorsReport { asAt: string; totalPence: number; members: { username: string; fullName: string; balancePence: number }[]; pendingEvents: number }
interface UnmatchedReport {
  totalPence: number;
  unmatched: { paymentId: string; date: string; reference: string; amountPence: number }[];
  unmatchedPence: number;
  matchedNotExportedPence: number;
  bankRefundsNotExportedPence: number;
}
interface MemberAccount {
  userName: string;
  fullName: string;
  submittedAt: string | null;
  voidedAt: string | null;
  feePence: number;
  outstandingPence: number;
  transactions: { id: string; date: string; kind: string; description: string; amountPence: number; reason: string | null; exported: boolean }[];
}

// Same order and labels as RENEWALS_ACCOUNT_FIELDS in src/lib/renewals-xero.ts
const ACCOUNT_FIELDS: [string, string][] = [
  ['renewals_nominal_debtors_account', 'Membership debtors'],
  ['renewals_nominal_transfers_clearing_account', 'Membership transfers clearing'],
  ['renewals_nominal_stripe_clearing_account', 'Stripe clearing'],
  ['renewals_nominal_playing_account', 'Playing membership'],
  ['renewals_nominal_social_account', 'Social membership'],
  ['renewals_nominal_competitions_account', 'Competition entries'],
  ['renewals_nominal_200_club_account', '200 Club entries (liability)'],
  ['renewals_nominal_donations_account', 'Donations with renewals'],
  ['renewals_nominal_adjustments_account', 'Renewal differences and write-offs'],
];

const FEE_TYPE_LABELS: [string, string][] = [
  ['playing', 'Playing membership'],
  ['social', 'Social membership'],
  ['competitions', 'Competition entries'],
  ['200_club', '200 Club'],
];

function gbp(pence: number): string {
  const sign = pence < 0 ? '−' : '';
  return `${sign}£${(Math.abs(pence) / 100).toFixed(2)}`;
}

function ukDate(iso: string): string {
  if (!iso) return '';
  const [year, month, day] = iso.substring(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function downloadCsv(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export default function RenewalsXeroPage() {
  const { data: session, status } = useSession();
  const canAccess = hasRole(session ? session.user.role : undefined, 'Admin', 'Treasurer', 'T');

  const [tab, setTab] = useState<Tab>('export');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Export
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<ExportSummary[]>([]);
  const [loadingExport, setLoadingExport] = useState(true);
  const [exporting, setExporting] = useState(false);

  // Checks
  const [asAt, setAsAt] = useState(todayIso());
  const [debtors, setDebtors] = useState<DebtorsReport | null>(null);
  const [unmatched, setUnmatched] = useState<UnmatchedReport | null>(null);
  const [loadingChecks, setLoadingChecks] = useState(false);
  const [showDebtorMembers, setShowDebtorMembers] = useState(false);

  // Adjustments
  const [members, setMembers] = useState<{ userName: string; fullName: string }[]>([]);
  const [selectedMember, setSelectedMember] = useState('');
  const [account, setAccount] = useState<MemberAccount | null>(null);
  const [adjKind, setAdjKind] = useState<'charge' | 'credit' | 'refund'>('credit');
  const [adjFeeType, setAdjFeeType] = useState('playing');
  const [adjRefundVia, setAdjRefundVia] = useState<'bank' | 'stripe'>('bank');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [savingAdj, setSavingAdj] = useState(false);

  // Settings
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [editSettings, setEditSettings] = useState<Record<string, string>>({});
  const [editingSettings, setEditingSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  const loadExport = async () => {
    setLoadingExport(true);
    try {
      const res = await fetch('/api/banking/renewals-xero');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      setPreview(data.preview);
      setHistory(data.history);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoadingExport(false);
    }
  };

  const loadChecks = async (date: string) => {
    setLoadingChecks(true);
    try {
      const res = await fetch(`/api/banking/renewals-xero/reports?asAt=${encodeURIComponent(date)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the checks');
      setDebtors(data.debtors);
      setUnmatched(data.unmatched);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the checks');
    } finally {
      setLoadingChecks(false);
    }
  };

  const loadMembers = async () => {
    try {
      const res = await fetch('/api/banking/renewals-xero/member');
      const data = await res.json();
      if (res.ok) setMembers(data.members);
    } catch {
      // the picker just stays empty
    }
  };

  const loadAccount = async (userName: string) => {
    setAccount(null);
    if (!userName) return;
    try {
      const res = await fetch(`/api/banking/renewals-xero/member?userName=${encodeURIComponent(userName)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load member');
      setAccount(data.account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load member');
    }
  };

  const loadSettings = async () => {
    try {
      const res = await fetch('/api/banking/renewals-xero/settings');
      const data = await res.json();
      if (res.ok) setSettings(data.settings);
    } catch {
      // shown as blank
    }
  };

  useEffect(() => {
    if (status !== 'authenticated' || !canAccess) return;
    loadExport();
    loadSettings();
    loadMembers();
  }, [status, canAccess]);

  useEffect(() => {
    if (tab === 'checks' && canAccess) loadChecks(asAt);
  }, [tab]);

  const handleExport = async () => {
    setExporting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/banking/renewals-xero/export', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      downloadCsv(data.csv, data.fileName);
      setSuccess(`Exported ${data.fileName}. Import it into Xero as a Manual Journal.`);
      await loadExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleSaveAdjustment = async () => {
    setSavingAdj(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch('/api/banking/renewals-xero/adjustments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: selectedMember,
          kind: adjKind,
          feeType: adjKind === 'refund' ? null : adjFeeType,
          refundVia: adjKind === 'refund' ? adjRefundVia : null,
          amount: parseFloat(adjAmount),
          reason: adjReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record adjustment');
      setAccount(data.account);
      setAdjAmount('');
      setAdjReason('');
      setSuccess('Adjustment recorded. It will go in the next Xero export.');
      loadExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record adjustment');
    } finally {
      setSavingAdj(false);
    }
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    setError('');
    try {
      const updates: Record<string, string> = {};
      for (const [key] of ACCOUNT_FIELDS) updates[key] = editSettings[key] || '';
      updates.renewals_xero_tax_rate = editSettings.renewals_xero_tax_rate || '';
      updates.renewals_xero_first_season = editSettings.renewals_xero_first_season || '';
      const res = await fetch('/api/banking/renewals-xero/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save settings');
      setSettings(data.settings);
      setEditingSettings(false);
      loadExport();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500" />
      </div>
    );
  }

  if (!canAccess) {
    return (
      <main className="max-w-3xl mx-auto py-12 px-4">
        <p className="text-gray-700">Admin or Treasurer access is needed for this page.</p>
      </main>
    );
  }

  const tabs: [Tab, string][] = [
    ['export', 'Export'],
    ['checks', 'Checks'],
    ['adjustments', 'Adjustments'],
    ['settings', 'Settings'],
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-4xl mx-auto py-6 px-4 sm:px-6 lg:px-8 space-y-6">
        <div>
          <Link href="/banking" className="text-sm text-gray-700 hover:text-gray-900">← Banking</Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">Renewals → Xero</h1>
          <p className="text-sm text-gray-700 mt-1">
            One Manual Journal per day with renewal activity, in totals by account. The member detail stays here in the portal.
          </p>
        </div>

        {error && <div className={getAlertClasses('danger')}>{error}</div>}
        {success && <div className={getAlertClasses('success')}>{success}</div>}

        <div className="border-b border-gray-200 flex gap-6 overflow-x-auto">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); setSuccess(''); }}
              className={`pb-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
                tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-700 hover:text-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Export ── */}
        {tab === 'export' && (
          <div className="space-y-6">
            <div className={`${getCardClasses('md')} space-y-4`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-lg font-medium text-gray-900">Waiting to export</h2>
                <button
                  onClick={handleExport}
                  disabled={exporting || loadingExport || !preview || preview.eventCount === 0 || preview.missingAccounts.length > 0}
                  className={getButtonClasses('primary', 'md')}
                >
                  {exporting ? 'Exporting…' : 'Export to CSV'}
                </button>
              </div>

              {loadingExport || !preview ? (
                <p className="text-sm text-gray-700">Loading…</p>
              ) : preview.eventCount === 0 ? (
                <p className="text-sm text-gray-700">Nothing to export — everything is already in Xero.</p>
              ) : (
                <>
                  {preview.missingAccounts.length > 0 && (
                    <div className={getAlertClasses('warning')}>
                      Set the Xero account code for {preview.missingAccounts.join(', ')} on the Settings tab before exporting.
                    </div>
                  )}
                  <p className="text-sm text-gray-700">
                    {preview.eventCount} {preview.eventCount === 1 ? 'item' : 'items'} in {preview.journals.length} {preview.journals.length === 1 ? 'journal' : 'journals'}.
                  </p>
                  {preview.journals.map((j) => (
                    <div key={j.date} className="border border-gray-200 rounded-md overflow-hidden">
                      <div className="bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900">{j.narration}</div>
                      <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="text-left text-gray-700">
                              <th className="px-3 py-1 font-medium">Description</th>
                              <th className="px-3 py-1 font-medium">Account</th>
                              <th className="px-3 py-1 font-medium text-right">Debit</th>
                              <th className="px-3 py-1 font-medium text-right">Credit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {j.lines.map((l, i) => (
                              <tr key={i} className="border-t border-gray-100 text-gray-900">
                                <td className="px-3 py-1">{l.description}</td>
                                <td className="px-3 py-1">{l.accountCode ? l.accountCode : <span className="text-red-700">no code</span>}</td>
                                <td className="px-3 py-1 text-right">{l.debitPence ? gbp(l.debitPence) : ''}</td>
                                <td className="px-3 py-1 text-right">{l.creditPence ? gbp(l.creditPence) : ''}</td>
                              </tr>
                            ))}
                            <tr className="border-t border-gray-300 font-medium text-gray-900">
                              <td className="px-3 py-1" colSpan={2}>Total</td>
                              <td className="px-3 py-1 text-right">{gbp(j.totalDebitPence)}</td>
                              <td className="px-3 py-1 text-right">{gbp(j.totalCreditPence)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            <div className={`${getCardClasses('md')} space-y-3`}>
              <h2 className="text-lg font-medium text-gray-900">Past exports</h2>
              {history.length === 0 ? (
                <p className="text-sm text-gray-700">No exports yet.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {history.map((h) => (
                    <li key={h.id} className="py-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                      <span className="text-gray-900">
                        {ukDate(h.fromDate)}{h.toDate !== h.fromDate ? ` to ${ukDate(h.toDate)}` : ''} — {h.journalCount} {h.journalCount === 1 ? 'journal' : 'journals'}
                        <span className="text-gray-700"> · exported {new Date(h.exportedAt).toLocaleString('en-GB')} by {h.exportedBy}</span>
                      </span>
                      <a href={`/api/banking/renewals-xero/export/${h.id}`} className="text-blue-700 hover:text-blue-900">Download again</a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ── Checks ── */}
        {tab === 'checks' && (
          <div className="space-y-6">
            <div className={`${getCardClasses('md')} space-y-4`}>
              <h2 className="text-lg font-medium text-gray-900">Membership debtors</h2>
              <p className="text-sm text-gray-700">
                What members owed on this date, from everything already exported. It should match the Membership debtors balance in Xero on the same date.
              </p>
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <label htmlFor="as-at" className="text-sm font-medium text-gray-900">As at</label>
                <input id="as-at" type="date" value={asAt} onChange={(e) => setAsAt(e.target.value)} className={`${getInputClasses()} sm:w-48`} />
                <button onClick={() => loadChecks(asAt)} disabled={loadingChecks} className={getButtonClasses('secondary', 'sm')}>
                  {loadingChecks ? 'Working…' : 'Show'}
                </button>
              </div>
              {debtors && (
                <>
                  <p className="text-2xl font-bold text-gray-900">{gbp(debtors.totalPence)}</p>
                  {debtors.pendingEvents > 0 && (
                    <p className="text-sm text-gray-700">
                      {debtors.pendingEvents} {debtors.pendingEvents === 1 ? 'item hasn\'t' : 'items haven\'t'} been exported yet, so {debtors.pendingEvents === 1 ? 'it isn\'t' : 'they aren\'t'} in Xero or in this figure.
                    </p>
                  )}
                  {debtors.members.length > 0 && (
                    <div>
                      <button onClick={() => setShowDebtorMembers(!showDebtorMembers)} className="text-sm text-blue-700 hover:text-blue-900">
                        {showDebtorMembers ? 'Hide' : 'Show'} {debtors.members.length} {debtors.members.length === 1 ? 'member' : 'members'}
                      </button>
                      {showDebtorMembers && (
                        <ul className="mt-2 divide-y divide-gray-100 text-sm">
                          {debtors.members.map((m) => (
                            <li key={m.username} className="py-1 flex justify-between text-gray-900">
                              <span>{m.fullName}</span>
                              <span className={m.balancePence < 0 ? 'text-red-700' : ''}>{gbp(m.balancePence)}{m.balancePence < 0 ? ' (overpaid)' : ''}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className={`${getCardClasses('md')} space-y-3`}>
              <h2 className="text-lg font-medium text-gray-900">Membership transfers clearing</h2>
              <p className="text-sm text-gray-700">
                Subscription receipts on the HSBC feed that haven&apos;t yet gone through an exported journal. It should match the Membership transfers clearing balance in Xero, and is zero once every receipt has been matched and exported.
              </p>
              {unmatched && (
                <>
                  <p className="text-2xl font-bold text-gray-900">{gbp(unmatched.totalPence)}</p>
                  <ul className="text-sm text-gray-900 space-y-1">
                    <li>Not yet matched in Banking: {gbp(unmatched.unmatchedPence)}</li>
                    <li>Matched, not yet exported: {gbp(unmatched.matchedNotExportedPence)}</li>
                    {unmatched.bankRefundsNotExportedPence > 0 && (
                      <li>Less bank refunds not yet exported: {gbp(unmatched.bankRefundsNotExportedPence)}</li>
                    )}
                  </ul>
                  {unmatched.unmatched.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm mt-2">
                        <thead>
                          <tr className="text-left text-gray-700">
                            <th className="py-1 pr-3 font-medium">Payment</th>
                            <th className="py-1 pr-3 font-medium">Date</th>
                            <th className="py-1 pr-3 font-medium">Reference</th>
                            <th className="py-1 font-medium text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unmatched.unmatched.map((p) => (
                            <tr key={p.paymentId} className="border-t border-gray-100 text-gray-900">
                              <td className="py-1 pr-3">{p.paymentId}</td>
                              <td className="py-1 pr-3">{ukDate(p.date)}</td>
                              <td className="py-1 pr-3">{p.reference}</td>
                              <td className="py-1 text-right">{gbp(p.amountPence)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-sm text-gray-700 mt-2">Match these on the <Link href="/banking" className="text-blue-700 hover:text-blue-900">Banking</Link> page.</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Adjustments ── */}
        {tab === 'adjustments' && (
          <div className={`${getCardClasses('md')} space-y-4`}>
            <h2 className="text-lg font-medium text-gray-900">Member adjustments</h2>
            <p className="text-sm text-gray-700">
              Corrections after a renewal has been submitted: an extra charge, a credit, or a refund. The member&apos;s form stays locked; this changes what they owe and goes in the next export. A refund is paid outside the portal — from HSBC, or in the Stripe dashboard.
            </p>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <label htmlFor="adj-member" className="text-sm font-medium text-gray-900">Member</label>
              <select
                id="adj-member"
                value={selectedMember}
                onChange={(e) => { setSelectedMember(e.target.value); loadAccount(e.target.value); }}
                className={`${getInputClasses()} sm:w-80`}
              >
                <option value="">Choose a member…</option>
                {members.map((m) => <option key={m.userName} value={m.userName}>{m.fullName}</option>)}
              </select>
            </div>

            {account && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div className="bg-gray-50 rounded-md p-3"><div className="text-gray-700">Fees</div><div className="text-lg font-semibold text-gray-900">{gbp(account.feePence)}</div></div>
                  <div className="bg-gray-50 rounded-md p-3"><div className="text-gray-700">Outstanding</div><div className="text-lg font-semibold text-gray-900">{gbp(account.outstandingPence)}</div></div>
                  <div className="bg-gray-50 rounded-md p-3"><div className="text-gray-700">Submitted</div><div className="text-lg font-semibold text-gray-900">{account.submittedAt ? ukDate(account.submittedAt) : '—'}</div></div>
                </div>
                {account.voidedAt && <div className={getAlertClasses('info')}>This renewal was voided on {ukDate(account.voidedAt)}.</div>}

                {account.transactions.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="text-left text-gray-700">
                          <th className="py-1 pr-3 font-medium">Date</th>
                          <th className="py-1 pr-3 font-medium">What</th>
                          <th className="py-1 pr-3 font-medium text-right">Amount</th>
                          <th className="py-1 font-medium">In Xero</th>
                        </tr>
                      </thead>
                      <tbody>
                        {account.transactions.map((t) => (
                          <tr key={t.id} className="border-t border-gray-100 text-gray-900 align-top">
                            <td className="py-1 pr-3 whitespace-nowrap">{ukDate(t.date)}</td>
                            <td className="py-1 pr-3">{t.description}{t.reason ? <div className="text-gray-700">{t.reason}</div> : null}</td>
                            <td className="py-1 pr-3 text-right">{gbp(t.amountPence)}</td>
                            <td className="py-1">{t.exported ? 'Yes' : 'Not yet'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {!account.voidedAt && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <h3 className="text-sm font-medium text-gray-900">New adjustment</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm text-gray-900 mb-1">Kind</label>
                        <select value={adjKind} onChange={(e) => setAdjKind(e.target.value as 'charge' | 'credit' | 'refund')} className={getInputClasses()}>
                          <option value="credit">Credit — they owe less</option>
                          <option value="charge">Extra charge — they owe more</option>
                          <option value="refund">Refund — money paid back to them</option>
                        </select>
                      </div>
                      {adjKind === 'refund' ? (
                        <div>
                          <label className="block text-sm text-gray-900 mb-1">Paid back</label>
                          <select value={adjRefundVia} onChange={(e) => setAdjRefundVia(e.target.value as 'bank' | 'stripe')} className={getInputClasses()}>
                            <option value="bank">From the HSBC account</option>
                            <option value="stripe">In the Stripe dashboard</option>
                          </select>
                        </div>
                      ) : (
                        <div>
                          <label className="block text-sm text-gray-900 mb-1">Fee</label>
                          <select value={adjFeeType} onChange={(e) => setAdjFeeType(e.target.value)} className={getInputClasses()}>
                            {FEE_TYPE_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm text-gray-900 mb-1">Amount (£)</label>
                        <input type="number" min="0.01" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} className={getInputClasses()} />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-900 mb-1">Reason (required)</label>
                        <input type="text" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} className={getInputClasses()} />
                      </div>
                    </div>
                    <button
                      onClick={handleSaveAdjustment}
                      disabled={savingAdj || !(parseFloat(adjAmount) > 0) || adjReason.trim() === ''}
                      className={getButtonClasses('primary', 'md')}
                    >
                      {savingAdj ? 'Saving…' : 'Record adjustment'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Settings ── */}
        {tab === 'settings' && (
          <div className={`${getCardClasses('md')} space-y-4`}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">Xero settings</h2>
              {!editingSettings ? (
                <button onClick={() => { setEditSettings({ ...settings }); setEditingSettings(true); }} className="text-sm text-blue-700 hover:text-blue-900">Edit</button>
              ) : (
                <div className="flex gap-3">
                  <button onClick={() => setEditingSettings(false)} className="text-sm text-gray-700 hover:text-gray-900">Cancel</button>
                  <button onClick={handleSaveSettings} disabled={savingSettings} className="text-sm text-blue-700 hover:text-blue-900 disabled:opacity-50">
                    {savingSettings ? 'Saving…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-700">
              The Xero account code for each account. They&apos;re all ordinary current-asset or income accounts, not bank accounts — Xero won&apos;t let a manual journal post to a bank account.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              {ACCOUNT_FIELDS.map(([key, label]) => (
                <div key={key}>
                  <label className="block text-gray-900 mb-1">{label}</label>
                  {editingSettings ? (
                    <input type="text" value={editSettings[key] || ''} onChange={(e) => setEditSettings({ ...editSettings, [key]: e.target.value })} className={getInputClasses()} />
                  ) : (
                    <span className="text-gray-900">{settings[key] || '—'}</span>
                  )}
                </div>
              ))}
              <div>
                <label className="block text-gray-900 mb-1">Card clearing (from the bar)</label>
                <span className="text-gray-900">{settings.bar_nominal_card_account || '—'}</span>
              </div>
              <div>
                <label className="block text-gray-900 mb-1">Cash-in-hand (from the bar)</label>
                <span className="text-gray-900">{settings.bar_nominal_cash_account || '—'}</span>
              </div>
              <div>
                <label className="block text-gray-900 mb-1">Tax rate on every line</label>
                {editingSettings ? (
                  <input type="text" value={editSettings.renewals_xero_tax_rate || ''} onChange={(e) => setEditSettings({ ...editSettings, renewals_xero_tax_rate: e.target.value })} className={getInputClasses()} />
                ) : (
                  <span className="text-gray-900">{settings.renewals_xero_tax_rate || '—'}</span>
                )}
              </div>
              <div>
                <label className="block text-gray-900 mb-1">First season exported to Xero</label>
                {editingSettings ? (
                  <input type="number" value={editSettings.renewals_xero_first_season || ''} onChange={(e) => setEditSettings({ ...editSettings, renewals_xero_first_season: e.target.value })} className={getInputClasses()} />
                ) : (
                  <span className="text-gray-900">{settings.renewals_xero_first_season || '—'}</span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-700">Card clearing and Cash-in-hand are the bar&apos;s accounts, set on Admin config → Bar.</p>
          </div>
        )}
      </main>
    </div>
  );
}
