// app/bar/page.tsx
// The bar till (iPad, kiosk-style). Committee-gated device; per-sale attribution via
// the Bar Volunteer step (bar-duty members). Handles cash-member top-ups, wallet
// purchases, and visitor card/cash sales, plus an anytime report and product admin.
//
// Flow: pick a Bar Volunteer (buttons, persisted in localStorage and pre-highlighted
// across sessions, but always shown on entry rather than auto-skipped — an explicit
// tap is required even to reconfirm the same one, so the till never silently starts
// attributing sales to whoever last used it) -> pick who's buying, from every club
// member (not just existing cash-account holders) via a search box that filters the
// full list live, plus a "Non Member" option -> the product/basket screen, priced
// and actioned differently depending on who's buying:
//   - Member: Top Up / Pay by Account / History buttons. Selecting a member with no
//     bar_accounts row yet doesn't create one — bar_topup creates it silently on
//     their first top-up (see 0025_bar.sql); a Pay-by-Account attempt before that
//     correctly fails (no funds to charge against), same as an existing member with
//     an empty wallet.
//   - Non Member: Pay by Cash / Pay by Card buttons, priced at nonMemberPricePence.
// After any completed transaction, returns to the person picker for the next
// customer — the volunteer stays selected throughout a shift.

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
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

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;

type View = 'volunteer' | 'person' | 'sale' | 'topup' | 'report' | 'sales' | 'products';
interface BasketLine { product: BarProduct; qty: number }
interface MemberOption { userName: string; fullName: string }

export default function BarTillPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? '';
  const allowed = isCommitteeMember(role);

  // Always starts on the volunteer picker, even if one is already stored from a
  // previous session — see the header comment for why.
  const [view, setView] = useState<View>('volunteer');
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [accounts, setAccounts] = useState<BarAccount[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [barPersons, setBarPersons] = useState<BarPerson[]>([]);
  const [volunteer, setVolunteer] = useState<string>('');   // username of the bar person serving
  const [personSearch, setPersonSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // selection / flow state
  const [member, setMember] = useState<BarAccount | null>(null); // null + view 'sale' means non-member
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [activeCat, setActiveCat] = useState<string>('beer');
  const [history, setHistory] = useState<BarLedgerEntry[] | null>(null);
  const [report, setReport] = useState<BarReport | null>(null);
  const [sales, setSales] = useState<BarSaleSummary[] | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');

  const volunteerName = barPersons.find((b) => b.userName === volunteer)?.fullName ?? '';

  const load = useCallback(async () => {
    try {
      const [p, a, b, m] = await Promise.all([
        fetch('/api/bar/products?all=1').then((r) => r.json()),
        fetch('/api/bar/accounts').then((r) => r.json()),
        fetch('/api/bar/bar-persons').then((r) => r.json()),
        fetch('/api/members/lookup').then((r) => r.json()),
      ]);
      if (p.products) setProducts(p.products);
      if (a.accounts) setAccounts(a.accounts);
      if (b.barPersons) setBarPersons(b.barPersons);
      if (m.members) setAllMembers(m.members);
    } catch { setError('Failed to load bar data'); }
  }, []);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    // Pre-fills who to highlight on the volunteer picker — doesn't skip the picker itself.
    const s = localStorage.getItem('bar_served_by');
    if (s) setVolunteer(s);
  }, []);
  function chooseVolunteer(u: string) { setVolunteer(u); localStorage.setItem('bar_served_by', u); setView('person'); }

  // Returns to the till (person picker) for the next customer — the volunteer stays
  // selected. Use changeVolunteer() below, not this, to actually switch who's serving.
  function backToPersonPicker() {
    setView('person'); setMember(null); setBasket([]); setPersonSearch('');
    setHistory(null); setShowRefund(false); setRefundAmt('');
  }
  function changeVolunteer() { setView('volunteer'); }

  // ── basket / pricing helpers ─────────────────────────────────────────────────
  const unitPrice = (p: BarProduct) => (member ? p.pricePence : p.nonMemberPricePence);
  const basketTotal = basket.reduce((s, l) => s + unitPrice(l.product) * l.qty, 0);
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
  function requireVolunteer(): boolean {
    if (!volunteer) { setError('Select the bar volunteer first.'); return false; }
    setError(''); return true;
  }

  function selectMember(m: BarAccount) {
    if (!requireVolunteer()) return;
    setMember(m); setBasket([]); setActiveCat('beer'); setHistory(null); setShowRefund(false); setView('sale');
  }
  function selectNonMember() {
    if (!requireVolunteer()) return;
    setMember(null); setBasket([]); setActiveCat('beer'); setView('sale');
  }

  async function completeSale(mode: 'wallet' | 'card' | 'cash') {
    if (basket.length === 0 || !requireVolunteer()) return;
    setBusy(true); setError('');
    const items = basket.map((l) => ({ productId: l.product.id, qty: l.qty }));
    try {
      let res;
      if (mode === 'wallet') {
        if (!member) return;
        res = await fetch('/api/bar/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: member.userName, items, staff: volunteer }) });
      } else {
        res = await fetch('/api/bar/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: mode, items, staff: volunteer }) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sale failed');
      await load();
      backToPersonPicker();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function doTopUp(amountPence: number) {
    if (!member || !requireVolunteer()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence, staff: volunteer }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Top-up failed');
      // Back to the product list (not the person picker) with the fresh balance —
      // topping up is usually followed straight by a purchase for the same member,
      // and the basket (if anything was already tapped) stays intact.
      setMember((m) => (m ? { ...m, balancePence: data.balancePence } : m));
      await load();
      setView('sale');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function loadHistory() {
    if (!member) return;
    if (history) { setHistory(null); return; } // toggle closed
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
    if (!requireVolunteer()) return;
    if (!confirm('Void this sale? If it was charged to an account, the balance is refunded.')) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/void', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId, staff: volunteer }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Void failed');
      const s = await fetch('/api/bar/sales?limit=40').then((r) => r.json());
      setSales(s.sales ?? []);
      await load(); // balances may have changed
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  async function doRefund() {
    if (!member || !requireVolunteer()) return;
    const pence = Math.round(parseFloat(refundAmt || '0') * 100);
    if (!Number.isFinite(pence) || pence <= 0 || pence > member.balancePence) {
      setError('Enter a refund amount up to the balance.'); return;
    }
    if (!confirm(`Refund ${fmt(pence)} cash to ${member.fullName}?`)) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence: pence, staff: volunteer }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refund failed');
      setMember({ ...member, balancePence: data.balancePence });
      setShowRefund(false); setRefundAmt('');
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  // Every club member, merged with their real balance where one exists (0/no
  // account otherwise), filtered by the search box, and sorted so existing
  // cash members (lowest balance first, then name — a top-up reminder) come
  // before the much larger block of members who've never opened one (A-Z).
  const balanceByUser = new Map(accounts.map((a) => [a.userName.toLowerCase(), a.balancePence]));
  const q = personSearch.trim().toLowerCase();
  const sortedPeople = allMembers
    .filter((m) => !q || m.fullName.toLowerCase().includes(q))
    .map((m) => {
      const bal = balanceByUser.get(m.userName.toLowerCase());
      return { userName: m.userName, fullName: m.fullName, balancePence: bal ?? 0, hasAccount: bal !== undefined };
    })
    .sort((a, b) => {
      if (a.hasAccount !== b.hasAccount) return a.hasAccount ? -1 : 1;
      if (a.hasAccount) return a.balancePence - b.balancePence || a.fullName.localeCompare(b.fullName);
      return a.fullName.localeCompare(b.fullName);
    });

  // ── guards ──────────────────────────────────────────────────────────────────
  if (status === 'loading') return null;
  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto mt-24 text-center text-gray-600">The bar till is for committee/bar accounts only.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-5 max-w-4xl">

        {/* Header: volunteer chip + nav */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 text-sm">
            {volunteer ? (
              <>
                <span className="text-gray-600">Serving:</span>
                <span className="font-semibold text-gray-900">{volunteerName}</span>
                <button onClick={changeVolunteer} className="text-blue-600 hover:text-blue-800">Change</button>
              </>
            ) : (
              <span className="text-gray-500">Select the bar volunteer to begin</span>
            )}
          </div>
          <div className="flex gap-2">
            {view !== 'volunteer' && view !== 'person' && (
              <button onClick={backToPersonPicker}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">← Till</button>
            )}
            <button onClick={loadSales} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Sales</button>
            <button onClick={loadReport} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Report</button>
            <button onClick={() => setView('products')} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Products</button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

        {/* ── VOLUNTEER: always shown on entry, current one highlighted ──────── */}
        {view === 'volunteer' && (
          <div className="max-w-lg mx-auto">
            <h2 className="text-sm font-semibold text-gray-700 mb-3 text-center">Who's on the bar?</h2>
            <div className="grid grid-cols-2 gap-3">
              {barPersons.map((b) => (
                <button key={b.userName} onClick={() => chooseVolunteer(b.userName)}
                  className={`py-5 rounded-xl border-2 bg-white font-semibold text-gray-900 hover:border-blue-400 hover:shadow ${
                    b.userName === volunteer ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
                  }`}>
                  {b.fullName}
                </button>
              ))}
              {barPersons.length === 0 && <p className="text-gray-400 text-sm col-span-full text-center py-6">No bar volunteers set up yet.</p>}
            </div>
          </div>
        )}

        {/* ── PERSON: full member list, search-filterable, + Non Member ──────── */}
        {view === 'person' && (
          <>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Who's buying?</h2>
            <input
              value={personSearch}
              onChange={(e) => setPersonSearch(e.target.value)}
              placeholder="Search members…"
              className="w-full border border-gray-300 rounded-lg px-4 py-3 text-base mb-3"
            />
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <button onClick={selectNonMember}
                className="p-4 rounded-xl border-2 border-dashed border-gray-300 bg-white text-left hover:border-amber-400 hover:shadow">
                <div className="font-semibold text-gray-900">Non Member</div>
                <div className="text-sm text-gray-500">Cash or card</div>
              </button>
              {sortedPeople.map((m) => (
                <button key={m.userName} onClick={() => selectMember(m)}
                  className="p-4 rounded-xl border border-gray-200 bg-white text-left hover:border-green-400 hover:shadow">
                  <div className="font-semibold text-gray-900 truncate">{m.fullName}</div>
                  <div className={`text-lg font-bold ${!m.hasAccount ? 'text-gray-400' : m.balancePence <= 200 ? 'text-red-600' : 'text-green-700'}`}>
                    {m.hasAccount ? fmt(m.balancePence) : 'No account yet'}
                  </div>
                </button>
              ))}
              {sortedPeople.length === 0 && <p className="text-gray-400 text-sm col-span-full py-6 text-center">No members match "{personSearch}".</p>}
            </div>
          </>
        )}

        {/* ── SALE (product grid + basket, priced/actioned per buyer) ─────────── */}
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
                    <div className="text-gray-600 text-sm">{fmt(unitPrice(p))}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
              <div className="text-sm font-semibold text-gray-700 mb-2">
                {member ? `Charge to ${member.fullName}` : 'Non-member sale'}
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
                        <span className="w-14 text-right">{fmt(unitPrice(l.product) * l.qty)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between font-bold text-lg mt-3 pt-3 border-t">
                <span>Total</span><span>{fmt(basketTotal)}</span>
              </div>
              {member && (
                <div className={`text-sm mt-1 ${member.balancePence < basketTotal ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                  Balance {fmt(member.balancePence)}{member.balancePence < basketTotal ? ' — insufficient, top up first' : ''}
                </div>
              )}

              {/* Action buttons — differ for a member vs a non-member */}
              {member ? (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => setView('topup')} disabled={busy}
                    className="py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50">Top Up</button>
                  <button onClick={() => completeSale('wallet')} disabled={busy || basket.length === 0 || member.balancePence < basketTotal}
                    className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
                    {busy ? 'Saving…' : `Pay by Account`}
                  </button>
                  <button onClick={loadHistory} className="py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    {history ? 'Hide History' : 'History'}
                  </button>
                  {!showRefund ? (
                    <button onClick={() => { setShowRefund(true); setRefundAmt(''); setError(''); }} className="py-2 text-sm text-red-600 font-medium">Refund cash…</button>
                  ) : (
                    <div className="col-span-2 flex items-center gap-2 flex-wrap pt-1">
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
              ) : (
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <button onClick={() => completeSale('cash')} disabled={busy || basket.length === 0}
                    className="py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50">
                    {busy ? 'Saving…' : `Pay by Cash`}
                  </button>
                  <button onClick={() => completeSale('card')} disabled={busy || basket.length === 0}
                    className="py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {busy ? 'Saving…' : `Pay by Card`}
                  </button>
                </div>
              )}

              {member && history && (
                <div className="mt-4 border-t pt-3 max-h-72 overflow-y-auto">
                  {history.length === 0 ? <p className="text-gray-400 text-sm">No history.</p> : history.map((h) => (
                    <div key={h.id} className="flex justify-between text-sm py-1 border-b border-gray-100">
                      <span className="text-gray-700">{new Date(h.createdAt).toLocaleDateString('en-GB')} · {h.type}</span>
                      <span className={h.amountPence < 0 ? 'text-gray-700' : 'text-green-700'}>{h.amountPence < 0 ? '−' : '+'}{fmt(Math.abs(h.amountPence))}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── TOP UP ───────────────────────────────────────────────────────── */}
        {view === 'topup' && member && <TopUp member={member} busy={busy} onConfirm={doTopUp} />}

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
  const [nonMemberPrice, setNonMemberPrice] = useState('');
  // Keep the non-member price 10p above whatever's typed in the member price,
  // until the admin edits it directly — a starting suggestion, not enforced.
  function onPriceChange(v: string) {
    setPrice(v);
    const p = parseFloat(v);
    if (Number.isFinite(p)) setNonMemberPrice((p + 0.10).toFixed(2));
  }
  async function add() {
    const pricePence = Math.round(parseFloat(price || '0') * 100);
    const nonMemberPricePence = Math.round(parseFloat(nonMemberPrice || '0') * 100);
    if (!name.trim() || pricePence <= 0 || nonMemberPricePence <= 0) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, pricePence, nonMemberPricePence }) });
    setName(''); setPrice(''); setNonMemberPrice(''); onChanged();
  }
  async function toggle(p: BarProduct) {
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, setActive: !p.active }) });
    onChanged();
  }

  // Inline edit of an existing product (name / category / prices)
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eCat, setECat] = useState('beer');
  const [ePrice, setEPrice] = useState('');
  const [eNonMemberPrice, setENonMemberPrice] = useState('');
  function startEdit(p: BarProduct) {
    setEditId(p.id); setEName(p.name); setECat(p.category);
    setEPrice((p.pricePence / 100).toFixed(2)); setENonMemberPrice((p.nonMemberPricePence / 100).toFixed(2));
  }
  async function saveEdit(p: BarProduct) {
    const pricePence = Math.round(parseFloat(ePrice || '0') * 100);
    const nonMemberPricePence = Math.round(parseFloat(eNonMemberPrice || '0') * 100);
    if (!eName.trim() || pricePence <= 0 || nonMemberPricePence <= 0) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, pricePence, nonMemberPricePence }) });
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
        <div>
          <label className="block text-[10px] text-gray-500">Member £</label>
          <input value={price} onChange={(e) => onPriceChange(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500">Non-member £</label>
          <input value={nonMemberPrice} onChange={(e) => setNonMemberPrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
        </div>
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
                  <input value={ePrice} onChange={(e) => setEPrice(e.target.value)} placeholder="Member £" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  <input value={eNonMemberPrice} onChange={(e) => setENonMemberPrice(e.target.value)} placeholder="Non-member £" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  <button onClick={() => saveEdit(p)} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium">Save</button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-500">Cancel</button>
                </div>
              ) : (
                <div key={p.id} className={`flex justify-between items-center text-sm py-1 ${p.active ? '' : 'opacity-40'}`}>
                  <span>{p.name} — {fmt(p.pricePence)} <span className="text-gray-400">/ {fmt(p.nonMemberPricePence)} non-member</span></span>
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
