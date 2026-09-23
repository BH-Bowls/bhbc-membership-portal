// app/banking/bar-reconciliation/page.tsx
// Treasurer Bar Reconciliation — implements specs/BAR_BANKING_XERO_SPEC.md:
//   1. Day Ends await confirmation (reviewed, and corrected if needed) before
//      they can be banked or exported.
//   2. Confirmed Day Ends can be exported to Xero individually (their own
//      revenue journal, unchanged) and/or bundled into a Banking batch.
//   3. Bankings group several confirmed Day Ends into one paying-in-slip total,
//      exported separately as a simple Cash-in-hand -> Cash Banked transfer.
//   4. "+ Non-Till Cash" records money that never went through the till
//      (raffle, teas) as its own standalone, already-linked Day End.

'use client';

import { useState, useEffect, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { hasRole } from '@/lib/role-utils';
import type { BarDayEnd, BarBanking, BarSaleSummary, BarDayEndLedgerRow, BarProduct, BarCategoryRow } from '@/lib/bar-supabase';

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-GB');
const today = () => new Date().toISOString().slice(0, 10);

type DrillKind = 'wallet_sales' | 'card_sales' | 'cash_sales' | 'cash_movements' | 'cash_topups' | 'card_topups' | 'refunds';

const DRILL_LABELS: Record<DrillKind, string> = {
  wallet_sales: 'Wallet sales',
  card_sales: 'Card sales',
  cash_sales: 'Cash sales (visitors)',
  cash_movements: 'Cash Movements',
  cash_topups: 'Top-ups taken (cash in)',
  card_topups: 'Top-ups taken (by card)',
  refunds: 'Refunds paid (cash out)',
};

interface MemberOption { userName: string; fullName: string }

export default function BarReconciliationPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const canAccess = hasRole(session?.user?.role, 'Admin', 'Treasurer', 'T');

  const [unconfirmed, setUnconfirmed] = useState<BarDayEnd[]>([]);
  const [confirmed, setConfirmed] = useState<BarDayEnd[]>([]);
  const [bankings, setBankings] = useState<BarBanking[]>([]);
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [categories, setCategories] = useState<BarCategoryRow[]>([]);
  const [showAllBankings, setShowAllBankings] = useState(false);
  const [showProcessed, setShowProcessed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Shared expand/drill state (one row expanded at a time, either section).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ dayEndId: string; kind: DrillKind } | null>(null);
  const [drillSales, setDrillSales] = useState<BarSaleSummary[] | null>(null);
  const [drillLedger, setDrillLedger] = useState<BarDayEndLedgerRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);

  // Editing an unconfirmed Day End
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCashRemoved, setEditCashRemoved] = useState('');
  const [editCarryForward, setEditCarryForward] = useState(false);
  const [editReason, setEditReason] = useState('');

  // Confirmed Day Ends -> Create Banking / Export to Xero
  const [selectedConfirmed, setSelectedConfirmed] = useState<Set<string>>(new Set());
  const [exportingDayEnds, setExportingDayEnds] = useState(false);
  const [showBankingModal, setShowBankingModal] = useState(false);
  const [bankedDate, setBankedDate] = useState(today());
  const [bankingNote, setBankingNote] = useState('');

  // Bankings -> expand contents / Export to Xero
  const [expandedBankingId, setExpandedBankingId] = useState<string | null>(null);
  const [bankingDayEnds, setBankingDayEnds] = useState<BarDayEnd[] | null>(null);
  const [addToBankingId, setAddToBankingId] = useState('');
  const [selectedBankings, setSelectedBankings] = useState<Set<string>>(new Set());
  const [exportingBankings, setExportingBankings] = useState(false);

  // Non-Till Cash (manual entry)
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [membersLoaded, setMembersLoaded] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      if (!canAccess) router.push('/');
      else load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, canAccess, showAllBankings]);

  async function load() {
    setLoading(true); setError('');
    try {
      const [reconRes, prodRes, catRes] = await Promise.all([
        fetch(`/api/banking/bar-reconciliation${showAllBankings ? '?allBankings=1' : ''}`),
        fetch('/api/bar/products?all=1'),
        fetch('/api/bar/categories?all=1'),
      ]);
      const reconData = await reconRes.json();
      if (!reconRes.ok) throw new Error(reconData.error || 'Failed to load reconciliation data');
      setUnconfirmed(reconData.unconfirmed);
      setConfirmed(reconData.confirmed);
      setBankings(reconData.bankings);
      const prodData = await prodRes.json();
      if (prodRes.ok) setProducts(prodData.products);
      const catData = await catRes.json();
      if (catRes.ok) setCategories(catData.categories);
      setSelectedConfirmed(new Set());
      setSelectedBankings(new Set());
    } catch (err: any) {
      setError(err.message || 'Failed to load reconciliation data');
    } finally {
      setLoading(false);
    }
  }

  async function loadMembersOnce() {
    if (membersLoaded) return;
    try {
      const res = await fetch('/api/members/lookup?filter=none');
      const data = await res.json();
      if (res.ok) setMembers(data.members ?? []);
      setMembersLoaded(true);
    } catch {
      setMembersLoaded(true);
    }
  }

  function toggleExpand(id: string) {
    setExpandedId(expandedId === id ? null : id);
    setDrill(null);
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

  // ── Confirm / edit ──────────────────────────────────────────────────────

  function startEdit(d: BarDayEnd) {
    setEditingId(d.id);
    setEditCashRemoved((d.cashRemovedPence / 100).toFixed(2));
    setEditCarryForward(d.carriedForward);
    setEditReason(d.differenceReason || '');
  }

  async function saveEdit(d: BarDayEnd) {
    const cashRemovedPence = Math.round(parseFloat(editCashRemoved || '0') * 100);
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayEndId: d.id, cashRemovedPence, carryForward: editCarryForward, reason: editReason || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      setEditingId(null);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function doConfirm(d: BarDayEnd) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayEndId: d.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to confirm');
      setSuccess(`Confirmed the ${fmtDate(d.createdAt)} cash-up.`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to confirm');
    } finally {
      setBusy(false);
    }
  }

  async function doUnconfirm(d: BarDayEnd) {
    if (!confirm('Unconfirm this day end so it can be corrected?')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/unconfirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayEndId: d.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to unconfirm');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to unconfirm');
    } finally {
      setBusy(false);
    }
  }

  // ── Confirmed Day Ends: select / export / bank ───────────────────────────

  function toggleConfirmedSelected(id: string) {
    const next = new Set(selectedConfirmed);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedConfirmed(next);
  }

  function downloadCsv(csv: string, prefix: string) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}-${today()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportDayEndsToXero() {
    if (selectedConfirmed.size === 0) return;
    setExportingDayEnds(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dayEndIds: [...selectedConfirmed] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to export');
      downloadCsv(data.csv, 'bar-day-end-xero-export');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to export');
    } finally {
      setExportingDayEnds(false);
    }
  }

  const selectedUnbanked = [...selectedConfirmed].filter((id) => {
    const d = confirmed.find((c) => c.id === id);
    return d && d.bankingId === null;
  });

  async function createBanking() {
    if (selectedUnbanked.length === 0 || !bankedDate) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/banking', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankedDate, dayEndIds: selectedUnbanked, note: bankingNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create banking');
      setShowBankingModal(false); setBankingNote('');
      setSuccess(`Banking created: ${fmt(data.banking.totalPence)} (${selectedUnbanked.length} day end${selectedUnbanked.length === 1 ? '' : 's'}).`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to create banking');
    } finally {
      setBusy(false);
    }
  }

  // ── Bankings: expand / add / remove / export ─────────────────────────────

  async function fetchBankingDayEnds(id: string) {
    setBankingDayEnds(null);
    try {
      const res = await fetch(`/api/banking/bar-reconciliation/banking?bankingId=${id}`);
      const data = await res.json();
      if (res.ok) setBankingDayEnds(data.dayEnds);
    } catch {
      // ignore — the panel just stays empty
    }
  }

  function toggleExpandBanking(id: string) {
    if (expandedBankingId === id) { setExpandedBankingId(null); setBankingDayEnds(null); return; }
    setExpandedBankingId(id);
    fetchBankingDayEnds(id);
  }

  async function addToBanking(bankingId: string, dayEndId: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/banking/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankingId, dayEndId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add to banking');
      setAddToBankingId('');
      await load();
      await fetchBankingDayEnds(bankingId);
    } catch (err: any) {
      setError(err.message || 'Failed to add to banking');
    } finally {
      setBusy(false);
    }
  }

  async function removeFromBanking(bankingId: string, dayEndId: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/banking/remove', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankingId, dayEndId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove from banking');
      await load();
      await fetchBankingDayEnds(bankingId);
    } catch (err: any) {
      setError(err.message || 'Failed to remove from banking');
    } finally {
      setBusy(false);
    }
  }

  function toggleBankingSelected(id: string) {
    const next = new Set(selectedBankings);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedBankings(next);
  }

  async function exportBankingsToXero() {
    if (selectedBankings.size === 0) return;
    setExportingBankings(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bankingIds: [...selectedBankings] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to export');
      downloadCsv(data.csv, 'bar-banking-xero-export');
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to export');
    } finally {
      setExportingBankings(false);
    }
  }

  // ── Non-Till Cash (manual entry) ─────────────────────────────────────────

  async function submitManualEntry(countedBy: string, productId: string, amountPence: number, note: string) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/banking/bar-reconciliation/manual-entry', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countedBy, productId, amountPence, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record entry');
      setSuccess(`Recorded ${fmt(amountPence)}.`);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to record entry');
    } finally {
      setBusy(false);
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

  const confirmedVisible = showProcessed ? confirmed : confirmed.filter((d) => !(d.bankingId !== null && d.xeroExportedAt !== null));

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Bar Reconciliation</h1>
            <p className="text-sm text-gray-500">Confirm Day Ends, bundle cash into bankings, export to Xero</p>
          </div>
          <button
            onClick={() => { setShowManualEntry(true); loadMembersOnce(); }}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
          >
            + Non-Till Cash
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
            <button onClick={() => setError('')} className="float-right font-bold">×</button>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
            <button onClick={() => setSuccess('')} className="float-right font-bold">×</button>
          </div>
        )}

        {/* ── Needs Confirmation ─────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow overflow-hidden">
          <h2 className="px-4 pt-4 pb-2 font-semibold text-gray-900">Needs Confirmation</h2>
          {unconfirmed.length === 0 ? (
            <p className="p-4 pt-0 text-sm text-gray-500">Nothing awaiting confirmation.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-right">Cash expected</th>
                  <th className="px-3 py-2 text-right">Cash removed</th>
                  <th className="px-3 py-2 text-right">Carry fwd?</th>
                  <th className="px-3 py-2 text-left">Reason</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {unconfirmed.map((d) => (
                  <Fragment key={d.id}>
                    {editingId === d.id ? (
                      <tr className="border-t bg-amber-50">
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
                        <td className="px-3 py-2">{d.staff}</td>
                        <td className="px-3 py-2 text-right">{fmt(d.cashExpectedPence)}</td>
                        <td className="px-3 py-2 text-right">
                          <input value={editCashRemoved} onChange={(e) => setEditCashRemoved(e.target.value)} inputMode="decimal"
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-24 text-right" />
                        </td>
                        <td className="px-3 py-2 text-center">
                          <input type="checkbox" checked={editCarryForward} onChange={(e) => setEditCarryForward(e.target.checked)} />
                        </td>
                        <td className="px-3 py-2">
                          <input value={editReason} onChange={(e) => setEditReason(e.target.value)} placeholder="Reason"
                            className="border border-gray-300 rounded px-2 py-1 text-sm w-full" />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <button onClick={() => saveEdit(d)} disabled={busy} className="text-blue-600 font-medium mr-3 disabled:opacity-50">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-gray-500">Cancel</button>
                        </td>
                      </tr>
                    ) : (
                      <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(d.id)}>
                        <td className="px-3 py-2"></td>
                        <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
                        <td className="px-3 py-2">{d.staff}</td>
                        <td className="px-3 py-2 text-right">{fmt(d.cashExpectedPence)}</td>
                        <td className="px-3 py-2 text-right font-semibold">{fmt(d.cashRemovedPence)}</td>
                        <td className="px-3 py-2 text-center">{d.carriedForward ? fmt(d.carriedOutPence) : '-'}</td>
                        <td className="px-3 py-2 text-gray-600">{d.differenceReason || '-'}</td>
                        <td className="px-3 py-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => startEdit(d)} className="text-blue-600 font-medium mr-3">Edit</button>
                          <button onClick={() => doConfirm(d)} disabled={busy} className="text-green-700 font-medium disabled:opacity-50">Confirm</button>
                        </td>
                      </tr>
                    )}
                    {expandedId === d.id && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={8} className="px-6 py-4">
                          <DayEndDetail dayEnd={d} onDrill={(kind) => openDrill(d.id, kind)} activeDrillKind={drill && drill.dayEndId === d.id ? drill.kind : null} />
                          <DrillPanel drill={drill} dayEndId={d.id} loading={drillLoading} sales={drillSales} ledger={drillLedger} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Confirmed Day Ends ─────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow overflow-hidden">
          <div className="flex flex-wrap justify-between items-center gap-3 px-4 pt-4 pb-2">
            <h2 className="font-semibold text-gray-900">Confirmed Day Ends</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={showProcessed} onChange={(e) => setShowProcessed(e.target.checked)} />
                Show fully processed
              </label>
              <button
                onClick={() => setShowBankingModal(true)}
                disabled={selectedUnbanked.length === 0}
                className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                Create Banking ({selectedUnbanked.length})
              </button>
              <button
                onClick={exportDayEndsToXero}
                disabled={selectedConfirmed.size === 0 || exportingDayEnds}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {exportingDayEnds ? 'Exporting…' : `Export to Xero (${selectedConfirmed.size})`}
              </button>
            </div>
          </div>
          {confirmedVisible.length === 0 ? (
            <p className="p-4 pt-0 text-sm text-gray-500">Nothing to show.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Staff</th>
                  <th className="px-3 py-2 text-right">Cash removed</th>
                  <th className="px-3 py-2 text-right">Carried fwd</th>
                  <th className="px-3 py-2 text-left">Banked</th>
                  <th className="px-3 py-2 text-left">Exported</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {confirmedVisible.map((d) => (
                  <Fragment key={d.id}>
                    <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpand(d.id)}>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selectedConfirmed.has(d.id)} onChange={() => toggleConfirmedSelected(d.id)} />
                      </td>
                      <td className="px-3 py-2">{fmtDate(d.createdAt)}</td>
                      <td className="px-3 py-2">{d.staff}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(d.cashRemovedPence)}</td>
                      <td className="px-3 py-2 text-right">{d.carriedForward ? fmt(d.carriedOutPence) : '-'}</td>
                      <td className="px-3 py-2">
                        {d.bankingId ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">Banked</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Not banked</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {d.xeroExportedAt ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Exported</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                        )}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {!d.bankingId && !d.xeroExportedAt && (
                          <button onClick={() => doUnconfirm(d)} disabled={busy} className="text-gray-500 text-xs disabled:opacity-50">Unconfirm</button>
                        )}
                      </td>
                    </tr>
                    {expandedId === d.id && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={8} className="px-6 py-4">
                          <DayEndDetail dayEnd={d} onDrill={(kind) => openDrill(d.id, kind)} activeDrillKind={drill && drill.dayEndId === d.id ? drill.kind : null} />
                          <DrillPanel drill={drill} dayEndId={d.id} loading={drillLoading} sales={drillSales} ledger={drillLedger} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Bankings ───────────────────────────────────────────────────── */}
        <section className="bg-white rounded-lg shadow overflow-hidden">
          <div className="flex flex-wrap justify-between items-center gap-3 px-4 pt-4 pb-2">
            <h2 className="font-semibold text-gray-900">Bankings</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={showAllBankings} onChange={(e) => setShowAllBankings(e.target.checked)} />
                Show exported
              </label>
              <button
                onClick={exportBankingsToXero}
                disabled={selectedBankings.size === 0 || exportingBankings}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                {exportingBankings ? 'Exporting…' : `Export to Xero (${selectedBankings.size})`}
              </button>
            </div>
          </div>
          {bankings.length === 0 ? (
            <p className="p-4 pt-0 text-sm text-gray-500">
              {showAllBankings ? 'No bankings yet.' : 'Nothing to export — every banking has already been exported.'}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">Banked date</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">Banked by</th>
                  <th className="px-3 py-2 text-left">Note</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {bankings.map((b) => (
                  <Fragment key={b.id}>
                    <tr className="border-t hover:bg-gray-50 cursor-pointer" onClick={() => toggleExpandBanking(b.id)}>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {!b.xeroExportedAt && (
                          <input type="checkbox" checked={selectedBankings.has(b.id)} onChange={() => toggleBankingSelected(b.id)} />
                        )}
                      </td>
                      <td className="px-3 py-2">{b.bankedDate}</td>
                      <td className="px-3 py-2 text-right font-semibold">{fmt(b.totalPence)}</td>
                      <td className="px-3 py-2">{b.bankedBy}</td>
                      <td className="px-3 py-2 text-gray-600">{b.note || '-'}</td>
                      <td className="px-3 py-2">
                        {b.xeroExportedAt ? (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Exported</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Pending</span>
                        )}
                      </td>
                    </tr>
                    {expandedBankingId === b.id && (
                      <tr className="border-t bg-gray-50">
                        <td colSpan={6} className="px-6 py-4">
                          {bankingDayEnds === null ? (
                            <p className="text-sm text-gray-500">Loading…</p>
                          ) : (
                            <div className="space-y-2">
                              {bankingDayEnds.map((d) => (
                                <div key={d.id} className="flex justify-between items-center text-sm bg-white border border-gray-200 rounded px-3 py-2">
                                  <span>{fmtDate(d.createdAt)} — {d.staff}</span>
                                  <span className="flex items-center gap-3">
                                    <span className="font-medium">{fmt(d.cashRemovedPence)}</span>
                                    {!b.xeroExportedAt && (
                                      <button onClick={() => removeFromBanking(b.id, d.id)} disabled={busy} className="text-red-600 text-xs disabled:opacity-50">Remove</button>
                                    )}
                                  </span>
                                </div>
                              ))}
                              {!b.xeroExportedAt && (
                                <div className="flex items-center gap-2 pt-2">
                                  <select value={addToBankingId} onChange={(e) => setAddToBankingId(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm flex-1">
                                    <option value="">Add a confirmed, unbanked day end…</option>
                                    {confirmed.filter((d) => d.bankingId === null).map((d) => (
                                      <option key={d.id} value={d.id}>{fmtDate(d.createdAt)} — {d.staff} — {fmt(d.cashRemovedPence)}</option>
                                    ))}
                                  </select>
                                  <button
                                    onClick={() => { if (addToBankingId) addToBanking(b.id, addToBankingId); }}
                                    disabled={!addToBankingId || busy}
                                    className="px-3 py-1.5 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                                  >
                                    Add
                                  </button>
                                </div>
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
        </section>
      </main>

      {showBankingModal && (
        <CreateBankingModal
          count={selectedUnbanked.length}
          bankedDate={bankedDate}
          note={bankingNote}
          busy={busy}
          onDateChange={setBankedDate}
          onNoteChange={setBankingNote}
          onCancel={() => setShowBankingModal(false)}
          onConfirm={createBanking}
        />
      )}

      {showManualEntry && (
        <ManualEntryModal
          products={products}
          categories={categories}
          members={members}
          busy={busy}
          onClose={() => setShowManualEntry(false)}
          onSubmit={submitManualEntry}
        />
      )}
    </div>
  );
}

function DrillPanel({ drill, dayEndId, loading, sales, ledger }: { drill: { dayEndId: string; kind: DrillKind } | null; dayEndId: string; loading: boolean; sales: BarSaleSummary[] | null; ledger: BarDayEndLedgerRow[] | null }) {
  if (!drill || drill.dayEndId !== dayEndId) return null;
  return (
    <div className="mt-4 bg-white border border-gray-200 rounded-lg p-4">
      <h4 className="text-sm font-semibold text-gray-700 mb-2">{DRILL_LABELS[drill.kind]}</h4>
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      {!loading && sales && <SalesTable sales={sales} />}
      {!loading && ledger && <LedgerTable ledger={ledger} />}
      {!loading && !sales && !ledger && <p className="text-sm text-gray-500">No transactions.</p>}
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
        {dayEnd.cashMovementsPence !== 0 && row('Cash Movements', dayEnd.cashMovementsPence, 'cash_movements')}
        {row('Top-ups taken (cash in)', dayEnd.cashTopupsPence, 'cash_topups')}
        {row('Top-ups taken (by card)', dayEnd.cardTopupsPence, 'card_topups')}
        {row('Refunds paid (cash out)', dayEnd.refundsPence, 'refunds')}
      </div>
      <div>
        {row('Till float', dayEnd.floatPence)}
        {dayEnd.carriedInPence !== 0 && row('Brought forward from last cash-up', dayEnd.carriedInPence)}
        {row('Cash expected', dayEnd.cashExpectedPence)}
        {row('Cash removed', dayEnd.cashRemovedPence)}
        {dayEnd.carriedForward && row('Carried forward to next cash-up', dayEnd.carriedOutPence)}
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

function CreateBankingModal({ count, bankedDate, note, busy, onDateChange, onNoteChange, onCancel, onConfirm }: {
  count: number; bankedDate: string; note: string; busy: boolean;
  onDateChange: (v: string) => void; onNoteChange: (v: string) => void; onCancel: () => void; onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Create Banking</h3>
        <p className="text-sm text-gray-600 mb-4">Bundling {count} confirmed day end{count === 1 ? '' : 's'} into one paying-in-slip total.</p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Banked date</label>
            <input type="date" value={bankedDate} onChange={(e) => onDateChange(e.target.value)} className="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Note (optional)</label>
            <input type="text" value={note} onChange={(e) => onNoteChange(e.target.value)} placeholder="e.g. paying-in slip #1234" className="w-full border rounded px-3 py-2" />
          </div>
        </div>
        <div className="mt-6 flex justify-end space-x-3">
          <button onClick={onCancel} className="px-4 py-2 border rounded hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} disabled={busy || !bankedDate} className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50">
            {busy ? 'Saving…' : 'Create Banking'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ManualEntryModal({ products, categories, members, busy, onClose, onSubmit }: {
  products: BarProduct[]; categories: BarCategoryRow[]; members: MemberOption[]; busy: boolean;
  onClose: () => void; onSubmit: (countedBy: string, productId: string, amountPence: number, note: string) => void;
}) {
  const entryProducts = products.filter((p) => p.active && p.variablePrice);
  const entryCategories = categories.filter((c) => c.active && entryProducts.some((p) => p.category === c.key));
  const [category, setCategory] = useState(entryCategories.length > 0 ? entryCategories[0].key : '');
  const productsInCategory = entryProducts.filter((p) => p.category === category);
  const [productId, setProductId] = useState(productsInCategory.length > 0 ? productsInCategory[0].id : '');
  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    setProductId(productsInCategory.length > 0 ? productsInCategory[0].id : '');
  }

  const [memberSearch, setMemberSearch] = useState('');
  const [countedBy, setCountedBy] = useState('');
  const filteredMembers = memberSearch.trim() === '' ? [] : members
    .filter((m) => m.fullName.toLowerCase().includes(memberSearch.toLowerCase()))
    .slice(0, 8);

  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const pence = Math.round(parseFloat(amount || '0') * 100);
  const canSubmit = countedBy !== '' && productId !== '' && pence > 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 w-96">
        <h3 className="text-lg font-semibold mb-4 text-gray-900">Non-Till Cash</h3>
        {entryProducts.length === 0 ? (
          <p className="text-sm text-gray-600">
            No products set up for this yet. Add one on the till&apos;s Products screen using the Variable price option (e.g. Raffle, Teas).
          </p>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Who counted</label>
              <input
                value={memberSearch}
                onChange={(e) => { setMemberSearch(e.target.value); setCountedBy(''); }}
                placeholder="Search members…"
                className="w-full border rounded px-3 py-2"
              />
              {countedBy === '' && filteredMembers.length > 0 && (
                <div className="border border-gray-200 rounded mt-1 max-h-40 overflow-y-auto">
                  {filteredMembers.map((m) => (
                    <button key={m.userName} onClick={() => { setCountedBy(m.userName); setMemberSearch(m.fullName); }}
                      className="block w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50">
                      {m.fullName}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Product group</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border rounded px-3 py-2">
                {entryCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Product</label>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full border rounded px-3 py-2">
                {productsInCategory.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <div className="flex items-center gap-2">
                <span className="text-gray-600">£</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="border rounded px-3 py-2 w-32" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded px-3 py-2" />
            </div>
          </div>
        )}
        <div className="mt-6 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 border rounded hover:bg-gray-50">Close</button>
          {entryProducts.length > 0 && (
            <button
              onClick={() => { onSubmit(countedBy, productId, pence, note); setAmount(''); setNote(''); setCountedBy(''); setMemberSearch(''); }}
              disabled={busy || !canSubmit}
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Record & Add Another'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
