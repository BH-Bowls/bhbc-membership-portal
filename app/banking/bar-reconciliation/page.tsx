// app/banking/bar-reconciliation/page.tsx
// Treasurer Bar Reconciliation — un-exported bar Day End records (cash-ups from
// /bar), drilling down into the sales/top-ups/refunds behind each figure, and
// a batch export to Xero (see src/lib/xero-export.ts for the CSV format caveat).

'use client';

import { useState, useEffect, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import type { BarDayEnd, BarSaleSummary, BarDayEndLedgerRow } from '@/lib/bar-supabase';

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB');

type DrillKind = 'wallet_sales' | 'card_sales' | 'cash_sales' | 'cash_topups' | 'card_topups' | 'refunds';

const DRILL_LABELS: Record<DrillKind, string> = {
  wallet_sales: 'Wallet sales',
  card_sales: 'Card sales',
  cash_sales: 'Cash sales (visitors)',
  cash_topups: 'Top-ups taken (cash in)',
  card_topups: 'Top-ups taken (by card)',
  refunds: 'Refunds paid (cash out)',
};

export default function BarReconciliationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

  const [dayEnds, setDayEnds] = useState<BarDayEnd[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const [drill, setDrill] = useState<{ dayEndId: string; kind: DrillKind } | null>(null);
  const [drillSales, setDrillSales] = useState<BarSaleSummary[] | null>(null);
  const [drillLedger, setDrillLedger] = useState<BarDayEndLedgerRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      if (!canAccess) router.push('/');
      else load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canAccess, showAll]);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/banking/bar-reconciliation${showAll ? '?all=1' : ''}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load day ends');
      setDayEnds(data.dayEnds);
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message || 'Failed to load day ends');
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
    setDrill(null);
  }

  function toggleSelected(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }

  async function openDrill(dayEndId: string, kind: DrillKind) {
    if (drill && drill.dayEndId === dayEndId && drill.kind === kind) { setDrill(null); return; }
    setDrill({ dayEndId, kind });
    setDrillSales(null); setDrillLedger(null); setDrillLoading(true);
    try {
      const res = await fetch(`/api/banking/bar-reconciliation/transactions?dayEndId=${dayEndId}&kind=${kind}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load transactions');
      if (data.sales) setDrillSales(data.sales);
      if (data.ledger) setDrillLedger(data.ledger);
    } catch (err: any) {
      setError(err.message || 'Failed to load transactions');
    } finally {
      setDrillLoading(false);
    }
  }

  async function exportToXero() {
    if (selected.size === 0) return;
    setExporting(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayEndIds: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to export');
      const blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `bar-xero-export-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to export');
    } finally {
      setExporting(false);
    }
  }

  if (status === 'loading' || loading) {
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

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bar Reconciliation</h1>
            <p className="text-sm text-gray-500">Day End records from the bar till, ready for Xero export</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all records
            </label>
            <button
              onClick={() => router.push('/banking')}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Back to Banking
            </button>
            <button
              onClick={exportToXero}
              disabled={selected.size === 0 || exporting}
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : `Export to Xero (${selected.size})`}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}

        <div className="bg-white rounded-lg shadow overflow-hidden">
          {dayEnds.length === 0 ? (
            <p className="p-6 text-sm text-gray-500">
              {showAll ? 'No Day End records yet.' : 'Nothing to reconcile — every Day End record has already been exported.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-right">Cash expected</th>
                  <th className="px-3 py-2 text-right">Cash removed</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {dayEnds.map((d) => (
                  <Fragment key={d.id}>
                    <tr
                      key={d.id}
                      className="border-t hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleExpand(d.id)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {!d.xeroExportedAt && (
                          <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSelected(d.id)} />
                        )}
                      </td>
                      <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
                      <td className="px-3 py-2">{d.staff}</td>
                      <td className="px-3 py-2 text-right">{fmt(d.cashExpectedPence)}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(d.cashRemovedPence)}</td>
                      <td className="px-3 py-2 text-gray-600">{d.differenceReason || '-'}</td>
                      <td className="px-3 py-2">
                        {d.xeroExportedAt ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Exported</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                        )}
                      </td>
                    </tr>
                    {expandedId === d.id && (
                      <tr key={`${d.id}-detail`} className="border-t bg-gray-50">
                        <td colSpan={7} className="px-6 py-4">
                          <DayEndDetail
                            dayEnd={d}
                            onDrill={(kind) => openDrill(d.id, kind)}
                            activeDrillKind={drill && drill.dayEndId === d.id ? drill.kind : null}
                          />
                          {drill && drill.dayEndId === d.id && (
                            <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
                              <h4 className="text-sm font-semibold text-gray-700 mb-2">{DRILL_LABELS[drill.kind]}</h4>
                              {drillLoading && <p className="text-sm text-gray-500">Loading…</p>}
                              {!drillLoading && drillSales && <SalesTable sales={drillSales} />}
                              {!drillLoading && drillLedger && <LedgerTable ledger={drillLedger} />}
                              {!drillLoading && !drillSales && !drillLedger && (
                                <p className="text-sm text-gray-500">No transactions.</p>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}

function DayEndDetail({ dayEnd, onDrill, activeDrillKind }: { dayEnd: BarDayEnd; onDrill: (kind: DrillKind) => void; activeDrillKind: DrillKind | null }) {
  const row = (label: string, pence: number, kind?: DrillKind) => (
    <div
      className={`flex justify-between py-1.5 px-2 rounded text-sm ${kind ? 'cursor-pointer hover:bg-gray-100' : ''} ${activeDrillKind === kind ? 'bg-blue-50' : ''}`}
      onClick={kind ? () => onDrill(kind) : undefined}
    >
      <span className={kind ? 'text-blue-700 underline decoration-dotted' : ''}>{label}</span>
      <span>{fmt(pence)}</span>
    </div>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
      <div>
        {row('Wallet sales', dayEnd.walletSalesPence, 'wallet_sales')}
        {row('Card sales', dayEnd.cardSalesPence, 'card_sales')}
        {row('Cash sales (visitors)', dayEnd.cashSalesPence, 'cash_sales')}
        {row('Top-ups taken (cash in)', dayEnd.cashTopupsPence, 'cash_topups')}
        {row('Top-ups taken (by card)', dayEnd.cardTopupsPence, 'card_topups')}
        {row('Refunds paid (cash out)', dayEnd.refundsPence, 'refunds')}
      </div>
      <div>
        {row('Till float', dayEnd.floatPence)}
        {row('Cash expected', dayEnd.cashExpectedPence)}
        {row('Cash removed', dayEnd.cashRemovedPence)}
        {row('Member discounts given', dayEnd.discountsGivenPence)}
        {row('Outstanding member balances', dayEnd.outstandingBalancePence)}
        {dayEnd.differenceReason && (
          <div className="py-1.5 px-2 text-sm text-gray-600">Reason: {dayEnd.differenceReason}</div>
        )}
      </div>
    </div>
  );
}

function SalesTable({ sales }: { sales: BarSaleSummary[] }) {
  if (sales.length === 0) return <p className="text-sm text-gray-500">No sales.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-3">Time</th>
          <th className="py-1 pr-3">Member</th>
          <th className="py-1 pr-3">Items</th>
          <th className="py-1 pr-3 text-right">Discount</th>
          <th className="py-1 text-right">Total</th>
        </tr>
      </thead>
      <tbody>
        {sales.map((s) => (
          <tr key={s.id} className="border-t">
            <td className="py-1 pr-3">{fmtDate(s.createdAt)}</td>
            <td className="py-1 pr-3">{s.isCashMovement ? 'Cash Movement' : (s.memberName || 'Visitor')}</td>
            <td className="py-1 pr-3">{s.isCashMovement ? s.reason : s.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}</td>
            <td className="py-1 pr-3 text-right">{s.discountPence > 0 ? fmt(s.discountPence) : '-'}</td>
            <td className="py-1 text-right font-semibold">{fmt(s.totalPence)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LedgerTable({ ledger }: { ledger: BarDayEndLedgerRow[] }) {
  if (ledger.length === 0) return <p className="text-sm text-gray-500">No transactions.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-gray-500">
          <th className="py-1 pr-3">Time</th>
          <th className="py-1 pr-3">Member</th>
          <th className="py-1 pr-3">Staff</th>
          <th className="py-1 pr-3">Note</th>
          <th className="py-1 text-right">Amount</th>
        </tr>
      </thead>
      <tbody>
        {ledger.map((l) => (
          <tr key={l.id} className="border-t">
            <td className="py-1 pr-3">{fmtDate(l.createdAt)}</td>
            <td className="py-1 pr-3">{l.memberName}</td>
            <td className="py-1 pr-3">{l.staff || '-'}</td>
            <td className="py-1 pr-3">{l.note || '-'}</td>
            <td className="py-1 text-right font-semibold">{fmt(l.amountPence)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
