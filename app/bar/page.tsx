// app/bar/page.tsx
// The bar till (iPad, kiosk-style). Committee-gated device; per-sale attribution via
// the "Served by" chip (bar-duty members). Handles cash-member top-ups, wallet
// purchases, and visitor card/cash sales, plus an anytime report and product admin.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { isCommitteeMember } from '@/lib/role-utils';
import type { BarProduct, BarAccount, BarPerson, BarLedgerEntry, BarReport, BarSaleSummary } from '@/lib/bar-supabase';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'beer',    label: 'Beers / Lagers' },
  { key: 'wine',    label: 'Wines' },
  { key: 'spirit',  label: 'Spirits' },
  { key: 'zero_gf', label: '0% & Gluten Free' },
  { key: 'soft',    label: 'Soft Drinks / Splashes' },
  { key: 'snack',   label: 'Snacks' },
];
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;

type View = 'home' | 'member' | 'topup' | 'sale' | 'report' | 'products' | 'sales';
type SaleMode = 'wallet' | 'card' | 'cash';
interface BasketLine { product: BarProduct; qty: number }

export default function BarTillPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? '';
  const allowed = isCommitteeMember(role);

  const [view, setView] = useState<View>('home');
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [accounts, setAccounts] = useState<BarAccount[]>([]);
  const [barPersons, setBarPersons] = useState<BarPerson[]>([]);
  const [servedBy, setServedBy] = useState<string>('');   // username
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // selection / flow state
  const [member, setMember] = useState<BarAccount | null>(null);
  const [saleMode, setSaleMode] = useState<SaleMode>('wallet');
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [activeCat, setActiveCat] = useState<string>('beer');
  const [history, setHistory] = useState<BarLedgerEntry[] | null>(null);
  const [report, setReport] = useState<BarReport | null>(null);
  const [sales, setSales] = useState<BarSaleSummary[] | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');

  const servedByName = barPersons.find((b) => b.userName === servedBy)?.fullName ?? '';

  const load = useCallback(async () => {
    try {
      const [p, a, b] = await Promise.all([
        fetch('/api/bar/products?all=1').then((r) => r.json()),
        fetch('/api/bar/accounts').then((r) => r.json()),
        fetch('/api/bar/bar-persons').then((r) => r.json()),
      ]);
      if (p.products) setProducts(p.products);
      if (a.accounts) setAccounts(a.accounts);
      if (b.barPersons) setBarPersons(b.barPersons);
    } catch { setError('Failed to load bar data'); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => {
    const s = localStorage.getItem('bar_served_by');
    if (s) setServedBy(s);
  }, []);
  function chooseServedBy(u: string) { setServedBy(u); localStorage.setItem('bar_served_by', u); }

  // ── basket helpers ──────────────────────────────────────────────────────────
  const basketTotal = basket.reduce((s, l) => s + l.product.pricePence * l.qty, 0);
  function addToBasket(p: BarProduct) {
    setBasket((prev) => {
      const found = prev.find((l) => l.product.id === p.id);
      if (found) return prev.map((l) => (l.product.id === p.id ? { ...l, qty: l.qty + 1 } : l));
      return [...prev, { product: p, qty: 1 }];
    });
  }
  function changeQty(id: string, delta: number) {
    setBasket((prev) => prev
      .map((l) => (l.product.id === id ? { ...l, qty: l.qty + delta } : l))
      .filter((l) => l.qty > 0));
  }

  // ── actions ─────────────────────────────────────────────────────────────────
  function requireServer(): boolean {
    if (!servedBy) { setError('Select who is serving first (top of screen).'); return false; }
    setError(''); return true;
  }

  function startSale(mode: SaleMode, m: BarAccount | null) {
    if (!requireServer()) return;
    setSaleMode(mode); setMember(m); setBasket([]); setActiveCat('beer'); setView('sale');
  }

  async function completeSale() {
    if (basket.length === 0 || !requireServer()) return;
    setBusy(true); setError('');
    const items = basket.map((l) => ({ productId: l.product.id, qty: l.qty }));
    try {
      let res;
      if (saleMode === 'wallet') {
        res = await fetch('/api/bar/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: member!.userName, items, staff: servedBy }) });
      } else {
        res = await fetch('/api/bar/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: saleMode, items, staff: servedBy }) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sale failed');
      setBasket([]);
      await load();
      if (saleMode === 'wallet') {
        setMember((m) => (m ? { ...m, balancePence: data.balancePence } : m));
        setView('member');
      } else { setView('home'); }
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function doTopUp(amountPence: number) {
    if (!member || !requireServer()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence, staff: servedBy }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Top-up failed');
      setMember({ ...member, balancePence: data.balancePence });
      await load();
      setView('member');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function openMember(m: BarAccount) { setMember(m); setHistory(null); setView('member'); }
  async function loadHistory() {
    if (!member) return;
    const data = await fetch(`/api/bar/account?userName=${encodeURIComponent(member.userName)}`).then((r) => r.json());
    setHistory(data.account?.history ?? []);
  }
  async function loadReport() {
    const data = await fetch('/api/bar/report').then((r) => r.json());
    setReport(data.report ?? null); setView('report');
  }
  async function loadSales() {
    setView('sales'); setSales(null);
    const data = await fetch('/api/bar/sales?limit=40').then((r) => r.json());
    setSales(data.sales ?? []);
  }
  async function doVoid(saleId: string) {
    if (!requireServer()) return;
    if (!confirm('Void this sale? If it was charged to an account, the balance is refunded.')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/void', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, staff: servedBy }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Void failed');
      const s = await fetch('/api/bar/sales?limit=40').then((r) => r.json());
      setSales(s.sales ?? []);
      await load(); // balances may have changed
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  async function doRefund() {
    if (!member || !requireServer()) return;
    const pence = Math.round(parseFloat(refundAmt || '0') * 100);
    if (!Number.isFinite(pence) || pence <= 0 || pence > member.balancePence) {
      setError('Enter a refund amount up to the balance.'); return;
    }
    if (!confirm(`Refund ${fmt(pence)} cash to ${member.fullName}?`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence: pence, staff: servedBy }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refund failed');
      setMember({ ...member, balancePence: data.balancePence });
      setShowRefund(false); setRefundAmt('');
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  // ── guards ──────────────────────────────────────────────────────────────────
  if (status === 'loading') return null;
  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
        <div className="max-w-md mx-auto mt-24 text-center text-gray-600">The bar till is for committee/bar accounts only.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-5 max-w-4xl">

        {/* Served by chip + nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Served by:</span>
            <select
              value={servedBy}
              onChange={(e) => chooseServedBy(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm font-medium bg-white"
            >
              <option value="">— select —</option>
              {barPersons.map((b) => <option key={b.userName} value={b.userName}>{b.fullName}</option>)}
            </select>
          </div>
          <div className="flex gap-2">
            {view !== 'home' && (
              <button onClick={() => { setView('home'); setMember(null); setBasket([]); }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">← Home</button>
            )}
            <button onClick={loadSales} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Sales</button>
            <button onClick={loadReport} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Report</button>
            <button onClick={() => setView('products')} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Products</button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

        {/* ── HOME ─────────────────────────────────────────────────────────── */}
        {view === 'home' && (
          <>
            <div className="flex gap-3 mb-5">
              <button onClick={() => startSale('card', null)} className="flex-1 py-4 rounded-xl bg-blue-600 text-white font-semibold text-lg hover:bg-blue-700">Card sale</button>
              <button onClick={() => startSale('cash', null)} className="flex-1 py-4 rounded-xl bg-amber-600 text-white font-semibold text-lg hover:bg-amber-700">Cash sale</button>
            </div>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-gray-700">Cash members</h2>
              <AddCashMember existing={accounts} onAdded={load} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {accounts.map((a) => (
                <button key={a.userName} onClick={() => openMember(a)}
                  className="p-4 rounded-xl border border-gray-200 bg-white text-left hover:border-green-400 hover:shadow">
                  <div className="font-semibold text-gray-900 truncate">{a.fullName}</div>
                  <div className={`text-lg font-bold ${a.balancePence <= 200 ? 'text-red-600' : 'text-green-700'}`}>{fmt(a.balancePence)}</div>
                </button>
              ))}
              {accounts.length === 0 && <p className="text-gray-400 text-sm col-span-full py-6 text-center">No cash members yet — add one above.</p>}
            </div>
          </>
        )}

        {/* ── MEMBER ───────────────────────────────────────────────────────── */}
        {view === 'member' && member && (
          <div className="bg-white border border-gray-200 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="text-xl font-bold text-gray-900">{member.fullName}</div>
                <div className={`text-2xl font-bold ${member.balancePence <= 200 ? 'text-red-600' : 'text-green-700'}`}>{fmt(member.balancePence)}</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => setView('topup')} className="py-4 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">Top up</button>
              <button onClick={() => startSale('wallet', member)} className="py-4 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Purchase</button>
              <button onClick={loadHistory} className="py-4 rounded-lg border border-gray-300 font-semibold text-gray-700 hover:bg-gray-50">History</button>
            </div>

            {/* Refund cash from the wallet (committee) */}
            <div className="mt-3">
              {!showRefund ? (
                <button onClick={() => { setShowRefund(true); setRefundAmt(''); setError(''); }} className="text-sm text-red-600 font-medium">Refund cash…</button>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-600">£</span>
                  <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} inputMode="decimal" placeholder="0.00"
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24" />
                  <button onClick={doRefund} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50">
                    {busy ? 'Refunding…' : 'Refund cash'}
                  </button>
                  <button onClick={() => setShowRefund(false)} className="text-sm text-gray-500">Cancel</button>
                </div>
              )}
            </div>
            {history && (
              <div className="mt-5 border-t pt-4 max-h-72 overflow-y-auto">
                {history.length === 0 ? <p className="text-gray-400 text-sm">No history.</p> : history.map((h) => (
                  <div key={h.id} className="flex justify-between text-sm py-1 border-b border-gray-100">
                    <span className="text-gray-700">{new Date(h.createdAt).toLocaleDateString('en-GB')} · {h.type}</span>
                    <span className={h.amountPence < 0 ? 'text-gray-700' : 'text-green-700'}>{h.amountPence < 0 ? '−' : '+'}{fmt(Math.abs(h.amountPence))}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── TOP UP ───────────────────────────────────────────────────────── */}
        {view === 'topup' && member && <TopUp member={member} busy={busy} onConfirm={doTopUp} />}

        {/* ── SALE (product grid + basket) ─────────────────────────────────── */}
        {view === 'sale' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <div className="flex flex-wrap gap-2 mb-3">
                {CATEGORIES.map((c) => (
                  <button key={c.key} onClick={() => setActiveCat(c.key)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium ${activeCat === c.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>{c.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {products.filter((p) => p.active && p.category === activeCat).map((p) => (
                  <button key={p.id} onClick={() => addToBasket(p)}
                    className="p-3 rounded-lg border border-gray-200 bg-white text-left hover:border-blue-400">
                    <div className="font-medium text-gray-900 text-sm leading-tight">{p.name}</div>
                    <div className="text-gray-600 text-sm">{fmt(p.pricePence)}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
              <div className="text-sm font-semibold text-gray-700 mb-2">
                {saleMode === 'wallet' ? `Charge to ${member?.fullName}` : saleMode === 'card' ? 'Card sale' : 'Cash sale'}
              </div>
              {basket.length === 0 ? <p className="text-gray-400 text-sm py-4">Tap items to add.</p> : (
                <div className="space-y-2">
                  {basket.map((l) => (
                    <div key={l.product.id} className="flex items-center justify-between text-sm">
                      <span className="flex-1 truncate">{l.product.name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => changeQty(l.product.id, -1)} className="w-6 h-6 rounded bg-gray-100">−</button>
                        <span className="w-5 text-center">{l.qty}</span>
                        <button onClick={() => changeQty(l.product.id, 1)} className="w-6 h-6 rounded bg-gray-100">+</button>
                        <span className="w-14 text-right">{fmt(l.product.pricePence * l.qty)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between font-bold text-lg mt-3 pt-3 border-t">
                <span>Total</span><span>{fmt(basketTotal)}</span>
              </div>
              {saleMode === 'wallet' && member && (
                <div className={`text-sm mt-1 ${member.balancePence < basketTotal ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                  Balance {fmt(member.balancePence)}{member.balancePence < basketTotal ? ' — insufficient, top up first' : ''}
                </div>
              )}
              <button onClick={completeSale} disabled={busy || basket.length === 0 || (saleMode === 'wallet' && !!member && member.balancePence < basketTotal)}
                className="w-full mt-3 py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
                {busy ? 'Saving…' : saleMode === 'wallet' ? `Charge ${fmt(basketTotal)}` : `Take ${fmt(basketTotal)} — ${saleMode}`}
              </button>
            </div>
          </div>
        )}

        {/* ── REPORT ───────────────────────────────────────────────────────── */}
        {view === 'report' && report && <ReportView report={report} />}

        {/* ── SALES (void) ─────────────────────────────────────────────────── */}
        {view === 'sales' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-2xl">
            <h2 className="font-bold text-gray-900 mb-3">Recent sales</h2>
            {sales === null ? (
              <p className="text-gray-400 text-sm py-2">Loading…</p>
            ) : sales.length === 0 ? (
              <p className="text-gray-400 text-sm py-2">No sales yet.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {sales.map((s) => (
                  <div key={s.id} className={`flex items-center justify-between gap-3 py-2 ${s.voided ? 'opacity-40' : ''}`}>
                    <div className="min-w-0">
                      <div className="text-sm text-gray-900">
                        <span className="font-semibold">{fmt(s.totalPence)}</span> · {s.paymentMethod}{s.memberName ? ` · ${s.memberName}` : ' · visitor'}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {new Date(s.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {' · '}{s.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                      </div>
                    </div>
                    {s.voided ? (
                      <span className="text-xs text-red-600 font-medium shrink-0">Voided</span>
                    ) : (
                      <button onClick={() => doVoid(s.id)} disabled={busy}
                        className="shrink-0 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50">Void</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── PRODUCTS ─────────────────────────────────────────────────────── */}
        {view === 'products' && <ProductsAdmin products={products} onChanged={load} />}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function AddCashMember({ existing, onAdded }: { existing: BarAccount[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<{ userName: string; fullName: string }[]>([]);
  const [q, setQ] = useState('');
  const existingSet = new Set(existing.map((a) => a.userName.toLowerCase()));

  useEffect(() => {
    if (open && members.length === 0) {
      fetch('/api/members/lookup').then((r) => r.json()).then((d) => setMembers(d.members ?? []));
    }
  }, [open, members.length]);

  const matches = q.trim().length < 2 ? [] : members
    .filter((m) => !existingSet.has(m.userName.toLowerCase()) && m.fullName.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 8);

  async function add(userName: string) {
    await fetch('/api/bar/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userName }) });
    setQ(''); setOpen(false); onAdded();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-sm text-blue-600 font-medium">+ Add cash member</button>;
  return (
    <div className="relative">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Search member…" className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-56" />
      {matches.length > 0 && (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow z-10">
          {matches.map((m) => (
            <button key={m.userName} onMouseDown={() => add(m.userName)} className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50">{m.fullName}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function TopUp({ member, busy, onConfirm }: { member: BarAccount; busy: boolean; onConfirm: (pence: number) => void }) {
  const [amount, setAmount] = useState('');       // pounds as typed
  const pence = Math.round(parseFloat(amount || '0') * 100);
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  function press(k: string) {
    if (k === '⌫') setAmount((a) => a.slice(0, -1));
    else if (k === '.') { if (!amount.includes('.')) setAmount((a) => (a || '0') + '.'); }
    else setAmount((a) => (a === '0' ? k : a + k));
  }
  return (
    <div className="max-w-sm mx-auto bg-white border border-gray-200 rounded-xl p-5">
      <div className="text-center mb-1 text-gray-700">Top up <strong>{member.fullName}</strong></div>
      <div className="text-center text-4xl font-bold mb-4">£{amount || '0'}</div>
      <div className="flex gap-2 mb-3">
        {[10, 20].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="flex-1 py-2 rounded-lg bg-gray-100 font-medium">£{v}</button>)}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {keys.map((k) => <button key={k} onClick={() => press(k)} className="py-4 rounded-lg bg-gray-100 text-xl font-medium">{k}</button>)}
      </div>
      <button onClick={() => onConfirm(pence)} disabled={busy || pence <= 0}
        className="w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
        {busy ? 'Saving…' : `Add £${(pence / 100).toFixed(2)} (cash taken)`}
      </button>
    </div>
  );
}

function ReportView({ report }: { report: BarReport }) {
  const row = (label: string, pence: number, strong = false) => (
    <div className={`flex justify-between py-1 ${strong ? 'font-bold text-lg border-t mt-1 pt-2' : 'text-sm'}`}>
      <span>{label}</span><span>{fmt(pence)}</span>
    </div>
  );
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-lg">
      <h2 className="font-bold text-gray-900 mb-1">Today so far</h2>
      <p className="text-xs text-gray-500 mb-4">{report.salesCount} sales</p>
      {row('Wallet sales', report.byMethodPence.wallet)}
      {row('Card sales', report.byMethodPence.card)}
      {row('Cash sales (visitors)', report.byMethodPence.cash)}
      {row('Total sales', report.byMethodPence.wallet + report.byMethodPence.card + report.byMethodPence.cash, true)}
      <div className="mt-4">
        {row('Top-ups taken (cash in)', report.topupsPence)}
        {row('Refunds paid (cash out)', report.refundsPence)}
        {row('Expected cash in box', report.expectedCashPence, true)}
      </div>
      <div className="mt-4 pt-3 border-t">
        {row('Outstanding member balances (float owed)', report.outstandingPence)}
      </div>
      {report.byProduct.length > 0 && (
        <div className="mt-4 pt-3 border-t">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">By product</h3>
          {report.byProduct.map((p) => (
            <div key={p.name} className="flex justify-between text-sm py-0.5">
              <span>{p.name} ×{p.qty}</span><span>{fmt(p.totalPence)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductsAdmin({ products, onChanged }: { products: BarProduct[]; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('beer');
  const [price, setPrice] = useState('');
  async function add() {
    const pricePence = Math.round(parseFloat(price || '0') * 100);
    if (!name.trim() || pricePence <= 0) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, pricePence }) });
    setName(''); setPrice(''); onChanged();
  }
  async function toggle(p: BarProduct) {
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, setActive: !p.active }) });
    onChanged();
  }

  // Inline edit of an existing product (name / category / price)
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eCat, setECat] = useState('beer');
  const [ePrice, setEPrice] = useState('');
  function startEdit(p: BarProduct) {
    setEditId(p.id); setEName(p.name); setECat(p.category); setEPrice((p.pricePence / 100).toFixed(2));
  }
  async function saveEdit(p: BarProduct) {
    const pricePence = Math.round(parseFloat(ePrice || '0') * 100);
    if (!eName.trim() || pricePence <= 0) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, pricePence }) });
    setEditId(null); onChanged();
  }
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-2xl">
      <h2 className="font-bold text-gray-900 mb-3">Products</h2>
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[140px]" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
        <button onClick={add} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium">Add</button>
      </div>
      {CATEGORIES.map((c) => {
        const items = products.filter((p) => p.category === c.key);
        if (items.length === 0) return null;
        return (
          <div key={c.key} className="mb-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-1">{c.label}</h3>
            {items.map((p) => (
              editId === p.id ? (
                <div key={p.id} className="flex flex-wrap gap-2 items-center py-1.5 border-b border-gray-100">
                  <input value={eName} onChange={(e) => setEName(e.target.value)} className="border rounded px-2 py-1 text-sm flex-1 min-w-[140px]" />
                  <select value={eCat} onChange={(e) => setECat(e.target.value)} className="border rounded px-2 py-1 text-sm">
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  <input value={ePrice} onChange={(e) => setEPrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  <button onClick={() => saveEdit(p)} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium">Save</button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-500">Cancel</button>
                </div>
              ) : (
                <div key={p.id} className={`flex justify-between items-center text-sm py-1 ${p.active ? '' : 'opacity-40'}`}>
                  <span>{p.name} — {fmt(p.pricePence)}</span>
                  <span className="flex gap-3">
                    <button onClick={() => startEdit(p)} className="text-xs text-blue-600">Edit</button>
                    <button onClick={() => toggle(p)} className="text-xs text-gray-500">{p.active ? 'Deactivate' : 'Activate'}</button>
                  </span>
                </div>
              )
            ))}
          </div>
        );
      })}
    </div>
  );
}
