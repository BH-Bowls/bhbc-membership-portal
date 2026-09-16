// app/bar/page.tsx
// The bar till (iPad, kiosk-style). Committee-gated device; per-sale attribution via
// whoever's marked as serving. Handles cash-member top-ups, wallet purchases, and
// visitor card/cash sales, plus an anytime report and product admin.
//
// Flow: person picker (every club member, not just existing cash-account holders,
// via a live-filtering search box, plus a Cash/Card option for non-members) -> the
// product/basket screen, priced and actioned differently depending on who's buying:
//   - Member: Top Up / Pay by Account / Pay by Card / History buttons. Selecting a
//     member with no bar_accounts row yet doesn't create one — bar_topup creates it
//     silently on their first top-up (see 0025_bar.sql); a Pay-by-Account attempt
//     before that correctly fails (no funds to charge against), same as an existing
//     member with an empty wallet.
//   - Cash/Card (non-member): Pay by Cash / Pay by Card, priced at basePricePence.
// "Who's serving" is no longer a blocking gate — it's only asked for when opening a
// Cash/Card tab or a Top Up (see chooseVolunteer/pendingAction), since a Cash/Card
// tab is held/resumed by staff name rather than by a member. A basket left via
// "← Till" is parked in heldOrders and resumed if that same member/tab is reopened.

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import jsQR from 'jsqr';
import { isCommitteeMember } from '@/lib/role-utils';
import { memberPricePence, type BarProduct, type BarAccount, type BarPerson, type BarLedgerEntry, type BarReport, type BarSaleSummary, type BarSaleItem } from '@/lib/bar-supabase';

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'beer',    label: 'Beers / Lagers' },
  { key: 'wine',    label: 'Wines' },
  { key: 'spirit',  label: 'Spirits' },
  { key: 'zero_gf', label: '0% & Gluten Free' },
  { key: 'soft',    label: 'Soft Drinks / Splashes' },
  { key: 'snack',   label: 'Snacks' },
];

// Per-category colour so the product grid and category pills read at a glance
// instead of every tile being the same white/grey box.
const CATEGORY_COLORS: Record<string, { active: string; inactive: string; tile: string }> = {
  beer:    { active: 'bg-amber-500 text-white',    inactive: 'bg-amber-50 text-amber-800 hover:bg-amber-100',     tile: 'border-l-4 border-l-amber-400' },
  wine:    { active: 'bg-rose-500 text-white',     inactive: 'bg-rose-50 text-rose-800 hover:bg-rose-100',        tile: 'border-l-4 border-l-rose-400' },
  spirit:  { active: 'bg-purple-500 text-white',   inactive: 'bg-purple-50 text-purple-800 hover:bg-purple-100',  tile: 'border-l-4 border-l-purple-400' },
  zero_gf: { active: 'bg-teal-500 text-white',     inactive: 'bg-teal-50 text-teal-800 hover:bg-teal-100',        tile: 'border-l-4 border-l-teal-400' },
  soft:    { active: 'bg-sky-500 text-white',      inactive: 'bg-sky-50 text-sky-800 hover:bg-sky-100',           tile: 'border-l-4 border-l-sky-400' },
  snack:   { active: 'bg-orange-500 text-white',   inactive: 'bg-orange-50 text-orange-800 hover:bg-orange-100',  tile: 'border-l-4 border-l-orange-400' },
};

// Rotating border colours for the volunteer picker — just visual variety, no meaning per colour.
const ACCENT_BORDERS = [
  'border-blue-300 hover:border-blue-500',
  'border-emerald-300 hover:border-emerald-500',
  'border-amber-300 hover:border-amber-500',
  'border-pink-300 hover:border-pink-500',
  'border-purple-300 hover:border-purple-500',
  'border-cyan-300 hover:border-cyan-500',
  'border-rose-300 hover:border-rose-500',
  'border-lime-400 hover:border-lime-600',
];

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;

type View = 'volunteer' | 'person' | 'sale' | 'topup' | 'report' | 'sales' | 'products';
interface BasketLine { product: BarProduct; qty: number }
interface MemberOption { userName: string; fullName: string }

export default function BarTillPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? '';
  const allowed = isCommitteeMember(role);

  // Starts straight on the person picker — "who's serving" is no longer a
  // mandatory front gate, only asked for contextually (see chooseVolunteer).
  const [view, setView] = useState<View>('person');
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [accounts, setAccounts] = useState<BarAccount[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [barPersons, setBarPersons] = useState<BarPerson[]>([]);
  const [volunteer, setVolunteer] = useState<string>('');   // username of the bar person serving
  // What to do once a name is tapped on the volunteer picker — set when it's opened
  // to identify a Cash/Card tab or to attribute a Top Up, rather than just to change
  // who's marked as serving (the plain 'Change' link leaves this null).
  const [pendingAction, setPendingAction] = useState<'cashcard' | 'topup' | null>(null);
  const [personSearch, setPersonSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // selection / flow state
  const [member, setMember] = useState<BarAccount | null>(null); // null + view 'sale' means non-member
  const [basket, setBasket] = useState<BasketLine[]>([]);
  // Orders parked mid-basket so a bar person can serve someone else and come back —
  // keyed by `member:<userName>` for a member's basket, or `staff:<userName>` for a
  // non-member (Cash/Card) tab, since a non-member sale has no member to key off.
  const [heldOrders, setHeldOrders] = useState<Map<string, BasketLine[]>>(new Map());
  const [activeCat, setActiveCat] = useState<string>('beer');
  const [history, setHistory] = useState<BarLedgerEntry[] | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [historyItemsBySale, setHistoryItemsBySale] = useState<Record<string, BarSaleItem[]>>({});
  const [report, setReport] = useState<BarReport | null>(null);
  const [sales, setSales] = useState<BarSaleSummary[] | null>(null);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
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
  // Key for parking/resuming the basket currently on screen — null if there's
  // nothing to park it under (no member and no one marked as serving yet).
  function currentOrderKey(): string | null {
    if (member) return `member:${member.userName}`;
    if (volunteer) return `staff:${volunteer}`;
    return null;
  }
  function holdCurrentOrder() {
    if (basket.length === 0) return;
    const key = currentOrderKey();
    if (!key) return;
    setHeldOrders((prev) => { const next = new Map(prev); next.set(key, basket); return next; });
  }
  function clearHeldOrder(key: string | null) {
    if (!key) return;
    setHeldOrders((prev) => { if (!prev.has(key)) return prev; const next = new Map(prev); next.delete(key); return next; });
  }

  // Tapping a name always sets who's serving, then either resumes/starts whatever
  // it was opened for (a Cash/Card tab or a Top Up) or, from the plain 'Change'
  // link (no pendingAction), just returns to the till.
  function chooseVolunteer(u: string) {
    setVolunteer(u); localStorage.setItem('bar_served_by', u);
    if (pendingAction === 'cashcard') {
      setPendingAction(null);
      setMember(null); setBasket(heldOrders.get(`staff:${u}`) ?? []); setActiveCat('beer'); setView('sale');
    } else if (pendingAction === 'topup') {
      setPendingAction(null);
      setView('topup');
    } else {
      setView('person');
    }
  }

  // Returns to the till (person picker) for the next customer, parking whatever
  // basket is on screen so it can be resumed later. The volunteer stays selected —
  // use changeVolunteer() below, not this, to actually switch who's serving.
  // skipHold is set by completeSale, which has already cleared/emptied the basket
  // itself after a successful sale — without it, this would re-park the very
  // basket that was just paid for (a stale closure would still see it as full).
  function backToPersonPicker(skipHold = false) {
    if (!skipHold) holdCurrentOrder();
    setView('person'); setMember(null); setBasket([]); setPersonSearch('');
    setHistory(null); setExpandedHistoryId(null); setShowRefund(false); setRefundAmt('');
  }
  function changeVolunteer() { setPendingAction(null); setView('volunteer'); }

  // ── basket / pricing helpers ─────────────────────────────────────────────────
  const unitPrice = (p: BarProduct) => (member ? memberPricePence(p) : p.basePricePence);
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
  // Still used by doVoid/doRefund below — those reversal actions keep the hard
  // requirement. Ordinary sales no longer do (see selectMember/openCashCardTab).
  function requireVolunteer(): boolean {
    if (!volunteer) { setError('Select the bar volunteer first.'); return false; }
    setError(''); return true;
  }

  // No staff prompt for a wallet sale — resumes that member's held order if any.
  function selectMember(m: BarAccount) {
    setMember(m); setBasket(heldOrders.get(`member:${m.userName}`) ?? []); setActiveCat('beer');
    setHistory(null); setExpandedHistoryId(null); setShowRefund(false); setView('sale');
  }
  // Cash/Card always asks who's serving — that's also the key for which held tab
  // to resume (see chooseVolunteer's 'cashcard' branch).
  function openCashCardTab() {
    setPendingAction('cashcard');
    setView('volunteer');
  }

  async function completeSale(mode: 'wallet' | 'card' | 'cash') {
    if (basket.length === 0) return;
    setBusy(true); setError('');
    const items = basket.map((l) => ({ productId: l.product.id, qty: l.qty }));
    try {
      let res;
      if (mode === 'wallet') {
        if (!member) return;
        res = await fetch('/api/bar/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: member.userName, items, staff: volunteer }) });
      } else {
        // member is only ever set here for "Pay by Card" — attributes the sale to
        // them (member pricing, history) without touching their wallet.
        res = await fetch('/api/bar/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: mode, items, staff: volunteer, userName: member?.userName }) });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sale failed');
      clearHeldOrder(currentOrderKey());
      setBasket([]);
      await load();
      backToPersonPicker(true);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  // Opens Top Up for the current member, asking who's serving first if no one's
  // marked yet (an already-known volunteer is reused without re-asking).
  function openTopUp() {
    if (!volunteer) { setPendingAction('topup'); setView('volunteer'); return; }
    setView('topup');
  }

  async function doTopUp(amountPence: number, paymentMethod: 'cash' | 'card') {
    if (!member || !requireVolunteer()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence, staff: volunteer, paymentMethod }) });
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
    if (history) { setHistory(null); setExpandedHistoryId(null); return; } // toggle closed
    const data = await fetch(`/api/bar/account?userName=${encodeURIComponent(member.userName)}`).then((r) => r.json());
    setHistory(data.account?.history ?? []);
  }

  // Expand a purchase entry to show its line items, fetching once per sale (cached
  // in historyItemsBySale) — top-ups/refunds/adjustments have no items to show.
  async function toggleHistoryItem(h: BarLedgerEntry) {
    if (!h.saleId) return;
    if (expandedHistoryId === h.id) { setExpandedHistoryId(null); return; }
    setExpandedHistoryId(h.id);
    if (!historyItemsBySale[h.saleId]) {
      const data = await fetch(`/api/bar/sale/${h.saleId}/items`).then((r) => r.json());
      setHistoryItemsBySale((prev) => ({ ...prev, [h.saleId as string]: data.items ?? [] }));
    }
  }
  async function loadReport() {
    const data = await fetch('/api/bar/report').then((r) => r.json());
    setReport(data.report ?? null); setView('report');
  }
  async function loadSales() {
    setView('sales'); setSales(null); setExpandedSaleId(null);
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

  // A scanned QR just carries the member's userName (same trust level as picking
  // them from the list — selecting a member here has never required proof of
  // identity, so this introduces no new risk).
  function handleScan(value: string) {
    setShowScanner(false);
    const found = sortedPeople.find((m) => m.userName === value.trim());
    if (found) selectMember(found);
    else setError('QR code did not match a member.');
  }

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
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-5 max-w-7xl">

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
              <button onClick={changeVolunteer} className="text-gray-500 hover:text-gray-700">No one marked as serving</button>
            )}
          </div>
          <div className="flex gap-2">
            {view !== 'volunteer' && view !== 'person' && (
              <button onClick={() => backToPersonPicker()}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">← Till</button>
            )}
            <button onClick={loadSales} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Sales</button>
            <button onClick={loadReport} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Report</button>
            <button onClick={() => setView('products')} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Products</button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

        {/* ── VOLUNTEER: opened via 'Change', a Cash/Card tab, or Top Up ──────── */}
        {view === 'volunteer' && (
          <div className="max-w-5xl mx-auto">
            <h2 className="text-base font-semibold text-gray-700 mb-4 text-center">Who's serving?</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {barPersons.map((b, i) => (
                <button key={b.userName} onClick={() => chooseVolunteer(b.userName)}
                  className={`relative py-8 rounded-xl border-2 bg-white font-semibold text-lg text-gray-900 hover:shadow-md transition-colors ${
                    b.userName === volunteer ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50' : ACCENT_BORDERS[i % ACCENT_BORDERS.length]
                  }`}>
                  {pendingAction === 'cashcard' && heldOrders.has(`staff:${b.userName}`) && (
                    <span title="Tab waiting" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-amber-400" />
                  )}
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
            <div className="flex gap-2 mb-3">
              <input
                value={personSearch}
                onChange={(e) => setPersonSearch(e.target.value)}
                placeholder="Search members…"
                className="flex-1 border border-gray-300 rounded-lg px-4 py-3 text-base"
              />
              <button onClick={() => setShowScanner(true)}
                className="px-4 py-3 rounded-lg border-2 border-blue-300 bg-blue-50 text-blue-800 font-medium hover:bg-blue-100">
                Scan
              </button>
            </div>
            {showScanner && <QrScanModal onScan={handleScan} onClose={() => setShowScanner(false)} />}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              <button onClick={openCashCardTab}
                className="p-4 rounded-xl border-2 border-amber-300 bg-amber-50 text-left hover:border-amber-500 hover:shadow-md transition-colors">
                <div className="font-semibold text-amber-900">Cash / Card</div>
                <div className="text-sm text-amber-700">No member account</div>
              </button>
              {sortedPeople.map((m) => (
                <button key={m.userName} onClick={() => selectMember(m)}
                  className={`relative p-4 rounded-xl border border-gray-200 ${
                    !m.hasAccount ? 'border-l-4 border-l-gray-300' : m.balancePence <= 200 ? 'border-l-4 border-l-red-400' : 'border-l-4 border-l-green-400'
                  } bg-white text-left hover:border-green-400 hover:shadow-md transition-colors`}>
                  {heldOrders.has(`member:${m.userName}`) && (
                    <span title="Order waiting" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-amber-400" />
                  )}
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
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activeCat === c.key ? CATEGORY_COLORS[c.key].active : CATEGORY_COLORS[c.key].inactive
                    }`}>{c.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {products.filter((p) => p.active && p.category === activeCat).map((p) => (
                  <button key={p.id} onClick={() => addToBasket(p)}
                    className={`p-3 rounded-lg border border-gray-200 ${CATEGORY_COLORS[p.category]?.tile ?? ''} bg-white text-left hover:border-blue-400 hover:shadow-sm transition-colors`}>
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
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <button onClick={openTopUp} disabled={busy}
                    className="py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 text-sm">Top Up</button>
                  <button onClick={() => completeSale('wallet')} disabled={busy || basket.length === 0 || member.balancePence < basketTotal}
                    className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 text-sm">
                    {busy ? 'Saving…' : `Pay by Account`}
                  </button>
                  <button onClick={() => completeSale('card')} disabled={busy || basket.length === 0}
                    className="py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 text-sm">
                    {busy ? 'Saving…' : `Pay by Card`}
                  </button>
                  <button onClick={loadHistory} className="py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50">
                    {history ? 'Hide History' : 'History'}
                  </button>
                  {!showRefund ? (
                    <button onClick={() => { setShowRefund(true); setRefundAmt(''); setError(''); }} className="col-span-2 py-2 text-sm text-red-600 font-medium">Refund cash…</button>
                  ) : (
                    <div className="col-span-3 flex items-center gap-2 flex-wrap pt-1">
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
                  {history.length === 0 ? <p className="text-gray-400 text-sm">No history.</p> : history.map((h) => {
                    const expandable = h.type === 'purchase' && !!h.saleId;
                    const items = h.saleId ? historyItemsBySale[h.saleId] : undefined;
                    return (
                      <div key={h.id} className="border-b border-gray-100">
                        <div
                          className={`flex justify-between text-sm py-1 ${expandable ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                          onClick={expandable ? () => toggleHistoryItem(h) : undefined}
                        >
                          <span className="text-gray-700">
                            {expandable && <span className="text-gray-400 mr-1">{expandedHistoryId === h.id ? '▾' : '▸'}</span>}
                            {new Date(h.createdAt).toLocaleDateString('en-GB')} · {h.type}
                          </span>
                          <span className={h.amountPence < 0 ? 'text-gray-700' : 'text-green-700'}>{h.amountPence < 0 ? '−' : '+'}{fmt(Math.abs(h.amountPence))}</span>
                        </div>
                        {expandable && expandedHistoryId === h.id && (
                          <div className="pl-4 pb-2 space-y-0.5">
                            {items === undefined ? (
                              <p className="text-xs text-gray-400">Loading…</p>
                            ) : items.length === 0 ? (
                              <p className="text-xs text-gray-400">No items recorded.</p>
                            ) : items.map((it, idx) => (
                              <div key={idx} className="flex justify-between text-xs text-gray-600">
                                <span>{it.qty}× {it.name}</span>
                                <span>{fmt(it.unitPricePence * it.qty)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
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
                {sales.map((s) => {
                  const expanded = expandedSaleId === s.id;
                  return (
                    <div key={s.id} className={s.voided ? 'opacity-40' : ''}>
                      <div className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0 cursor-pointer" onClick={() => setExpandedSaleId(expanded ? null : s.id)}>
                          <div className="text-sm text-gray-900">
                            <span className="text-gray-400 mr-1">{expanded ? '▾' : '▸'}</span>
                            <span className="font-semibold">{fmt(s.totalPence)}</span> · {s.paymentMethod}{s.memberName ? ` · ${s.memberName}` : ' · visitor'}
                            <span className="text-gray-400"> · {s.items.length} item{s.items.length === 1 ? '' : 's'}</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(s.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                        {s.voided ? (
                          <span className="text-xs text-red-600 font-medium shrink-0">Voided</span>
                        ) : (
                          <button onClick={() => doVoid(s.id)} disabled={busy}
                            className="shrink-0 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50">Void</button>
                        )}
                      </div>
                      {expanded && (
                        <div className="pl-4 pb-2 space-y-0.5">
                          {s.items.length === 0 ? (
                            <p className="text-xs text-gray-400">No items recorded.</p>
                          ) : s.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between text-xs text-gray-600">
                              <span>{it.qty}× {it.name} @ {fmt(it.unitPricePence)}</span>
                              <span>{fmt(it.unitPricePence * it.qty)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
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

// Camera modal for scanning a member's QR (their userName, shown to them on
// /profile). Decodes with jsQR against captured video frames rather than the
// native BarcodeDetector API, which isn't available on iPad Safari.
function QrScanModal({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [scanError, setScanError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let rafId = 0;
    let stopped = false;

    function tick() {
      if (stopped) return;
      const video = videoRef.current, canvas = canvasRef.current;
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code?.data) { onScan(code.data); return; }
        }
      }
      rafId = requestAnimationFrame(tick);
    }

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        tick();
      } catch {
        setScanError('Camera unavailable — check permissions.');
      }
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onScan]);

  return (
    <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-4 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-2">
          <h3 className="font-semibold text-gray-900">Scan member QR</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        <div className="relative aspect-square rounded-lg overflow-hidden bg-black">
          <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        </div>
        <canvas ref={canvasRef} className="hidden" />
        {scanError && <p className="text-sm text-red-600 mt-2">{scanError}</p>}
      </div>
    </div>
  );
}

function TopUp({ member, busy, onConfirm }: { member: BarAccount; busy: boolean; onConfirm: (pence: number, paymentMethod: 'cash' | 'card') => void }) {
  const [amount, setAmount] = useState('');       // pounds as typed
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
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
        <button onClick={() => setPaymentMethod('cash')}
          className={`flex-1 py-2 rounded-lg font-medium ${paymentMethod === 'cash' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700'}`}>Cash</button>
        <button onClick={() => setPaymentMethod('card')}
          className={`flex-1 py-2 rounded-lg font-medium ${paymentMethod === 'card' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}>Card</button>
      </div>
      <div className="flex gap-2 mb-3">
        {[10, 20].map((v) => <button key={v} onClick={() => setAmount(String(v))} className="flex-1 py-2 rounded-lg bg-gray-100 font-medium">£{v}</button>)}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {keys.map((k) => <button key={k} onClick={() => press(k)} className="py-4 rounded-lg bg-gray-100 text-xl font-medium">{k}</button>)}
      </div>
      <button onClick={() => onConfirm(pence, paymentMethod)} disabled={busy || pence <= 0}
        className="w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
        {busy ? 'Saving…' : `Add £${(pence / 100).toFixed(2)} (${paymentMethod === 'cash' ? 'cash taken' : 'by card'})`}
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
        {row('Top-ups taken (by card)', report.cardTopupsPence)}
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
  const [basePrice, setBasePrice] = useState('');
  const [discount, setDiscount] = useState('10');
  async function add() {
    const basePricePence = Math.round(parseFloat(basePrice || '0') * 100);
    const memberDiscountPercent = Math.round(parseFloat(discount || '0'));
    if (!name.trim() || basePricePence <= 0 || memberDiscountPercent < 0 || memberDiscountPercent > 100) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, basePricePence, memberDiscountPercent }) });
    setName(''); setBasePrice(''); setDiscount('10'); onChanged();
  }
  async function toggle(p: BarProduct) {
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, setActive: !p.active }) });
    onChanged();
  }

  // Inline edit of an existing product (name / category / price / discount)
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eCat, setECat] = useState('beer');
  const [eBasePrice, setEBasePrice] = useState('');
  const [eDiscount, setEDiscount] = useState('');
  function startEdit(p: BarProduct) {
    setEditId(p.id); setEName(p.name); setECat(p.category);
    setEBasePrice((p.basePricePence / 100).toFixed(2)); setEDiscount(String(p.memberDiscountPercent));
  }
  async function saveEdit(p: BarProduct) {
    const basePricePence = Math.round(parseFloat(eBasePrice || '0') * 100);
    const memberDiscountPercent = Math.round(parseFloat(eDiscount || '0'));
    if (!eName.trim() || basePricePence <= 0 || memberDiscountPercent < 0 || memberDiscountPercent > 100) return;
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, basePricePence, memberDiscountPercent }) });
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
          <label className="block text-[10px] text-gray-500">Price £</label>
          <input value={basePrice} onChange={(e) => setBasePrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
        </div>
        <div>
          <label className="block text-[10px] text-gray-500">Member discount %</label>
          <input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="%" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-24" />
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
                  <input value={eBasePrice} onChange={(e) => setEBasePrice(e.target.value)} placeholder="Price £" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  <input value={eDiscount} onChange={(e) => setEDiscount(e.target.value)} placeholder="Discount %" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-24" />
                  <button onClick={() => saveEdit(p)} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium">Save</button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-500">Cancel</button>
                </div>
              ) : (
                <div key={p.id} className={`flex justify-between items-center text-sm py-1 ${p.active ? '' : 'opacity-40'}`}>
                  <span>{p.name} — {fmt(p.basePricePence)} <span className="text-gray-400">/ {fmt(memberPricePence(p))} member ({p.memberDiscountPercent}% off)</span></span>
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
