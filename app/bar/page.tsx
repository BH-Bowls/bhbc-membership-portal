// app/bar/page.tsx
// The bar till (iPad, kiosk-style). Committee-gated device; per-sale attribution via
// whoever's marked as serving. Handles cash-member top-ups, wallet purchases, and
// visitor card/cash sales, plus an anytime report and product admin.
//
// Flow: person picker (every club member, not just existing cash-account holders,
// via a live-filtering search box, plus a Cash/Card option for non-members) -> the
// product/basket screen, priced and actioned differently depending on who's buying:
//   - Member: Top Up / Pay by Account / Pay by Card. Selecting a member with no
//     bar_accounts row yet doesn't create one — bar_topup creates it silently on
//     their first top-up (see 0025_bar.sql); a Pay-by-Account attempt before that
//     correctly fails (no funds to charge against), same as an existing member with
//     an empty wallet. Their transaction history lives on My Account
//     (app/account/page.tsx), not here.
//   - Cash/Card (non-member): Pay by Cash / Pay by Card, priced at basePricePence.
// "Who's serving" is asked once, when the till is opened after a PIN login, and then
// shown in the header ("Serving: Anne") for the rest of the session. Tapping it opens
// ServerPicker: the names that have served this session, plus "+ Someone else" for the
// rest of the bar people. Top Up, Cash/Card, Dayend, Cash Movement and Membership Fees
// all use whoever's serving without asking again. The session list is cleared on the
// next PIN login (the till's session ends after 4h idle / 24h — see src/lib/auth.ts).
// A Cash/Card tab is held/resumed by staff name rather than by a member. A basket left
// via "← Back" is parked in heldOrders and resumed if that same member/tab is reopened.
//
// Card or PIN (src/lib/bar-card.ts): Pay by Account and Top Up need the member to scan
// their membership card or enter their bar PIN, when the Config setting says they must
// (bar_account_proof: off / Testing role only / everyone). A scan from the person picker
// counts; otherwise ProofDialog asks. The proof lasts while that member's basket is open,
// and goes with the payment so the server checks it too. Offline, only a card scan
// works (checked against the hashes from /api/bar/cards) — a PIN needs the server.
// A member who can't show either (forgotten card, no PIN) can be approved by the person
// serving, with their own card or PIN — logged, and marked on the Sales list.
// Day End, Void, Refund and Cash Movement: the person serving confirms with their own
// card or PIN as the action starts, every time, when bar_staff_proof covers them
// (requireStaff / StaffProofDialog); who's serving is then fixed on that screen.
// Changing who's serving needs nothing, so on a busy day only these exceptions ask.
//
// Help (src/components/BarHelp.tsx): the header's Help button opens the topic for the
// screen on show (SCREEN_HELP), and the dialogs have a "?" (BarHelpLink) for theirs. It
// opens over the till rather than going to /help, which a Bar login can't reach.

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import QrScanModal from '@/components/QrScanModal';
import { canUseBarTill } from '@/lib/role-utils';
import { priceItem, type BarPricingConfig, type BarProduct, type BarCategoryRow, type BarAccount, type BarPerson, type BarReport, type BarSaleSummary, type BarDayEnd, type BarDayEndLedgerRow } from '@/lib/bar-supabase';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useCardScanner } from '@/hooks/useCardScanner';
import { enqueue, listQueued, dequeue, newQueueId, type QueuedEntry } from '@/lib/bar-offline-queue';
import BarTerminalPayment, { type TerminalCheckout } from '@/components/BarTerminalPayment';
import { BarHelpPanel, BarHelpContext, BarHelpLink, type BarHelpTopicId } from '@/components/BarHelp';

const OFFLINE_WALLET_DELTAS_KEY = 'bar_offline_wallet_deltas';

// Categories are admin-managed data (bar_categories table), not a hardcoded list —
// see the "Manage Categories" section in ProductsAdmin below. Tailwind's JIT
// compiler only bundles a colour class it finds as a literal string in source, so
// an admin adding a new category can't get an arbitrary new colour at request
// time — each category instead picks one of this fixed palette by colorKey.
const CATEGORY_COLOR_PALETTE: Record<string, { active: string; inactive: string; tile: string }> = {
  amber:   { active: 'bg-amber-500 text-white',    inactive: 'bg-amber-50 text-amber-800 hover:bg-amber-100',     tile: 'border-l-4 border-l-amber-400' },
  rose:    { active: 'bg-rose-500 text-white',     inactive: 'bg-rose-50 text-rose-800 hover:bg-rose-100',        tile: 'border-l-4 border-l-rose-400' },
  purple:  { active: 'bg-purple-500 text-white',   inactive: 'bg-purple-50 text-purple-800 hover:bg-purple-100',  tile: 'border-l-4 border-l-purple-400' },
  teal:    { active: 'bg-teal-500 text-white',     inactive: 'bg-teal-50 text-teal-800 hover:bg-teal-100',        tile: 'border-l-4 border-l-teal-400' },
  sky:     { active: 'bg-sky-500 text-white',      inactive: 'bg-sky-50 text-sky-800 hover:bg-sky-100',           tile: 'border-l-4 border-l-sky-400' },
  orange:  { active: 'bg-orange-500 text-white',   inactive: 'bg-orange-50 text-orange-800 hover:bg-orange-100',  tile: 'border-l-4 border-l-orange-400' },
  emerald: { active: 'bg-emerald-500 text-white',  inactive: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100', tile: 'border-l-4 border-l-emerald-400' },
  indigo:  { active: 'bg-indigo-500 text-white',   inactive: 'bg-indigo-50 text-indigo-800 hover:bg-indigo-100',  tile: 'border-l-4 border-l-indigo-400' },
  pink:    { active: 'bg-pink-500 text-white',     inactive: 'bg-pink-50 text-pink-800 hover:bg-pink-100',        tile: 'border-l-4 border-l-pink-400' },
  lime:    { active: 'bg-lime-500 text-white',     inactive: 'bg-lime-50 text-lime-800 hover:bg-lime-100',        tile: 'border-l-4 border-l-lime-400' },
};
const CATEGORY_COLOR_KEYS = Object.keys(CATEGORY_COLOR_PALETTE);
function categoryColorClasses(colorKey: string): { active: string; inactive: string; tile: string } {
  return CATEGORY_COLOR_PALETTE[colorKey] ?? CATEGORY_COLOR_PALETTE[CATEGORY_COLOR_KEYS[0]];
}
/** A product's tile border colour, looked up via its category's colorKey. */
function categoryColorFor(categoryKey: string, categories: BarCategoryRow[]): string {
  const found = categories.find((c) => c.key === categoryKey);
  if (!found) return '';
  return categoryColorClasses(found.colorKey).tile;
}

const fmt = (pence: number) => `£${(pence / 100).toFixed(2)}`;

// Kept on the iPad so a page reload doesn't ask again; cleared whenever the till is
// signed out, so the next PIN login starts a fresh session.
const SERVED_BY_KEY = 'bar_served_by';
const SESSION_SERVERS_KEY = 'bar_session_servers';
// Held orders (and the basket on screen) as { orderKey: [{ productId, qty }] }, so a
// refresh mid-rush doesn't lose them. Short-term memory only — cleared on sign-out.
const HELD_ORDERS_KEY = 'bar_held_orders';
type ServerAction = 'cashcard' | 'topup' | 'endofday' | 'cashmovement' | 'membership';
// Actions the person serving confirms with their own card or PIN before starting (requireStaff)
type StaffAction = 'dayend' | 'cashmovement' | 'void' | 'refund';

type View = 'volunteer' | 'person' | 'sale' | 'topup' | 'report' | 'sales' | 'products' | 'cashmovement' | 'membership';
interface BasketLine { product: BarProduct; qty: number }
interface MemberOption { userName: string; fullName: string }
// One member's card/PIN details from /api/bar/cards (TillCard in src/lib/bar-card.ts)
interface TillCard {
  userName: string; userId: string; cardHash: string; hasPin: boolean; pinLocked: boolean;
  proofRequired: boolean;        // as a member: Pay by Account / Top Up
  staffProofRequired: boolean;   // as the person serving: Day End, Void, Refund, Cash Movement
}
// One person's card scan or typed PIN
interface PersonProof { cardCode?: string; pin?: string }
// Proof that the member on screen is really here — sent with Pay by Account / Top Up.
// Their own card or PIN, or the person serving's (serverApproval) when they can't show
// either. A PIN is only held here while the basket is open, and is checked each payment.
interface MemberProof extends PersonProof { userName: string; serverApproval?: PersonProof }

async function sha256Hex(text: string): Promise<string | null> {
  if (!crypto.subtle) return null; // only on HTTPS or localhost
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Where the header's Help button opens, for each screen (src/components/BarHelp.tsx)
const SCREEN_HELP: Record<View, BarHelpTopicId> = {
  person: 'members',
  sale: 'baskets',
  volunteer: 'start',
  topup: 'topup',
  sales: 'mistakes',
  report: 'dayend',
  products: 'products',
  cashmovement: 'cashmovement',
  membership: 'membership',
};

const SCREEN_TITLES: Record<View, string> = {
  person: 'Home',
  sale: 'Basket',
  volunteer: "Who's Serving",
  topup: 'Topup',
  sales: 'Sales',
  report: 'Dayend',
  products: 'Products',
  cashmovement: 'Cash Movement',
  membership: 'Membership Fees',
};

export default function BarTillPage() {
  const { data: session, status } = useSession();
  const role = session?.user?.role ?? '';
  const allowed = canUseBarTill(role);
  // The dedicated till login has no navbar (Navbar.tsx hides itself for this role),
  // so it needs its own way to sign out — see the Logout button on the Home screen.
  const isBarTillLogin = role === 'Bar';

  // Starts on the person picker; switches to Who's Serving once the bar people have
  // loaded if no one is serving yet this session (see the effect below).
  const [view, setView] = useState<View>('person');
  const [products, setProducts] = useState<BarProduct[]>([]);
  const [categories, setCategories] = useState<BarCategoryRow[]>([]);
  const [pricingConfig, setPricingConfig] = useState<BarPricingConfig>({ mode: 'member_product_discount', memberDiscountPercent: 0 });
  const [accounts, setAccounts] = useState<BarAccount[]>([]);
  const [allMembers, setAllMembers] = useState<MemberOption[]>([]);
  const [barPersons, setBarPersons] = useState<BarPerson[]>([]);
  const [volunteer, setVolunteer] = useState<string>('');   // username of the bar person serving
  // Everyone who's served since the PIN login, in the order they were picked —
  // the quick choices on ServerPicker.
  const [sessionServers, setSessionServers] = useState<string[]>([]);
  const [showServerPicker, setShowServerPicker] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  // The help panel and the topic it opened at (null = the list of topics)
  const [help, setHelp] = useState<{ topic: BarHelpTopicId | null } | null>(null);
  // What to do once a name is tapped on the volunteer picker — only set if an action
  // needs a server and no one is serving yet (see withServer).
  const [pendingAction, setPendingAction] = useState<ServerAction | null>(null);
  const [personSearch, setPersonSearch] = useState('');
  const [showScanner, setShowScanner] = useState(false);
  // Card/PIN (see the header comment). proofRef mirrors proof so a payment that carries
  // on straight after ProofDialog sees it without waiting for a re-render.
  // tillCardsRef mirrors tillCards the same way, for code that carries on after waiting
  // for the list (whenCardsReady); tillCardsLoad is the request for it, shared by anyone
  // waiting, until it has loaded once.
  const [tillCards, setTillCardsState] = useState<TillCard[]>([]);
  const tillCardsRef = useRef<TillCard[]>([]);
  const tillCardsLoaded = useRef(false);
  const tillCardsLoad = useRef<Promise<void> | null>(null);
  const [proof, setProof] = useState<MemberProof | null>(null);
  const proofRef = useRef<MemberProof | null>(null);
  const [proofDialog, setProofDialog] = useState<{ purpose: 'pay' | 'topup'; onProven: () => void } | null>(null);
  const [showSetPin, setShowSetPin] = useState(false);
  // Day End / Void / Refund / Cash Movement waiting for the person serving to confirm,
  // and their confirmation for the one in progress (see requireStaff)
  const [staffDialog, setStaffDialog] = useState<{ label: string; server: string; onProven: (p: PersonProof) => void } | null>(null);
  const [staffSession, setStaffSessionState] = useState<{ action: StaffAction; server: string; proof: PersonProof | null } | null>(null);
  const staffSessionRef = useRef<{ action: StaffAction; server: string; proof: PersonProof | null } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Square Terminal (renewals spec §10): when one is paired, card payments are sent to
  // it and the "waiting for the card" dialog shows until Square says paid or cancelled.
  const [terminalEnabled, setTerminalEnabled] = useState(false);
  const [terminalPay, setTerminalPay] = useState<{
    checkout: TerminalCheckout;
    notice?: string;
    onPaid?: (c: TerminalCheckout) => void;   // not set for a picked-up payment (see resumedTerminalPaid)
    onManual?: () => void;
  } | null>(null);
  const terminalResumed = useRef(false);
  // Offline card payment: the till can't reach the Terminal, so staff take it on the
  // Terminal's keypad (it queues offline too) and confirm before it's recorded.
  const [offlineCard, setOfflineCard] = useState<{ amountPence: number; onConfirm: () => void } | null>(null);
  // Cash payment: confirm it really was cash (easy to tap instead of Card) and work out the change
  const [cashDue, setCashDue] = useState<{ amountPence: number; onConfirm: () => void } | null>(null);
  // Pay by Account: confirm the amount and show what's left on the account
  const [walletDue, setWalletDue] = useState<{ amountPence: number; balancePence: number; onConfirm: () => void } | null>(null);

  // selection / flow state
  const [member, setMember] = useState<BarAccount | null>(null); // null + view 'sale' means non-member
  const [basket, setBasket] = useState<BasketLine[]>([]);
  // Orders parked mid-basket so a bar person can serve someone else and come back —
  // keyed by `member:<userName>` for a member's basket, or `staff:<userName>` for a
  // non-member (Cash/Card) tab, since a non-member sale has no member to key off.
  const [heldOrders, setHeldOrders] = useState<Map<string, BasketLine[]>>(new Map());
  const [activeCat, setActiveCat] = useState<string>('beer');
  const [report, setReport] = useState<BarReport | null>(null);
  const [dayEndSubmitting, setDayEndSubmitting] = useState(false);
  const [dayEndSuccess, setDayEndSuccess] = useState<BarDayEnd | null>(null);
  const [sales, setSales] = useState<BarSaleSummary[] | null>(null);
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  // Void confirm: what will happen for this payment type, then the result
  const [refundConfirmPence, setRefundConfirmPence] = useState<number | null>(null);   // account cash refund awaiting confirm
  const [voidDialog, setVoidDialog] = useState<{ sale: BarSaleSummary; done: string | null; error: string | null } | null>(null);
  const [showRefund, setShowRefund] = useState(false);
  const [refundAmt, setRefundAmt] = useState('');

  // ── offline (see src/hooks/useOnlineStatus.ts, src/lib/bar-offline-queue.ts) ────
  const { offline, retry: retryOnline } = useOnlineStatus();
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  // A member's spendable balance *while offline*, starting at zero regardless of
  // their last-cached real balance — never trust a stale balance for spending
  // decisions. Only what's topped up during this offline window is spendable
  // offline; replayed as real ledger deltas against the server's true balance on
  // reconnect (see syncQueue). Persisted so it survives a reload while offline.
  const [offlineWalletDeltas, setOfflineWalletDeltas] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OFFLINE_WALLET_DELTAS_KEY);
      if (raw) setOfflineWalletDeltas(JSON.parse(raw));
    } catch { /* ignore corrupt/missing data */ }
    refreshQueuedCount();
  }, []);
  function refreshQueuedCount() {
    listQueued().then((q) => setQueuedCount(q.length)).catch(() => {});
  }
  function addOfflineWalletDelta(userName: string, deltaPence: number) {
    setOfflineWalletDeltas((prev) => {
      const next = { ...prev, [userName]: (prev[userName] ?? 0) + deltaPence };
      try { localStorage.setItem(OFFLINE_WALLET_DELTAS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const load = useCallback(async () => {
    try {
      const [p, a, b, m, c, cat] = await Promise.all([
        fetch('/api/bar/products?all=1').then((r) => r.json()),
        fetch('/api/bar/accounts').then((r) => r.json()),
        fetch('/api/bar/bar-persons').then((r) => r.json()),
        fetch('/api/members/lookup').then((r) => r.json()),
        fetch('/api/bar/pricing-config').then((r) => r.json()),
        fetch('/api/bar/categories?all=1').then((r) => r.json()),
      ]);
      if (p.products) setProducts(p.products);
      if (a.accounts) setAccounts(a.accounts);
      if (b.barPersons) setBarPersons(b.barPersons);
      if (m.members) setAllMembers(m.members);
      if (c.pricingConfig) setPricingConfig(c.pricingConfig);
      if (cat.categories) setCategories(cat.categories);
    } catch { setError('Failed to load bar data'); }

    // Separately, so a card problem never stops the till loading — card scans just
    // aren't recognised, and the server still checks payments
    await loadTillCards();

    // Separately, so a Square problem never stops the till loading
    try {
      const sq = await fetch('/api/bar/square').then((r) => r.json());
      setTerminalEnabled(!!sq.enabled);
      // A payment still on the Terminal after a refresh — show it again so it's not lost
      if (sq.open && !terminalResumed.current) {
        terminalResumed.current = true;
        setTerminalPay({ checkout: sq.open, notice: 'The Terminal is still working on this payment.' });
      }
      terminalResumed.current = true;
    } catch { setTerminalEnabled(false); }
  // loadTillCards only uses refs and state setters, so the first render's copy is fine
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Send a card payment to the Terminal and show the waiting dialog. */
  async function startTerminal(body: Record<string, unknown>, onPaid: (c: TerminalCheckout) => void, onManual?: () => void) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/square', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (res.status === 409 && data.checkout) {
        setTerminalPay({
          checkout: data.checkout,
          notice: 'The Terminal was already waiting for this payment — finish or cancel it, then try again.',
        });
        return;
      }
      if (!res.ok) { handleProofRefused(data); throw new Error(data.error || 'Could not send the payment to the Terminal'); }
      setTerminalPay({ checkout: data.checkout, onPaid: onPaid, onManual: onManual });
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  /** True if a basket holds exactly the items a Terminal sale was sent with. */
  function basketMatches(lines: BasketLine[], items: unknown): boolean {
    if (!Array.isArray(items) || items.length !== lines.length) return false;
    for (const item of items) {
      const line = lines.find((l) => l.product.id === item.productId);
      if (!line || line.qty !== item.qty) return false;
    }
    return true;
  }

  // A payment picked up after a refresh (or found already on the Terminal) was paid.
  // The till that started it has gone, so tidy up here: a sale's basket is still held
  // (and may be on screen), and must go — or it could be charged again.
  function resumedTerminalPaid(c: TerminalCheckout) {
    setTerminalPay(null);
    const payload = c.payload || {};
    if (c.kind === 'sale') {
      let key: string | null = null;
      if (payload.userName) key = `member:${payload.userName}`;
      else if (payload.staff) key = `staff:${payload.staff}`;
      if (key) {
        const onScreen = view === 'sale' && currentOrderKey() === key;
        const lines = onScreen ? basket : (heldOrders.get(key) || []);
        if (basketMatches(lines, payload.items)) {
          clearHeldOrder(key);
          if (onScreen) { setBasket([]); backToPersonPicker(true); }
        } else if (lines.length > 0) {
          setError(`The Terminal took ${fmt(c.amountPence)} for an earlier version of this order — check what's still owed before taking payment again.`);
        }
      }
    }
    if (c.kind === 'topup' && member && member.userName === payload.userName && c.result) {
      const balance = c.result.balancePence;
      if (typeof balance === 'number') setMember({ ...member, balancePence: balance });
    }
    load();
  }

  // Drains the offline queue in order on reconnect — re-verifies the session/device
  // is still valid first (a revoked device or expired session must not silently sync),
  // and stops at the first failure rather than risking reordering the rest.
  const syncQueue = useCallback(async () => {
    if (syncing) return;
    setSyncing(true); setError('');
    try {
      const check = await fetch('/api/bar/pricing-config');
      if (!check.ok) {
        if (check.status === 401 || check.status === 403) {
          setError('Session no longer valid — log in again before syncing queued sales.');
        }
        return;
      }
      const queue = await listQueued();
      for (const entry of queue) {
        let res: Response;
        if (entry.kind === 'sale') {
          res = await fetch('/api/bar/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: entry.method, items: entry.items, staff: entry.staff, userName: entry.userName }) });
        } else {
          // The card scanned when it was queued still counts if it's been reset since
          let replayProof: Record<string, unknown> | undefined;
          if (entry.cardCode) replayProof = { cardCode: entry.cardCode, offlineReplay: true };
          else if (entry.approvalCardCode) replayProof = { serverApproval: { cardCode: entry.approvalCardCode }, offlineReplay: true };
          if (entry.kind === 'topup') {
            res = await fetch('/api/bar/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userName: entry.userName, amountPence: entry.amountPence, staff: entry.staff, paymentMethod: entry.paymentMethod, proof: replayProof }) });
          } else {
            res = await fetch('/api/bar/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ userName: entry.userName, items: entry.items, staff: entry.staff, proof: replayProof }) });
          }
        }
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as any);
          setError(`Sync stopped: ${data.error || 'a queued item failed'} — will retry the rest later.`);
          break;
        }
        await dequeue(entry.id);
      }
      const remaining = await listQueued();
      setQueuedCount(remaining.length);
      if (remaining.length === 0) {
        setOfflineWalletDeltas({});
        try { localStorage.removeItem(OFFLINE_WALLET_DELTAS_KEY); } catch { /* ignore */ }
      }
      await load();
    } finally {
      setSyncing(false);
    }
  }, [syncing, load]);

  // Auto-sync the moment connectivity comes back, if anything's queued.
  useEffect(() => {
    if (!offline && queuedCount > 0) syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offline]);

  useEffect(() => { if (allowed) load(); }, [allowed, load]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    // Signed out (Logout, or the session expired) — the next PIN login is a new session.
    if (status === 'unauthenticated') {
      try {
        localStorage.removeItem(SERVED_BY_KEY); localStorage.removeItem(SESSION_SERVERS_KEY); localStorage.removeItem(HELD_ORDERS_KEY);
      } catch { /* ignore */ }
      setVolunteer(''); setSessionServers([]); setHeldOrders(new Map()); setBasket([]);
      return;
    }
    if (status !== 'authenticated') return;
    try {
      const s = localStorage.getItem(SERVED_BY_KEY);
      if (s) setVolunteer(s);
      const list = localStorage.getItem(SESSION_SERVERS_KEY);
      if (list) setSessionServers(JSON.parse(list));
    } catch { /* ignore corrupt/missing data */ }
  }, [status]);
  // Held orders: restored once the product list has loaded (at today's prices, dropping
  // anything since removed or made inactive), then saved on every change. The basket
  // on screen is saved under its own key too, so after a refresh it's simply a held
  // order to reopen. Nothing is saved until the restore has run, so an empty first
  // render can't overwrite what's stored.
  const heldRestored = useRef(false);
  useEffect(() => {
    if (status !== 'authenticated' || heldRestored.current || products.length === 0) return;
    heldRestored.current = true;
    try {
      const raw = localStorage.getItem(HELD_ORDERS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, { productId: string; qty: number }[]>;
      const byId = new Map(products.map((p) => [p.id, p]));
      const restored = new Map<string, BasketLine[]>();
      for (const key of Object.keys(stored)) {
        const lines: BasketLine[] = [];
        for (const l of stored[key]) {
          const product = byId.get(l.productId);
          if (product && product.active && l.qty > 0) lines.push({ product, qty: l.qty });
        }
        if (lines.length > 0) restored.set(key, lines);
      }
      setHeldOrders(restored);
    } catch { /* ignore corrupt data */ }
  }, [status, products]);
  useEffect(() => {
    if (!heldRestored.current) return;
    const toSave: Record<string, { productId: string; qty: number }[]> = {};
    heldOrders.forEach((lines, key) => {
      toSave[key] = lines.map((l) => ({ productId: l.product.id, qty: l.qty }));
    });
    const onScreenKey = view === 'sale' ? currentOrderKey() : null;
    if (onScreenKey) {
      if (basket.length > 0) toSave[onScreenKey] = basket.map((l) => ({ productId: l.product.id, qty: l.qty }));
      else delete toSave[onScreenKey];
    }
    try {
      if (Object.keys(toSave).length > 0) localStorage.setItem(HELD_ORDERS_KEY, JSON.stringify(toSave));
      else localStorage.removeItem(HELD_ORDERS_KEY);
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heldOrders, basket, view, member, volunteer]);

  // Ask who's serving as soon as the till opens, if no one is yet this session.
  useEffect(() => {
    if (allowed && barPersons.length > 0 && !volunteer && view === 'person') setView('volunteer');
  }, [allowed, barPersons, volunteer, view]);
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

  // Marks who's serving and adds them to this session's list (ServerPicker's quick choices).
  function setServer(u: string) {
    if (staffSessionRef.current && staffSessionRef.current.server !== u) {
      setStaffSession(null);
      setShowRefund(false);
    }
    setVolunteer(u);
    try { localStorage.setItem(SERVED_BY_KEY, u); } catch { /* ignore */ }
    setSessionServers((prev) => {
      if (prev.includes(u)) return prev;
      const next = [...prev, u];
      try { localStorage.setItem(SESSION_SERVERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // Changing who's serving from the header chip. On a Cash/Card basket, that tab
  // belongs to the old server — park it under them and bring up the new server's.
  function switchServer(u: string) {
    if (view === 'sale' && !member && volunteer && u !== volunteer) {
      const oldKey = `staff:${volunteer}`;
      setHeldOrders((prev) => {
        const next = new Map(prev);
        if (basket.length > 0) next.set(oldKey, basket); else next.delete(oldKey);
        return next;
      });
      setBasket(heldOrders.get(`staff:${u}`) ?? []);
    }
    setServer(u);
  }

  function startAction(action: ServerAction, server: string) {
    if (action === 'cashcard') {
      setMember(null); setBasket(heldOrders.get(`staff:${server}`) ?? []); setActiveCat('beer'); setView('sale');
    } else if (action === 'topup') {
      setView('topup');
    } else if (action === 'endofday') {
      requireStaff('dayend', 'Day End', server, () => { setDayEndSuccess(null); loadReport(); });
    } else if (action === 'cashmovement') {
      requireStaff('cashmovement', 'Cash Movement', server, () => setView('cashmovement'));
    } else {
      setView('membership');
    }
  }

  // Actions that are recorded against whoever's serving — straight in if someone is,
  // otherwise via Who's Serving first.
  function withServer(action: ServerAction) {
    if (volunteer) { startAction(action, volunteer); return; }
    setPendingAction(action);
    setView('volunteer');
  }

  // A name tapped on the full-screen Who's Serving picker.
  function chooseVolunteer(u: string) {
    setServer(u);
    const action = pendingAction;
    setPendingAction(null);
    if (action) startAction(action, u);
    else setView('person');
  }

  // Returns to the till (person picker) for the next customer, parking whatever
  // basket is on screen so it can be resumed later.
  // skipHold is set by completeSale, which has already cleared/emptied the basket
  // itself after a successful sale — without it, this would re-park the very
  // basket that was just paid for (a stale closure would still see it as full).
  function backToPersonPicker(skipHold = false) {
    if (!skipHold) holdCurrentOrder();
    setView('person'); setMember(null); setBasket([]); setPersonSearch('');
    setShowRefund(false); setRefundAmt('');
    setMemberProof(null);
    setStaffSession(null);
  }

  // ── basket / pricing helpers ─────────────────────────────────────────────────
  // unitPrice is what's actually charged (net); unitGrossPrice is what a visitor/
  // list price would be under the active mode — the difference is the member's
  // discount, shown on the basket and carried into the sale record.
  const unitPrice = (p: BarProduct) => priceItem(p, pricingConfig, !!member).netPence;
  const unitGrossPrice = (p: BarProduct) => priceItem(p, pricingConfig, !!member).grossPence;
  const basketTotal = basket.reduce((s, l) => s + unitPrice(l.product) * l.qty, 0);
  const basketGross = basket.reduce((s, l) => s + unitGrossPrice(l.product) * l.qty, 0);
  const basketDiscount = basketGross - basketTotal;
  // What the member can actually spend right now — the real (possibly stale) balance
  // when online, or only what's been topped up this offline session when not (see
  // offlineWalletDeltas above; never the stale cached balance while offline).
  const availableBalancePence = member ? (offline ? (offlineWalletDeltas[member.userName] ?? 0) : member.balancePence) : 0;
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
  // requirement. Sales just use whoever's serving (asked when the till opens).
  function requireVolunteer(): boolean {
    if (!volunteer) { setError('Select the bar volunteer first.'); return false; }
    setError(''); return true;
  }

  // Opens a member's basket — resumes their held order if any. withProof is set when
  // they were found by scanning their card.
  function selectMember(m: BarAccount, withProof: MemberProof | null = null) {
    setMember(m); setBasket(heldOrders.get(`member:${m.userName}`) ?? []); setActiveCat('beer');
    setShowRefund(false); setView('sale');
    setMemberProof(withProof);
  }

  // ── card / PIN proof (see the header comment) ──────────────────────────────
  function setMemberProof(p: MemberProof | null) {
    proofRef.current = p;
    setProof(p);
  }
  function setTillCards(update: (prev: TillCard[]) => TillCard[]) {
    tillCardsRef.current = update(tillCardsRef.current);
    setTillCardsState(tillCardsRef.current);
  }
  // Fetches who needs a card or PIN. Reuses a request already on its way, so the
  // startup load and an early button press share one.
  function loadTillCards(): Promise<void> {
    if (tillCardsLoad.current) return tillCardsLoad.current;
    const request = (async () => {
      try {
        const cardData = await fetch('/api/bar/cards').then((r) => r.json());
        if (cardData.cards) {
          setTillCards(() => cardData.cards);
          tillCardsLoaded.current = true;
        }
      } catch { /* keep the last list */ }
      tillCardsLoad.current = null;
    })();
    tillCardsLoad.current = request;
    return request;
  }
  // Until the list has loaded, the till can't tell who needs a card or PIN — a button
  // pressed straight after the till opens (or a dev server still compiling the route)
  // would otherwise skip the check and only be stopped by the server. So wait for it.
  // If it can't be loaded, carry on: the server still checks every payment.
  function whenCardsReady(run: () => void) {
    if (tillCardsLoaded.current) { run(); return; }
    setBusy(true);
    loadTillCards().finally(() => { setBusy(false); run(); });
  }
  function tillCardFor(userName: string): TillCard | undefined {
    return tillCardsRef.current.find((c) => c.userName === userName);
  }
  function markPinLocked(userName: string) {
    setTillCards((prev) => prev.map((c) => (c.userName === userName ? { ...c, pinLocked: true } : c)));
  }
  // Offline, only a scanned card will do — a PIN check can't reach the server, and a
  // queued payment has to carry the card to be accepted when it syncs.
  function hasProof(userName: string): boolean {
    const p = proofRef.current;
    if (!p || p.userName !== userName) return false;
    const proven = p.serverApproval ? p.serverApproval : p;
    return !!proven.cardCode || (!offline && !!proven.pin);
  }
  function needsProof(userName: string): boolean {
    const card = tillCardFor(userName);
    return !!card && card.proofRequired && !hasProof(userName);
  }
  // Runs action now if the member on screen doesn't need (or already has) proof,
  // otherwise once they've scanned their card or entered their PIN.
  function withProof(purpose: 'pay' | 'topup', action: () => void) {
    const onScreen = member;
    if (!onScreen) { action(); return; }
    whenCardsReady(() => {
      if (!needsProof(onScreen.userName)) { action(); return; }
      setProofDialog({ purpose: purpose, onProven: () => { setProofDialog(null); action(); } });
    });
  }
  // The server said the proof wasn't good enough (e.g. a PIN check expired) — ask again next time
  function handleProofRefused(data: { proofRequired?: boolean }) {
    if (data.proofRequired) setMemberProof(null);
  }
  // What goes with a payment for this member (the server ignores it if not needed)
  function proofFor(userName: string): { cardCode?: string; pin?: string; serverApproval?: PersonProof } | undefined {
    const p = proofRef.current;
    if (!p || p.userName !== userName) return undefined;
    return { cardCode: p.cardCode, pin: p.pin, serverApproval: p.serverApproval };
  }
  // A card scanned as proof, for a payment queued offline — the member's own, or the
  // approving server's — so it's accepted when it syncs
  function queuedCards(userName: string): { cardCode?: string; approvalCardCode?: string } {
    const p = proofFor(userName);
    if (!p) return {};
    if (p.serverApproval) return { approvalCardCode: p.serverApproval.cardCode };
    return { cardCode: p.cardCode };
  }

  // Day End, Cash Movement, Void and Refund: the person serving (server — passed in, as
  // it may have only just been picked) confirms with their own card or PIN before the
  // action starts, every time, when the bar_staff_proof setting covers them. The
  // confirmation goes with the request when it's saved (staffProofFor), and the server
  // checks it again. While it's held, who's serving can't be changed on that screen.
  function setStaffSession(next: { action: StaffAction; server: string; proof: PersonProof | null } | null) {
    staffSessionRef.current = next;
    setStaffSessionState(next);
  }
  function requireStaff(action: StaffAction, label: string, server: string, run: () => void) {
    whenCardsReady(() => {
      const card = server ? tillCardFor(server) : undefined;
      if (!card || !card.staffProofRequired) { setStaffSession({ action: action, server: server, proof: null }); run(); return; }
      setStaffDialog({ label: label, server: server, onProven: (p) => {
        setStaffDialog(null);
        setStaffSession({ action: action, server: server, proof: p });
        run();
      } });
    });
  }
  function staffProofFor(action: StaffAction): PersonProof | undefined {
    const current = staffSessionRef.current;
    if (!current || current.action !== action || !current.proof) return undefined;
    return current.proof;
  }
  // Cash/Card resumes whoever's serving's held tab, if they have one (see startAction).
  function openCashCardTab() {
    withServer('cashcard');
  }

  // The single "← Back" button's destination depends on how the current screen was
  // reached, not just which screen it is:
  //  - Who's Serving opened for a Cash/Card tab -> Home (cancels starting the tab)
  //  - Who's Serving opened for a Top Up, or the Top Up screen itself -> Basket
  //    (cancels just the top-up, keeps the member/basket you were already on)
  //  - everything else (Basket, Sales, Report, Products) -> Home
  function handleBack() {
    if (view === 'volunteer' && pendingAction === 'topup') {
      setPendingAction(null);
      setView('sale');
      return;
    }
    if (view === 'topup') {
      setView('sale');
      return;
    }
    setPendingAction(null);
    backToPersonPicker();
  }

  // ask false = staff have already confirmed (the cash dialog, the offline card dialog,
  // or taken on the Terminal's own keypad) — record it straight away. Terminal sales are
  // recorded by the server itself.
  async function completeSale(mode: 'wallet' | 'card' | 'cash', ask = true) {
    if (basket.length === 0) return;
    const items = basket.map((l) => ({ productId: l.product.id, qty: l.qty }));
    // Every sale is stored against whoever's serving — the till asks as soon as it opens.
    const staffForSale = volunteer;

    if (mode === 'cash' && ask) {
      setCashDue({ amountPence: basketTotal, onConfirm: () => { setCashDue(null); completeSale('cash', false); } });
      return;
    }
    // Card or PIN first if they need one, then confirm the amount
    if (mode === 'wallet' && ask && member) {
      withProof('pay', () => setWalletDue({ amountPence: basketTotal, balancePence: availableBalancePence, onConfirm: () => { setWalletDue(null); completeSale('wallet', false); } }));
      return;
    }
    if (mode === 'card' && ask && offline) {
      setOfflineCard({ amountPence: basketTotal, onConfirm: () => { setOfflineCard(null); completeSale('card', false); } });
      return;
    }
    if (mode === 'card' && ask && terminalEnabled && !offline) {
      const orderKey = currentOrderKey();
      await startTerminal(
        { kind: 'sale', expectedPence: basketTotal, staff: staffForSale, userName: member ? member.userName : undefined, items },
        () => {
          setTerminalPay(null);
          clearHeldOrder(orderKey);
          setBasket([]);
          load();
          backToPersonPicker(true);
        },
        () => {
          setTerminalPay(null);
          completeSale('card', false);
        },
      );
      return;
    }

    setBusy(true); setError('');
    try {
      if (offline) {
        if (mode === 'wallet') {
          if (!member) return;
          // Never against the stale cached balance — only what's been topped up
          // during this offline window (see offlineWalletDeltas above).
          const available = offlineWalletDeltas[member.userName] ?? 0;
          if (available < basketTotal) {
            setError('Insufficient offline balance — only top-ups made this session can be spent while offline.');
            return;
          }
          await enqueue({ id: newQueueId(), createdAt: Date.now(), kind: 'purchase', userName: member.userName, staff: staffForSale, amountPence: -basketTotal, items, ...queuedCards(member.userName) });
          addOfflineWalletDelta(member.userName, -basketTotal);
        } else {
          // Cash/card never touches a balance, so it's always safe to queue offline
          // regardless of who's buying.
          await enqueue({ id: newQueueId(), createdAt: Date.now(), kind: 'sale', method: mode, items, staff: staffForSale, userName: member?.userName, grossPence: basketGross, netPence: basketTotal, discountPence: basketDiscount });
        }
        refreshQueuedCount();
        clearHeldOrder(currentOrderKey());
        setBasket([]);
        backToPersonPicker(true);
        return;
      }

      let res;
      if (mode === 'wallet') {
        if (!member) return;
        res = await fetch('/api/bar/purchase', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userName: member.userName, items, staff: staffForSale, proof: proofFor(member.userName) }) });
      } else {
        // member is only ever set here for "Pay by Card" — attributes the sale to
        // them (member pricing, history) without touching their wallet.
        res = await fetch('/api/bar/sale', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ method: mode, items, staff: staffForSale, userName: member?.userName }) });
      }
      const data = await res.json();
      if (!res.ok) { handleProofRefused(data); throw new Error(data.error || 'Sale failed'); }
      clearHeldOrder(currentOrderKey());
      setBasket([]);
      await load();
      backToPersonPicker(true);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  // A top-up is stored against whoever's serving for audit (see doTopUp) — the name
  // is in the header, so a wrong one is visible without asking every time.
  function openTopUp() {
    withProof('topup', () => withServer('topup'));
  }

  async function doTopUp(amountPence: number, paymentMethod: 'cash' | 'card', ask = true) {
    if (!member || !requireVolunteer()) return;
    if (paymentMethod === 'cash' && ask) {
      setCashDue({ amountPence: amountPence, onConfirm: () => { setCashDue(null); doTopUp(amountPence, 'cash', false); } });
      return;
    }
    if (paymentMethod === 'card' && ask && offline) {
      setOfflineCard({ amountPence: amountPence, onConfirm: () => { setOfflineCard(null); doTopUp(amountPence, 'card', false); } });
      return;
    }
    if (paymentMethod === 'card' && ask && terminalEnabled && !offline) {
      await startTerminal(
        { kind: 'topup', expectedPence: amountPence, staff: volunteer, userName: member.userName, proof: proofFor(member.userName) },
        (c) => {
          setTerminalPay(null);
          const balance = c.result ? c.result.balancePence : undefined;
          if (typeof balance === 'number') setMember((m) => (m ? { ...m, balancePence: balance } : m));
          load();
          setView('sale');
        },
        () => {
          setTerminalPay(null);
          doTopUp(amountPence, 'card', false);
        },
      );
      return;
    }
    setBusy(true); setError('');
    try {
      if (offline) {
        await enqueue({ id: newQueueId(), createdAt: Date.now(), kind: 'topup', userName: member.userName, staff: volunteer, amountPence, paymentMethod, ...queuedCards(member.userName) });
        addOfflineWalletDelta(member.userName, amountPence);
        refreshQueuedCount();
        setView('sale');
        return;
      }
      const res = await fetch('/api/bar/topup', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence, staff: volunteer, paymentMethod, proof: proofFor(member.userName) }) });
      const data = await res.json();
      if (!res.ok) { handleProofRefused(data); throw new Error(data.error || 'Top-up failed'); }
      // Back to the product list (not the person picker) with the fresh balance —
      // topping up is usually followed straight by a purchase for the same member,
      // and the basket (if anything was already tapped) stays intact.
      setMember((m) => (m ? { ...m, balancePence: data.balancePence } : m));
      await load();
      setView('sale');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  async function loadReport() {
    const data = await fetch('/api/bar/report').then((r) => r.json());
    setReport(data.report ?? null); setView('report');
  }
  // The cash-up is done by, and stored against, whoever's serving (see
  // bar_create_day_end() in 0063_bar_day_ends.sql) — ReportView shows the name.
  function openEndOfDay() {
    withServer('endofday');
  }
  async function submitDayEnd(cashRemovedPence: number, carryForward: boolean, reason: string) {
    setDayEndSubmitting(true); setError('');
    try {
      const res = await fetch('/api/bar/day-end', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staff: volunteer, cashRemovedPence, carryForward, reason: reason || undefined, staffProof: staffProofFor('dayend') }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record day end');
      setDayEndSuccess(data.dayEnd);
      await loadReport();
    } catch (err: any) { setError(err.message); } finally { setDayEndSubmitting(false); }
  }

  // Cash added to or removed from the till for a non-sale reason (float top-up,
  // petty cash, etc.) -- discouraged but needed, stored against whoever's serving
  // for audit, same as a Top Up. See bar_cash_movement() in 0064_bar_cash_movements.sql.
  // Membership fees (renewals spec §8) — whoever's serving is stored on the payment for audit
  function openMembershipFees() {
    withServer('membership');
  }

  function openCashMovement() {
    withServer('cashmovement');
  }
  async function doCashMovement(productId: string, amountPence: number, direction: 'in' | 'out', reason: string) {
    if (offline) { setError('Cash movements need a live connection.'); return; }
    if (!requireVolunteer()) return;
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/cash-movement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, amountPence, direction, reason, staff: volunteer, staffProof: staffProofFor('cashmovement') }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to record cash movement');
      await load();
      setView('person');
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }
  async function loadSales() {
    setView('sales'); setSales(null); setExpandedSaleId(null);
    const data = await fetch('/api/bar/sales?limit=40').then((r) => r.json());
    setSales(data.sales ?? []);
  }
  function askVoid(sale: BarSaleSummary) {
    if (offline) { setError('Voiding needs a live connection.'); return; }
    if (!requireVolunteer()) return;
    requireStaff('void', 'Void sale', volunteer, () => setVoidDialog({ sale: sale, done: null, error: null }));
  }
  async function doVoid(sale: BarSaleSummary) {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/void', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ saleId: sale.id, staff: volunteer, staffProof: staffProofFor('void') }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Void failed');
      let done = 'Sale voided.';
      if (data.cardRefundPence > 0) done = `Sale voided, and ${fmt(data.cardRefundPence)} refunded to the customer’s card. It can take a few days to show on their statement.`;
      else if (sale.paymentMethod === 'wallet' && sale.memberName) done = `Sale voided, and ${fmt(sale.totalPence)} put back on ${sale.memberName}’s account.`;
      setVoidDialog({ sale: sale, done: done, error: null });
      const s = await fetch('/api/bar/sales?limit=40').then((r) => r.json());
      setSales(s.sales ?? []);
      await load(); // balances may have changed
    } catch (err: any) {
      setVoidDialog({ sale: sale, done: null, error: err.message });
    } finally { setBusy(false); }
  }
  function askRefund() {
    if (offline) { setError('Refunds need a live connection.'); return; }
    if (!member || !requireVolunteer()) return;
    const pence = Math.round(parseFloat(refundAmt || '0') * 100);
    if (!Number.isFinite(pence) || pence <= 0 || pence > member.balancePence) {
      setError('Enter a refund amount up to the balance.'); return;
    }
    setError('');
    setRefundConfirmPence(pence);
  }
  async function doRefund(pence: number) {
    if (!member) return;
    setRefundConfirmPence(null);
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/bar/refund', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, amountPence: pence, staff: volunteer, staffProof: staffProofFor('refund') }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refund failed');
      setMember({ ...member, balancePence: data.balancePence });
      setShowRefund(false); setRefundAmt('');
      setStaffSession(null);
      await load();
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  }

  // Every club member, merged with their real balance where one exists (0/no
  // account otherwise), filtered by the search box, and sorted so existing
  // cash members (lowest balance first, then name — a top-up reminder) come
  // before the much larger block of members who've never opened one (A-Z).
  function barPersonName(userName: string): string {
    const found = barPersons.find((b) => b.userName === userName);
    return found ? found.fullName : userName;
  }

  const balanceByUser = new Map(accounts.map((a) => [a.userName.toLowerCase(), a.balancePence]));
  const allPeople = allMembers.map((m) => {
    const bal = balanceByUser.get(m.userName.toLowerCase());
    return { userName: m.userName, fullName: m.fullName, balancePence: bal ?? 0, hasAccount: bal !== undefined };
  });
  const q = personSearch.trim().toLowerCase();
  const sortedPeople = allPeople
    .filter((m) => !q || m.fullName.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.hasAccount !== b.hasAccount) return a.hasAccount ? -1 : 1;
      if (a.hasAccount) return a.balancePence - b.balancePence || a.fullName.localeCompare(b.fullName);
      return a.fullName.localeCompare(b.fullName);
    });

  // Who a scanned QR is, and whether it proves they're here. A current membership card
  // (BHBC1.…) is proof; it's checked against the hash of each member's current card, so
  // it works offline. An old card that's been reset, or an old-style QR holding just the
  // username, finds the member (same as picking them from the list) but isn't proof.
  async function readScan(value: string): Promise<{ person?: BarAccount; proof?: MemberProof; message?: string }> {
    const code = value.trim();
    if (!tillCardsLoaded.current) await loadTillCards();
    if (code.startsWith('BHBC1.')) {
      const card = tillCardsRef.current.find((c) => c.userId === code.split('.')[1]);
      const person = card ? allPeople.find((m) => m.userName === card.userName) : undefined;
      if (!card || !person) return { message: 'Card not recognised.' };
      const hash = await sha256Hex(code);
      if (hash === null) return { person: person, message: 'This device can’t check cards — the till needs to be on its https:// address.' };
      if (hash !== card.cardHash) {
        return { person: person, message: `That card for ${person.fullName} has been replaced — ask for their current card, or use their PIN.` };
      }
      return { person: person, proof: { userName: person.userName, cardCode: code } };
    }
    const person = allPeople.find((m) => m.userName === code);
    if (person) {
      const oldCard = tillCardsRef.current.find((c) => c.userName === person.userName);
      if (oldCard && oldCard.proofRequired) {
        return { person: person, message: `That’s an old-style card for ${person.fullName} — it doesn’t count for paying from the account. Ask for their new card from My Account, or their PIN.` };
      }
      return { person: person };
    }
    return { message: 'QR code did not match a member.' };
  }

  async function handleScan(value: string) {
    setShowScanner(false);
    const result = await readScan(value);
    if (result.person) selectMember(result.person, result.proof ?? null);
    setError(result.message ?? '');
  }

  // A plug-in scanner (src/hooks/useCardScanner.ts). On the member list it picks the member,
  // like the Scan button. On a member's sale their own card proves it's them, so Pay by
  // Account won't ask again. While a card/PIN dialog is open, the dialog takes the scan.
  useCardScanner(async (code) => {
    if (view === 'person') { handleScan(code); return; }
    const result = await readScan(code);
    if (member && result.proof && result.proof.userName === member.userName) { setMemberProof(result.proof); setError(''); return; }
    if (member && result.person && result.person.userName !== member.userName) {
      setError(`That’s ${result.person.fullName}’s card — go back to the member list to serve them.`);
      return;
    }
    setError(result.message ?? '');
  }, (view === 'person' || (view === 'sale' && !!member)) && !proofDialog && !staffDialog && !showSetPin && !terminalPay && !voidDialog);

  // On a Day End or Cash Movement the person serving has confirmed it's them — keep it them
  const serverLocked = !!staffSession && !!staffSession.proof && (view === 'report' || view === 'cashmovement');

  // ── guards ──────────────────────────────────────────────────────────────────
  if (status === 'loading') return null;
  if (status === 'unauthenticated') return <BarPinLogin />;
  if (!allowed) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-md mx-auto mt-24 text-center text-gray-600">The bar till is for committee/bar accounts only.</div>
      </div>
    );
  }

  return (
    <BarHelpContext.Provider value={(topic) => setHelp({ topic: topic })}>
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-5 max-w-7xl">

        {help && <BarHelpPanel topic={help.topic} onClose={() => setHelp(null)} />}

        {terminalPay && (
          <BarTerminalPayment
            key={terminalPay.checkout.id}
            checkout={terminalPay.checkout}
            notice={terminalPay.notice}
            onPaid={terminalPay.onPaid ? terminalPay.onPaid : resumedTerminalPaid}
            onCancelled={() => setTerminalPay(null)}
            onManual={terminalPay.onManual}
          />
        )}

        {voidDialog && (
          <VoidSaleDialog sale={voidDialog.sale} done={voidDialog.done} error={voidDialog.error} busy={busy}
            onConfirm={() => doVoid(voidDialog.sale)} onClose={() => { setVoidDialog(null); setStaffSession(null); }} />
        )}

        {proofDialog && member && (
          <ProofDialog
            member={member}
            server={volunteer ? { userName: volunteer, fullName: barPersonName(volunteer) } : null}
            cards={tillCards}
            purpose={proofDialog.purpose}
            offline={offline}
            readScan={readScan}
            onPinLocked={markPinLocked}
            onProven={(p) => { setMemberProof(p); proofDialog.onProven(); }}
            onClose={() => setProofDialog(null)}
          />
        )}

        {staffDialog && (
          <StaffProofDialog
            server={{ userName: staffDialog.server, fullName: barPersonName(staffDialog.server) }}
            card={tillCardFor(staffDialog.server)}
            action={staffDialog.label}
            offline={offline}
            readScan={readScan}
            onPinLocked={() => markPinLocked(staffDialog.server)}
            onProven={staffDialog.onProven}
            onClose={() => { setStaffDialog(null); if (view === 'volunteer') setView('person'); }}
          />
        )}

        {showSetPin && member && proof && proof.userName === member.userName && proof.cardCode && (
          <SetPinDialog
            member={member}
            cardCode={proof.cardCode}
            onDone={() => setTillCards((prev) => prev.map((c) => (c.userName === member.userName ? { ...c, hasPin: true, pinLocked: false } : c)))}
            onClose={() => setShowSetPin(false)}
          />
        )}

        {walletDue && member && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="relative w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
              <BarHelpLink topic="paying" className="absolute top-3 right-3" />
              <p className="text-sm text-gray-700">Pay by account — {member.fullName}</p>
              <p className="text-4xl font-bold text-gray-900 my-2">{fmt(walletDue.amountPence)}</p>
              <div className="mt-3 rounded-lg border border-gray-200 p-3 text-sm text-gray-900 space-y-1">
                <div className="flex justify-between"><span>On the account now</span><span>{fmt(walletDue.balancePence)}</span></div>
                <div className="flex justify-between"><span>This sale</span><span>−{fmt(walletDue.amountPence)}</span></div>
                <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold">
                  <span>Left after this sale</span><span>{fmt(walletDue.balancePence - walletDue.amountPence)}</span>
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-2">
                <button onClick={walletDue.onConfirm} disabled={busy}
                  className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
                  Pay {fmt(walletDue.amountPence)} from the account
                </button>
                <button onClick={() => setWalletDue(null)} disabled={busy}
                  className="py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {refundConfirmPence !== null && member && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
              <p className="text-sm text-gray-700">Refund cash from {member.fullName}&apos;s account?</p>
              <p className="text-4xl font-bold text-gray-900 my-2">{fmt(refundConfirmPence)}</p>
              <p className="text-sm text-gray-900 text-left">
                Hand <strong>{fmt(refundConfirmPence)}</strong> cash from the till to {member.fullName}. Their account
                goes from {fmt(member.balancePence)} to {fmt(member.balancePence - refundConfirmPence)}.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                <button onClick={() => doRefund(refundConfirmPence)} disabled={busy}
                  className="py-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                  Refund {fmt(refundConfirmPence)}
                </button>
                <button onClick={() => setRefundConfirmPence(null)} disabled={busy}
                  className="py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {cashDue && (
          <CashChangeDialog amountPence={cashDue.amountPence} onConfirm={cashDue.onConfirm} onCancel={() => setCashDue(null)} />
        )}

        {offlineCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="relative w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
              <BarHelpLink topic="offline" className="absolute top-3 right-3" />
              <p className="text-sm text-gray-700">Card payment — till offline</p>
              <p className="text-4xl font-bold text-gray-900 my-2">{fmt(offlineCard.amountPence)}</p>
              <p className="text-sm text-gray-900 text-left">
                The till can&apos;t send this to the Terminal while it&apos;s offline. Key{' '}
                <strong>{fmt(offlineCard.amountPence)}</strong> in on the Terminal and take the card. The Terminal
                works offline too, and sends the payment to Square when it&apos;s back online.
              </p>
              <p className="mt-2 text-sm text-gray-900 text-left">Only confirm once the Terminal says it&apos;s approved.</p>
              <div className="mt-5 flex flex-col gap-2">
                <button onClick={offlineCard.onConfirm} className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">
                  Payment taken — record it
                </button>
                <button onClick={() => setOfflineCard(null)} className="py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Offline / queued-sales banner — separate from the site-wide OfflineBanner,
            since this one also shows the queue and offers a manual sync. */}
        {(offline || queuedCount > 0) && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <span>
              {offline ? 'Running offline — cash/card sales are queued locally.' : 'Back online.'}
              {queuedCount > 0 && ` ${queuedCount} sale${queuedCount === 1 ? '' : 's'} waiting to sync.`}
            </span>
            {!offline && queuedCount > 0 && (
              <button onClick={syncQueue} disabled={syncing}
                className="px-2 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50">
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            )}
            {offline && (
              <button onClick={retryOnline} className="px-2 py-1 text-xs font-medium border border-amber-400 rounded hover:bg-amber-100">Retry connection</button>
            )}
          </div>
        )}

        {/* Header: screen title + nav. Back's destination depends on how the screen
            was reached (see handleBack); Sales/Report/Products only launch from Home. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h1 className="text-lg font-bold text-gray-900">{SCREEN_TITLES[view]}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setHelp({ topic: SCREEN_HELP[view] })}
              className="px-3 py-2 text-sm border border-blue-200 rounded-md bg-blue-50 text-blue-900 hover:bg-blue-100">Help</button>
            {view !== 'volunteer' && volunteer && serverLocked && (
              <span className="px-3 py-2 text-sm rounded-full border border-gray-200 bg-gray-50 text-gray-900">
                Serving: <span className="font-semibold">{barPersonName(volunteer)}</span>
              </span>
            )}
            {view !== 'volunteer' && volunteer && !serverLocked && (
              <button onClick={() => setShowServerPicker(true)} title="Change who's serving"
                className="px-3 py-2 text-sm rounded-full border border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100">
                Serving: <span className="font-semibold">{barPersonName(volunteer)}</span> <span className="text-blue-700 underline">Change</span>
              </button>
            )}
            {view !== 'person' && !(view === 'volunteer' && !volunteer && barPersons.length > 0) && (
              <button onClick={handleBack}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">← Back</button>
            )}
            {view === 'person' && (
              <>
                <button onClick={loadSales} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Sales</button>
                <button onClick={openEndOfDay} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Dayend</button>
                <button onClick={() => setView('products')} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Products</button>
                <button onClick={openCashMovement} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50">Cash Movement</button>
                <button onClick={openMembershipFees} disabled={offline} className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50">Membership Fees</button>
                {isBarTillLogin && (
                  // Sits where Back is on every other screen, so a double tap would sign the
                  // till out — and that also clears who's serving for the session.
                  <button onClick={() => setConfirmLogout(true)}
                    className="px-3 py-2 text-sm border border-gray-300 rounded-md bg-white hover:bg-gray-50 text-red-600">Logout</button>
                )}
              </>
            )}
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded">{error}</div>}

        {confirmLogout && (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setConfirmLogout(false)}>
            <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Log out of the bar till?</h2>
              <p className="text-sm text-gray-700 mb-5">
                You&apos;ll need the PIN to get back in.
                {heldOrders.size > 0 && (
                  <span className="block mt-2 font-medium text-amber-800">
                    {heldOrders.size === 1 ? '1 held order' : `${heldOrders.size} held orders`} will be cleared.
                  </span>
                )}
              </p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmLogout(false)}
                  className="flex-1 py-3 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">Stay logged in</button>
                <button onClick={() => signOut({ callbackUrl: '/bar' })}
                  className="flex-1 py-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700">Log out</button>
              </div>
            </div>
          </div>
        )}

        {showServerPicker && (
          <ServerPicker
            barPersons={barPersons}
            sessionServers={sessionServers}
            current={volunteer}
            heldTabFor={(u) => heldOrders.has(`staff:${u}`)}
            onChoose={(u) => { switchServer(u); setShowServerPicker(false); }}
            onClose={() => setShowServerPicker(false)}
          />
        )}

        {/* ── VOLUNTEER: opened for a Cash/Card tab, or a Top Up ──────────────── */}
        {view === 'volunteer' && (
          <div className="max-w-3xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {barPersons.map((b) => (
                <button key={b.userName} onClick={() => chooseVolunteer(b.userName)}
                  className={`relative py-4 rounded-xl border-2 font-semibold text-gray-900 hover:shadow-md transition-colors ${
                    b.userName === volunteer ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'
                  }`}>
                  {pendingAction === 'cashcard' && heldOrders.has(`staff:${b.userName}`) && (
                    <span title="Order waiting" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-amber-400" />
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
                className="relative p-4 rounded-xl border-2 border-amber-300 bg-amber-50 text-left hover:border-amber-500 hover:shadow-md transition-colors">
                {volunteer && heldOrders.has(`staff:${volunteer}`) && (
                  <span title="Order waiting" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-amber-500" />
                )}
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
                {categories.filter((c) => c.active).map((c) => (
                  <button key={c.key} onClick={() => setActiveCat(c.key)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                      activeCat === c.key ? categoryColorClasses(c.colorKey).active : categoryColorClasses(c.colorKey).inactive
                    }`}>{c.label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                {products.filter((p) => p.active && !p.variablePrice && p.category === activeCat).map((p) => (
                  <button key={p.id} onClick={() => addToBasket(p)}
                    className={`p-3 rounded-lg border border-gray-200 ${categoryColorFor(p.category, categories)} bg-white text-left hover:border-blue-400 hover:shadow-sm transition-colors`}>
                    <div className="font-medium text-gray-900 text-sm leading-tight">{p.name}</div>
                    <div className="text-gray-600 text-sm">{fmt(unitGrossPrice(p))}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4 h-fit">
              <div className="text-sm font-semibold text-gray-700 mb-2">
                {member ? `Charge to ${member.fullName}` : 'Non-member sale'}
              </div>
              {member && proof && proof.userName === member.userName ? (
                <div className="-mt-1 mb-2 text-xs text-green-700">
                  ✓ {proof.serverApproval ? `Approved by ${barPersonName(volunteer)}` : proof.cardCode ? 'Card scanned' : 'PIN entered'}
                  {proof.cardCode && !offline && (
                    <button onClick={() => setShowSetPin(true)} className="ml-2 text-blue-700 underline">
                      {tillCardFor(member.userName)?.hasPin ? 'Change PIN' : 'Set PIN'}
                    </button>
                  )}
                </div>
              ) : member && tillCardFor(member.userName)?.proofRequired ? (
                <div className="-mt-1 mb-2 text-xs text-gray-600">Card or PIN needed to pay from or top up the account</div>
              ) : null}
              {basket.length === 0 ? <p className="text-gray-400 text-sm py-4">Tap items to add.</p> : (
                <div className="space-y-2">
                  {basket.map((l) => (
                    <div key={l.product.id} className="flex items-center justify-between text-sm">
                      <span className="flex-1 truncate">{l.product.name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => changeQty(l.product.id, -1)} className="w-6 h-6 rounded bg-gray-100">−</button>
                        <span className="w-5 text-center">{l.qty}</span>
                        <button onClick={() => changeQty(l.product.id, 1)} className="w-6 h-6 rounded bg-gray-100">+</button>
                        <span className="w-14 text-right">{fmt(unitGrossPrice(l.product) * l.qty)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 pt-3 border-t">
                {basketDiscount > 0 ? (
                  <>
                    <div className="flex justify-between text-sm text-gray-600">
                      <span>Total</span><span>{fmt(basketGross)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-green-700">
                      <span>Member Discount</span><span>−{fmt(basketDiscount)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-lg mt-1">
                      <span>Payable</span><span>{fmt(basketTotal)}</span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span><span>{fmt(basketTotal)}</span>
                  </div>
                )}
              </div>
              {member && (
                <div className={`text-sm mt-1 ${availableBalancePence < basketTotal ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                  {offline ? (
                    <>Offline balance {fmt(availableBalancePence)} (top-ups made this session only){availableBalancePence < basketTotal ? ' — insufficient' : ''}</>
                  ) : (
                    <>Balance {fmt(availableBalancePence)}{availableBalancePence < basketTotal ? ' — insufficient, top up first' : ''}</>
                  )}
                </div>
              )}

              {/* Action buttons — differ for a member vs a non-member */}
              {member ? (
                <div className="grid grid-cols-3 gap-2 mt-3">
                  <button onClick={openTopUp} disabled={busy}
                    className="py-3 rounded-lg bg-amber-600 text-white font-semibold hover:bg-amber-700 disabled:opacity-50 text-sm">Top Up</button>
                  <button onClick={() => completeSale('wallet')} disabled={busy || basket.length === 0 || availableBalancePence < basketTotal}
                    className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 text-sm">
                    {busy ? 'Saving…' : `Pay by Account`}
                  </button>
                  <button onClick={() => completeSale('card')} disabled={busy || basket.length === 0}
                    className="py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50 text-sm">
                    {busy ? 'Saving…' : `Pay by Card`}
                  </button>
                  {!showRefund ? (
                    <button onClick={() => requireStaff('refund', 'Refund cash', volunteer, () => { setShowRefund(true); setRefundAmt(''); setError(''); })} disabled={offline}
                      className="col-span-3 py-2 text-sm text-red-600 font-medium disabled:opacity-50" title={offline ? 'Refunds need a live connection' : undefined}>Refund cash…</button>
                  ) : (
                    <div className="col-span-3 flex items-center gap-2 flex-wrap pt-1">
                      <span className="text-sm text-gray-600">£</span>
                      <input value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} inputMode="decimal" placeholder="0.00"
                        className="border border-gray-300 rounded px-2 py-1.5 text-sm w-24" />
                      <button onClick={askRefund} disabled={busy} className="px-3 py-1.5 bg-red-600 text-white rounded text-sm font-medium disabled:opacity-50">
                        {busy ? 'Refunding…' : 'Refund cash'}
                      </button>
                      <button onClick={() => { setShowRefund(false); setStaffSession(null); }} className="text-sm text-gray-500">Cancel</button>
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
            </div>
          </div>
        )}

        {/* ── TOP UP ───────────────────────────────────────────────────────── */}
        {view === 'topup' && member && <TopUp member={member} busy={busy} onConfirm={doTopUp} />}

        {/* ── CASH MOVEMENT: cash in/out of the till for a non-sale reason ────── */}
        {view === 'cashmovement' && (
          <CashMovementView categories={categories} products={products} busy={busy} onConfirm={doCashMovement} />
        )}

        {/* ── MEMBERSHIP FEES: a submitted renewal paid in full, card or cash ──── */}
        {view === 'membership' && (
          <MembershipFeesView staff={volunteer} offline={offline} terminalEnabled={terminalEnabled} onDone={() => backToPersonPicker(true)} />
        )}

        {/* ── REPORT ───────────────────────────────────────────────────────── */}
        {view === 'report' && report && (
          <ReportView report={report} submitting={dayEndSubmitting} success={dayEndSuccess} onSubmit={submitDayEnd}
            serverName={barPersonName(volunteer)} onChangeServer={serverLocked ? undefined : () => setShowServerPicker(true)} />
        )}

        {/* ── SALES (void) ─────────────────────────────────────────────────── */}
        {view === 'sales' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-2xl">
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
                            <span className="font-semibold">{fmt(s.totalPence)}</span> · {s.paymentMethod}
                            {s.isCashMovement ? ' · Cash Movement' : (s.memberName ? ` · ${s.memberName}` : ' · visitor')}
                            <span className="text-gray-400"> · {s.items.length} item{s.items.length === 1 ? '' : 's'}</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {new Date(s.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                            {s.staffName ? ` · served by ${s.staffName}` : ''}
                            {s.serverApproved && <span className="text-amber-700 font-medium"> · approved by server (no card/PIN)</span>}
                          </div>
                        </div>
                        {s.voided ? (
                          <span className="text-xs text-red-600 font-medium shrink-0">{s.cardRefunded ? 'Voided · card refunded' : 'Voided'}</span>
                        ) : s.inDayEnd ? null : (
                          <button onClick={() => askVoid(s)} disabled={busy || offline}
                            className="shrink-0 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50">Void</button>
                        )}
                      </div>
                      {expanded && (
                        <div className="pl-4 pb-2 space-y-0.5">
                          {s.reason && <p className="text-xs text-gray-600 italic">Reason: {s.reason}</p>}
                          {s.items.length === 0 ? (
                            <p className="text-xs text-gray-400">No items recorded.</p>
                          ) : s.items.map((it, idx) => (
                            <div key={idx} className="flex justify-between text-xs text-gray-600">
                              <span>{it.qty}× {it.name} @ {fmt(it.unitPricePence)}</span>
                              <span>{fmt(it.unitPricePence * it.qty)}</span>
                            </div>
                          ))}
                          {s.discountPence > 0 && (
                            <div className="flex justify-between text-xs text-green-700 pt-0.5 border-t border-gray-100 mt-1">
                              <span>Total {fmt(s.grossTotalPence)} − Member Discount {fmt(s.discountPence)}</span>
                              <span>{fmt(s.totalPence)}</span>
                            </div>
                          )}
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
        {view === 'products' && <ProductsAdmin products={products} categories={categories} pricingConfig={pricingConfig} onChanged={load} />}
      </div>
    </div>
    </BarHelpContext.Provider>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

const BAR_DEVICE_ID_KEY = 'bar_device_id';
const BAR_PAIRING_CODE_KEY = 'bar_pairing_code';

// /bar's own login — a PIN pad like /kiosk's, but for the dedicated 'bar' till
// account rather than 'clubhouse'. No special PIN mechanism: whatever's typed is
// sent straight through as the password to the same credentials flow every login
// uses (see app/kiosk/page.tsx for the identical pattern). /bar is a public route
// (proxy.ts) so an unauthenticated visit lands here instead of bouncing to /login.
//
// Also generates and registers this device's id/pairing code on first run (kept in
// localStorage across reloads) and sends the id along with every login attempt —
// authorize() (src/lib/auth.ts) rejects a 'Bar' login from an unapproved device. See
// /admin/bar-devices for the approval side.
function BarPinLogin() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const [pairingCode, setPairingCode] = useState('');
  const [registerError, setRegisterError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    let id = localStorage.getItem(BAR_DEVICE_ID_KEY);
    let code = localStorage.getItem(BAR_PAIRING_CODE_KEY);
    if (!id || !code) {
      id = crypto.randomUUID();
      code = String(Math.floor(100000 + Math.random() * 900000));
      localStorage.setItem(BAR_DEVICE_ID_KEY, id);
      localStorage.setItem(BAR_PAIRING_CODE_KEY, code);
    }
    setDeviceId(id); setPairingCode(code);
    fetch('/api/bar/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: id, pairingCode: code }) })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}) as any);
          setRegisterError(data.error || 'Failed to register this device — an admin won’t see it on Bar Till Devices yet.');
        }
      })
      .catch(() => {
        setRegisterError('Could not reach the server to register this device — check the connection and reload.');
      });
  }, []);

  function handlePinChange(value: string) {
    setPin(value.replace(/\D/g, ''));
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pin || !deviceId) return;
    setLoading(true); setError('');
    try {
      const result = await signIn('credentials', { identifier: 'bar', password: pin, deviceId, redirect: false });
      if (result?.error) { setError(result.error); setPin(''); }
      // On success, useSession() picks up the new session and BarTillPage re-renders.
    } catch {
      setError('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-blue-600 flex flex-col items-center justify-center p-4">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Burgess Hill Bowls Club</h1>
        <p className="text-blue-100 text-xl">Bar Till</p>
      </div>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <h2 className="text-2xl font-semibold text-gray-900 text-center mb-6">Enter PIN to Continue</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            value={pin}
            onChange={(e) => handlePinChange(e.target.value)}
            placeholder="••••••"
            maxLength={8}
            autoFocus
            disabled={loading}
            className="w-full text-center text-4xl tracking-[0.5em] py-4 px-6 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50"
          />
          {error && <p className="mt-4 text-center text-red-600 font-medium">{error}</p>}
          <button
            type="submit"
            disabled={loading || !pin}
            className="w-full mt-6 py-4 px-6 text-xl font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Signing in…' : 'Enter'}
          </button>
        </form>
      </div>
      {pairingCode && (
        <p className="mt-8 text-blue-100 text-sm text-center max-w-xs">
          New device pairing code: <span className="font-mono font-semibold text-white">{pairingCode}</span>
          <br />An admin needs to approve this device on Bar Till Devices before it can log in.
        </p>
      )}
      {registerError && (
        <p className="mt-3 text-amber-200 text-sm text-center max-w-xs font-medium">{registerError}</p>
      )}
      <button type="button" onClick={() => setShowHelp(true)} className="mt-6 text-white underline text-sm">Help</button>
      {showHelp && <BarHelpPanel topic="start" onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// A PIN keypad (4 to 6 digits, then OK). Also takes digits, Backspace and Enter typed
// on a keyboard — e.g. a plug-in number keypad facing the member, so the bar staff don't
// see the PIN. Those keys are kept from the browser, where Backspace can go back a page.
function PinPad({ value, onChange, onSubmit, disabled }: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const ready = value.length >= 4;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^\d$/.test(e.key) || e.key === 'Backspace' || e.key === 'Enter') e.preventDefault();
      if (disabled) return;
      if (/^\d$/.test(e.key) && value.length < 6) onChange(value + e.key);
      else if (e.key === 'Backspace') onChange(value.slice(0, -1));
      else if (e.key === 'Enter' && value.length >= 4) onSubmit();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, disabled, onChange, onSubmit]);

  function press(k: string) {
    if (disabled) return;
    if (k === '⌫') onChange(value.slice(0, -1));
    else if (value.length < 6) onChange(value + k);
  }
  return (
    <div>
      <div className="flex justify-center gap-3 my-4 h-4">
        {Array.from({ length: Math.max(4, value.length) }, (_, i) => (
          <span key={i} className={`h-4 w-4 rounded-full border-2 ${i < value.length ? 'bg-gray-900 border-gray-900' : 'border-gray-400'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0'].map((k) => (
          <button key={k} onClick={() => press(k)} disabled={disabled}
            className="py-4 rounded-lg bg-gray-100 text-xl font-medium hover:bg-gray-200 disabled:opacity-50">{k}</button>
        ))}
        <button onClick={onSubmit} disabled={disabled || !ready}
          className="py-4 rounded-lg bg-green-600 text-white text-lg font-semibold hover:bg-green-700 disabled:opacity-50">OK</button>
      </div>
    </div>
  );
}

// One person proving it's them: scan their card, or type their PIN (online only — see
// the header comment). Used for the member, and for the bar person serving.
function PersonProofPanel({ person, card, offline, readScan, onPinLocked, onProven }: {
  person: { userName: string; fullName: string };
  card: TillCard | undefined;
  offline: boolean;
  readScan: (value: string) => Promise<{ person?: BarAccount; proof?: MemberProof; message?: string }>;
  onPinLocked: () => void;
  onProven: (proof: { cardCode?: string; pin?: string }) => void;
}) {
  const [pin, setPin] = useState('');
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [locked, setLocked] = useState(!!card && card.pinLocked);

  const canUsePin = !!card && card.hasPin && !locked && !offline;
  let pinNote = '';
  if (offline) pinNote = 'PINs can’t be checked while the till is offline — scan the card.';
  else if (!card || !card.hasPin) pinNote = `${person.fullName} hasn’t set a PIN yet. They can set one in My Account, or here once their card is scanned.`;
  else if (locked) pinNote = 'The PIN is locked after too many wrong tries — scan the card. A new PIN can then be set.';

  async function checkPin() {
    if (pin.length < 4 || checking) return;
    setChecking(true); setMessage('');
    try {
      const res = await fetch('/api/bar/pin/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: person.userName, pin: pin }) });
      const data = await res.json();
      if (res.ok) { onProven({ pin: pin }); return; }
      if (data.reason === 'locked') { setLocked(true); onPinLocked(); }
      setMessage(data.error || 'PIN check failed');
      setPin('');
    } catch {
      setMessage('Couldn’t check the PIN — check the connection.');
      setPin('');
    } finally {
      setChecking(false);
    }
  }

  async function scanned(value: string) {
    setScanning(false);
    const result = await readScan(value);
    if (result.proof && result.proof.userName === person.userName) { onProven({ cardCode: result.proof.cardCode }); return; }
    if (result.person && result.person.userName !== person.userName) setMessage(`That’s ${result.person.fullName}’s card, not ${person.fullName}’s.`);
    else setMessage(result.message || 'That card can’t be used — try the PIN.');
  }
  useCardScanner(scanned);

  return (
    <>
      <button onClick={() => { setMessage(''); setScanning(true); }}
        className="mt-4 w-full py-3 rounded-lg border-2 border-blue-300 bg-blue-50 text-blue-800 font-semibold hover:bg-blue-100">
        Scan {person.fullName}&apos;s card
      </button>
      {canUsePin ? (
        <PinPad value={pin} onChange={(v) => { setMessage(''); setPin(v); }} onSubmit={checkPin} disabled={checking} />
      ) : (
        <p className="mt-4 text-sm text-gray-700">{pinNote}</p>
      )}
      {message && <p className="mt-3 text-sm text-red-600 font-medium text-center">{message}</p>}
      {scanning && <QrScanModal title={`Scan ${person.fullName}’s card`} onScan={scanned} onClose={() => setScanning(false)} />}
    </>
  );
}

// Pay by Account / Top Up for a member who must prove they're here: their card or PIN —
// or, if they can't (forgotten card, no PIN), the bar person serving approves it with
// their own card or PIN, which is logged against the sale.
function ProofDialog({ member, server, cards, purpose, offline, readScan, onPinLocked, onProven, onClose }: {
  member: BarAccount;
  server: { userName: string; fullName: string } | null;
  cards: TillCard[];
  purpose: 'pay' | 'topup';
  offline: boolean;
  readScan: (value: string) => Promise<{ person?: BarAccount; proof?: MemberProof; message?: string }>;
  onPinLocked: (userName: string) => void;
  onProven: (proof: MemberProof) => void;
  onClose: () => void;
}) {
  const [byServer, setByServer] = useState(false);
  const who = byServer && server ? server : member;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <BarHelpLink topic={byServer ? 'staffproof' : 'proof'} className="absolute top-3 right-3" />
        <h2 className="text-lg font-bold text-gray-900 text-center">
          {byServer ? `${who.fullName} to approve` : 'Card or PIN needed'}
        </h2>
        <p className="text-sm text-gray-700 text-center mt-1">
          {byServer
            ? `${who.fullName}, scan your card or enter your PIN to ${purpose === 'pay' ? 'charge' : 'top up'} ${member.fullName}'s account. It's recorded as approved by you.`
            : `To ${purpose === 'pay' ? 'pay from' : 'top up'} ${member.fullName}'s account, scan their membership card or enter their PIN.`}
        </p>
        <PersonProofPanel
          key={who.userName}
          person={who}
          card={cards.find((c) => c.userName === who.userName)}
          offline={offline}
          readScan={readScan}
          onPinLocked={() => onPinLocked(who.userName)}
          onProven={(p) => onProven(byServer
            ? { userName: member.userName, serverApproval: p }
            : { userName: member.userName, cardCode: p.cardCode, pin: p.pin })}
        />
        {server && server.userName !== member.userName && (
          <button onClick={() => setByServer(!byServer)}
            className="mt-4 w-full py-2 text-sm text-blue-700 underline">
            {byServer ? `Back to ${member.fullName}'s card or PIN` : `No card or PIN? ${server.fullName} (serving) can approve it`}
          </button>
        )}
        <button onClick={onClose} className="mt-3 w-full py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Day End, Void, Refund or Cash Movement: the bar person serving confirms it's them with
// their own card or PIN, every time (when the bar_staff_proof setting says they must).
function StaffProofDialog({ server, card, action, offline, readScan, onPinLocked, onProven, onClose }: {
  server: { userName: string; fullName: string };
  card: TillCard | undefined;
  action: string;
  offline: boolean;
  readScan: (value: string) => Promise<{ person?: BarAccount; proof?: MemberProof; message?: string }>;
  onPinLocked: () => void;
  onProven: (proof: { cardCode?: string; pin?: string }) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <BarHelpLink topic="staffproof" className="absolute top-3 right-3" />
        <h2 className="text-lg font-bold text-gray-900 text-center">{action}</h2>
        <p className="text-sm text-gray-700 text-center mt-1">
          {server.fullName} is serving — {server.fullName}, scan your card or enter your PIN to confirm.
          If someone else is doing this, change who&apos;s serving first.
        </p>
        <PersonProofPanel person={server} card={card} offline={offline} readScan={readScan} onPinLocked={onPinLocked} onProven={onProven} />
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </div>
  );
}

// Set (or change) a member's PIN at the till — only offered once their card has been
// scanned, which is the proof it's really them (see /api/bar/pin/set).
function SetPinDialog({ member, cardCode, onDone, onClose }: {
  member: BarAccount;
  cardCode: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit() {
    if (pin.length < 4 || saving) return;
    if (first === null) { setFirst(pin); setPin(''); return; }
    if (pin !== first) { setMessage('The PINs didn’t match — start again.'); setFirst(null); setPin(''); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/bar/pin/set', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: member.userName, cardCode: cardCode, pin: pin }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to set the PIN');
      setSaved(true);
      onDone();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to set the PIN');
      setFirst(null); setPin('');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <BarHelpLink topic="pins" className="absolute top-3 right-3" />
        <h2 className="text-lg font-bold text-gray-900 text-center">PIN for {member.fullName}</h2>
        {saved ? (
          <p className="mt-3 text-sm text-gray-900 text-center">PIN saved. {member.fullName} can use it at the bar instead of their card.</p>
        ) : (
          <>
            <p className="text-sm text-gray-700 text-center mt-1">
              {first === null ? 'Ask the member to enter a new PIN (4 to 6 digits), then OK.' : 'Enter the same PIN again, then OK.'}
            </p>
            <PinPad value={pin} onChange={(v) => { setMessage(''); setPin(v); }} onSubmit={submit} disabled={saving} />
            {message && <p className="mt-3 text-sm text-red-600 font-medium text-center">{message}</p>}
          </>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">
          {saved ? 'Done' : 'Cancel'}
        </button>
      </div>
    </div>
  );
}

// Change who's serving: this session's servers as big one-tap buttons, and
// "+ Someone else" expanding the same dialog to the rest of the bar people.
function ServerPicker({ barPersons, sessionServers, current, heldTabFor, onChoose, onClose }: {
  barPersons: BarPerson[];
  sessionServers: string[];
  current: string;
  heldTabFor: (userName: string) => boolean;
  onChoose: (userName: string) => void;
  onClose: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const session: BarPerson[] = [];
  for (const u of sessionServers) {
    const found = barPersons.find((b) => b.userName === u);
    if (found) session.push(found);
  }
  const others = barPersons.filter((b) => !sessionServers.includes(b.userName));

  const nameButton = (b: BarPerson, big: boolean) => (
    <button key={b.userName} onClick={() => onChoose(b.userName)}
      className={`relative ${big ? 'py-6 text-lg' : 'py-4'} rounded-xl border-2 font-semibold text-gray-900 hover:shadow-md transition-colors ${
        b.userName === current ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50' : 'border-gray-300 bg-white hover:border-blue-400'
      }`}>
      {heldTabFor(b.userName) && (
        <span title="Cash/Card order waiting" className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-amber-500" />
      )}
      {b.fullName}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="text-lg font-bold text-gray-900">Who&apos;s serving?</h2>
          <BarHelpLink topic="servers" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {session.map((b) => nameButton(b, true))}
        </div>
        {!showAll && others.length > 0 && (
          <button onClick={() => setShowAll(true)}
            className="mt-3 w-full py-4 rounded-xl border-2 border-dashed border-gray-300 text-gray-700 font-medium hover:border-blue-400 hover:text-blue-800">
            + Someone else
          </button>
        )}
        {showAll && (
          <div className="mt-4 pt-4 border-t">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {others.map((b) => nameButton(b, false))}
            </div>
          </div>
        )}
        <button onClick={onClose} className="mt-4 w-full py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
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
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[10, 20, 50].map((v) => (
          <button key={v} onClick={() => {
            const currentPence = Math.round(parseFloat(amount || '0') * 100);
            setAmount(String((currentPence + v * 100) / 100));
          }} className="py-2 rounded-lg bg-gray-100 font-medium">+£{v}</button>
        ))}
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

// Cash added to or removed from the till for a non-sale reason. The product picked
// (a variable_price product -- see 0064_bar_cash_movements.sql) supplies the nominal
// code; the amount and reason are entered fresh each time.
// Membership fees (renewals spec §8.1): find a member whose submitted renewal still owes
// something, take the full amount due by card or cash, and record it. Card is taken
// on the card machine first, then confirmed here. Needs to be online — the amount due
// is checked against the database when it's recorded.
interface TillRenewalDue {
  userName: string;
  fullName: string;
  membershipFee: number;
  competitionsFee: number;
  club200Fee: number;
  totalFee: number;
  outstanding: number;
}

// Confirm a void, saying what happens to the money for this kind of sale, then the result.
function VoidSaleDialog({ sale, done, error, busy, onConfirm, onClose }: {
  sale: BarSaleSummary; done: string | null; error: string | null; busy: boolean; onConfirm: () => void; onClose: () => void;
}) {
  let effect = '';
  if (sale.isCashMovement) {
    effect = 'The cash movement is cancelled — put the cash back as it was.';
  } else if (sale.paymentMethod === 'wallet') {
    effect = `${fmt(sale.totalPence)} goes back on ${sale.memberName || 'the member'}’s account.`;
  } else if (sale.paymentMethod === 'cash') {
    effect = `Hand ${fmt(sale.totalPence)} cash back to the customer if they’ve paid. Nothing else changes.`;
  } else if (sale.onTerminal) {
    effect = `${fmt(sale.totalPence)} is refunded to the customer’s card through Square straight away.`;
  } else {
    effect = `This card payment wasn’t taken through the till, so it isn’t refunded automatically. Refund ${fmt(sale.totalPence)} on the Terminal or in the Square Dashboard.`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
        <BarHelpLink topic="mistakes" className="absolute top-3 right-3" />
        {done ? (
          <>
            <p className="text-lg font-semibold text-gray-900">Voided</p>
            <p className="mt-2 text-sm text-gray-900">{done}</p>
            <button onClick={onClose} className="mt-5 w-full py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">OK</button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-700">Void this sale?</p>
            <p className="text-4xl font-bold text-gray-900 my-2">{fmt(sale.totalPence)}</p>
            <p className="text-sm text-gray-700">
              {sale.paymentMethod}{sale.memberName ? ` · ${sale.memberName}` : ''} ·{' '}
              {new Date(sale.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className="mt-3 text-sm text-gray-900 text-left">{effect}</p>
            {error && <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-sm text-left">{error}</div>}
            <div className="mt-5 flex flex-col gap-2">
              <button onClick={onConfirm} disabled={busy} className="py-3 rounded-lg bg-red-600 text-white font-semibold hover:bg-red-700 disabled:opacity-50">
                {busy ? 'Voiding…' : 'Void sale'}
              </button>
              <button onClick={onClose} disabled={busy} className="py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50">
                Keep it
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Pops up when Cash is pressed — it's easy to hit Cash instead of Card, so staff confirm,
// and can enter what they were handed to see the change. The tendered amount is only a
// helper on screen; nothing about it is stored.
function CashChangeDialog({ amountPence, onConfirm, onCancel }: { amountPence: number; onConfirm: () => void; onCancel: () => void }) {
  const [tendered, setTendered] = useState('');

  const notes = [500, 1000, 2000, 5000];
  const quick: number[] = [];
  for (const n of notes) {
    if (n > amountPence) quick.push(n);
  }

  let tenderedPence: number | null = null;
  if (tendered.trim() !== '') {
    const value = Math.round(parseFloat(tendered) * 100);
    if (Number.isFinite(value) && value > 0) tenderedPence = value;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-xl">
        <BarHelpLink topic="paying" className="absolute top-3 right-3" />
        <p className="text-sm text-gray-700">Cash payment</p>
        <p className="text-4xl font-bold text-gray-900 my-2">{fmt(amountPence)}</p>

        <p className="mt-3 text-sm text-gray-900 text-left">Cash handed over (optional):</p>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {quick.map((n) => (
            <button key={n} onClick={() => setTendered((n / 100).toFixed(2))}
              className={`py-2 rounded-lg border text-sm font-semibold ${tenderedPence === n ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'}`}>
              {fmt(n).replace('.00', '')}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-gray-900">£</span>
          <input type="number" inputMode="decimal" min="0" step="0.01" value={tendered} placeholder="Other amount"
            onChange={(e) => setTendered(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
        </div>

        {tenderedPence !== null && (
          tenderedPence >= amountPence ? (
            <div className="mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
              <p className="text-sm text-gray-900">Change to give</p>
              <p className="text-3xl font-bold text-green-800">{fmt(tenderedPence - amountPence)}</p>
            </div>
          ) : (
            <div className="mt-3 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
              <p className="font-semibold">Short by {fmt(amountPence - tenderedPence)}</p>
            </div>
          )
        )}

        <div className="mt-5 flex flex-col gap-2">
          <button onClick={onConfirm} className="py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700">
            Cash taken — record it
          </button>
          <button onClick={onCancel} className="py-2 rounded-lg border border-gray-300 bg-white font-medium text-gray-900 hover:bg-gray-50">
            Cancel — not cash
          </button>
        </div>
      </div>
    </div>
  );
}

function MembershipFeesView({ staff, offline, terminalEnabled, onDone }: { staff: string; offline: boolean; terminalEnabled: boolean; onDone: () => void }) {
  const [due, setDue] = useState<TillRenewalDue[] | null>(null);
  // With a Terminal paired, card goes to the Terminal; manualCard = taken on its keypad
  // instead, confirmed with the tick box as before.
  const [manualCard, setManualCard] = useState(false);
  const [terminalCheckout, setTerminalCheckout] = useState<TerminalCheckout | null>(null);
  const [terminalNotice, setTerminalNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TillRenewalDue | null>(null);
  const [method, setMethod] = useState<'card' | 'cash' | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [paid, setPaid] = useState<{ name: string; amount: number; method: 'card' | 'cash' } | null>(null);

  const load = useCallback(() => {
    setLoadError('');
    fetch('/api/bar/membership-fees')
      .then((r) => r.json())
      .then((data) => {
        if (data.renewals) setDue(data.renewals);
        else setLoadError(data.error || 'Could not load membership fees');
      })
      .catch(() => setLoadError('Could not load membership fees'));
  }, []);
  useEffect(() => { load(); }, [load]);

  function choose(r: TillRenewalDue) {
    setSelected(r); setMethod(null); setConfirmed(false); setSaveError(''); setManualCard(false);
  }

  const useTerminal = method === 'card' && terminalEnabled && !manualCard;

  async function sendToTerminal() {
    if (!selected) return;
    setSaving(true); setSaveError(''); setTerminalNotice('');
    try {
      const res = await fetch('/api/bar/square', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'membership', userName: selected.userName, expectedPence: Math.round(selected.outstanding * 100), staff }),
      });
      const data = await res.json();
      if (res.status === 409 && data.checkout) {
        setTerminalNotice('The Terminal was already waiting for this payment — finish or cancel it, then try again.');
        setTerminalCheckout(data.checkout);
        return;
      }
      if (!res.ok) {
        setSaveError(data.error || 'Could not send the payment to the Terminal');
        load();
        return;
      }
      setTerminalCheckout(data.checkout);
    } catch {
      setSaveError('Could not reach the Terminal — check the connection and try again');
    } finally {
      setSaving(false);
    }
  }

  function terminalPaid(c: TerminalCheckout) {
    setTerminalCheckout(null);
    if (terminalNotice) {
      // It was a different payment the Terminal was finishing — just refresh
      setTerminalNotice('');
      load();
      return;
    }
    if (selected) setPaid({ name: selected.fullName, amount: c.amountPence / 100, method: 'card' });
    setSelected(null);
    load();
  }

  async function record() {
    if (!selected || !method || !confirmed) return;
    setSaving(true); setSaveError('');
    try {
      const res = await fetch('/api/bar/membership-fees', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: selected.userName, method, amountPence: Math.round(selected.outstanding * 100),
          staff, confirmed: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || 'Could not record the payment');
        // The amount may have changed (e.g. a bank transfer was matched) — refresh it
        load();
        return;
      }
      setPaid({ name: selected.fullName, amount: selected.outstanding, method });
      setSelected(null);
      load();
    } catch {
      setSaveError('Could not record the payment — check the connection and try again');
    } finally {
      setSaving(false);
    }
  }

  const pounds = (n: number) => `£${n.toFixed(2)}`;

  if (paid) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-lg">
        <div className="p-4 bg-green-50 border border-green-200 text-green-900 rounded-lg">
          <p className="font-semibold">Membership paid — {paid.name}</p>
          <p className="text-sm mt-1">{pounds(paid.amount)} {paid.method === 'card' ? 'by card' : 'in cash'}. It shows as paid on their renewal straight away.</p>
          {paid.method === 'cash' && <p className="text-sm mt-1">Put the cash in the till — it&apos;s included in the Dayend&apos;s expected cash.</p>}
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={() => setPaid(null)} className="flex-1 py-3 rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50">Another member</button>
          <button onClick={onDone} className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">Done</button>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-lg">
        <div className="text-lg font-semibold text-gray-900">{selected.fullName}</div>
        <div className="mt-3 space-y-1 text-sm text-gray-700">
          {selected.membershipFee > 0 && <div className="flex justify-between"><span>Membership</span><span>{pounds(selected.membershipFee)}</span></div>}
          {selected.competitionsFee > 0 && <div className="flex justify-between"><span>Competitions</span><span>{pounds(selected.competitionsFee)}</span></div>}
          {selected.club200Fee > 0 && <div className="flex justify-between"><span>200 Club</span><span>{pounds(selected.club200Fee)}</span></div>}
          {selected.outstanding !== selected.totalFee && (
            <div className="flex justify-between"><span>Already paid / adjusted</span><span>{pounds(selected.totalFee - selected.outstanding)}</span></div>
          )}
          <div className="flex justify-between font-bold text-lg text-gray-900 border-t pt-2 mt-2"><span>Amount due</span><span>{pounds(selected.outstanding)}</span></div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-5">
          <button onClick={() => { setMethod('card'); setConfirmed(false); setManualCard(false); }}
            className={`py-3 rounded-lg font-semibold border ${method === 'card' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-900 border-gray-300 hover:bg-gray-50'}`}>Card</button>
          <button onClick={() => { setMethod('cash'); setConfirmed(false); }}
            className={`py-3 rounded-lg font-semibold border ${method === 'cash' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-900 border-gray-300 hover:bg-gray-50'}`}>Cash</button>
        </div>

        {terminalCheckout && (
          <BarTerminalPayment
            key={terminalCheckout.id}
            checkout={terminalCheckout}
            notice={terminalNotice || undefined}
            onPaid={terminalPaid}
            onCancelled={() => { setTerminalCheckout(null); setTerminalNotice(''); }}
            onManual={terminalNotice ? undefined : () => { setTerminalCheckout(null); setManualCard(true); setConfirmed(false); }}
          />
        )}

        {useTerminal && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-gray-900">
            <p><strong>{pounds(selected.outstanding)}</strong> will be sent to the Square Terminal for the member to pay.</p>
            <button type="button" onClick={() => { setManualCard(true); setConfirmed(false); }} className="mt-1 text-gray-700 underline">
              Taken on the Terminal&apos;s keypad instead…
            </button>
          </div>
        )}

        {method && !useTerminal && (
          <label className="flex items-start gap-3 mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-5 w-5" />
            <span className="text-sm text-gray-900">
              {method === 'card'
                ? <>Payment of <strong>{pounds(selected.outstanding)}</strong> taken on the card machine</>
                : <><strong>{pounds(selected.outstanding)}</strong> cash received and put in the till</>}
            </span>
          </label>
        )}

        {saveError && <div className="mt-3 p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{saveError}</div>}

        <div className="mt-4 flex gap-3">
          <button onClick={() => setSelected(null)} disabled={saving} className="flex-1 py-3 rounded-lg border border-gray-300 bg-white font-medium hover:bg-gray-50 disabled:opacity-50">Back</button>
          {useTerminal ? (
            <button onClick={sendToTerminal} disabled={saving || offline}
              className="flex-1 py-3 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Sending…' : 'Send to Terminal'}
            </button>
          ) : (
            <button onClick={record} disabled={saving || offline || !method || !confirmed}
              className="flex-1 py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50">
              {saving ? 'Recording…' : 'Record payment'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Member search — matches anywhere in the name or username
  const term = search.trim().toLowerCase();
  const matches: TillRenewalDue[] = [];
  if (due) {
    for (const r of due) {
      if (term === '' || r.fullName.toLowerCase().includes(term) || r.userName.toLowerCase().includes(term)) {
        matches.push(r);
      }
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-lg">
      <p className="text-sm text-gray-700 mb-3">Members with a submitted renewal still to pay. Full amount only — part payments go through the Treasurer.</p>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name"
        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base mb-3"
        autoFocus
      />
      {loadError && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded text-sm">{loadError}</div>}
      {!loadError && due === null && <p className="text-sm text-gray-700">Loading…</p>}
      {due !== null && matches.length === 0 && (
        <p className="text-sm text-gray-700">{due.length === 0 ? 'Nobody has a membership fee to pay.' : 'No match — their renewal may not be submitted yet, or is already paid.'}</p>
      )}
      <div className="divide-y divide-gray-100 max-h-[60vh] overflow-y-auto">
        {matches.map((r) => (
          <button key={r.userName} onClick={() => choose(r)} className="w-full flex justify-between items-center py-3 px-1 text-left hover:bg-gray-50">
            <span className="text-gray-900">{r.fullName}</span>
            <span className="font-semibold text-gray-900">{pounds(r.outstanding)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CashMovementView({ categories, products, busy, onConfirm }: {
  categories: BarCategoryRow[];
  products: BarProduct[];
  busy: boolean;
  onConfirm: (productId: string, amountPence: number, direction: 'in' | 'out', reason: string) => void;
}) {
  const movementProducts = products.filter((p) => p.active && p.variablePrice);
  const movementCategories = categories.filter((c) => c.active && movementProducts.some((p) => p.category === c.key));
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [category, setCategory] = useState(movementCategories.length > 0 ? movementCategories[0].key : '');
  const productsInCategory = movementProducts.filter((p) => p.category === category);
  const [productId, setProductId] = useState(productsInCategory.length > 0 ? productsInCategory[0].id : '');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  // Keep the product selection valid as the category changes — during render, not
  // an effect (React's "adjusting state" pattern, same as ReportView above).
  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    setProductId(productsInCategory.length > 0 ? productsInCategory[0].id : '');
  }

  const pence = Math.round(parseFloat(amount || '0') * 100);
  const canSubmit = productId !== '' && pence > 0 && reason.trim() !== '';

  if (movementProducts.length === 0) {
    return (
      <div className="max-w-sm mx-auto bg-white border border-gray-200 rounded-xl p-5 text-sm text-gray-600">
        No Cash Movement products set up yet. Add one on the Products screen using the Variable price option.
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex gap-2">
        <button onClick={() => setDirection('in')}
          className={`flex-1 py-2 rounded-lg font-medium ${direction === 'in' ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700'}`}>Cash In</button>
        <button onClick={() => setDirection('out')}
          className={`flex-1 py-2 rounded-lg font-medium ${direction === 'out' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700'}`}>Cash Out</button>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Product group</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-2 text-sm">
          {movementCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Product</label>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-2 text-sm">
          {productsInCategory.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Amount</label>
        <div className="flex items-center gap-2">
          <span className="text-gray-600">£</span>
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
          />
        </div>
      </div>
      <div>
        <label className="block text-sm text-gray-700 mb-1">Reason</label>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. paid milk delivery driver"
          className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
        />
      </div>
      <button
        onClick={() => onConfirm(productId, pence, direction, reason.trim())}
        disabled={busy || !canSubmit}
        className={`w-full py-3 rounded-lg text-white font-semibold disabled:opacity-50 ${direction === 'in' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}
      >
        {busy ? 'Saving…' : `${direction === 'in' ? 'Add' : 'Remove'} £${(pence / 100).toFixed(2)}`}
      </button>
    </div>
  );
}

type DrillKind = 'wallet_sales' | 'card_sales' | 'cash_sales' | 'cash_movements' | 'cash_topups' | 'card_topups' | 'refunds' | 'renewal_cash' | 'renewal_card';

function ReportView({ report, submitting, success, onSubmit, serverName, onChangeServer }: { report: BarReport; submitting: boolean; success: BarDayEnd | null; onSubmit: (cashRemovedPence: number, carryForward: boolean, reason: string) => void; serverName: string; onChangeServer?: () => void }) {
  // Default suggests removing everything expected, but never a negative amount —
  // you can't physically remove negative cash (see the -£5 expected example: the
  // suggestion there is £0, not "-£5.00").
  const [cashRemoved, setCashRemoved] = useState(() => (Math.max(0, report.expectedCashPence) / 100).toFixed(2));
  const [carryForward, setCarryForward] = useState(false);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [expanded, setExpanded] = useState<DrillKind | null>(null);
  const [drillSales, setDrillSales] = useState<BarSaleSummary[] | null>(null);
  const [drillLedger, setDrillLedger] = useState<BarDayEndLedgerRow[] | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  // Re-sync the default when the report changes underneath us (e.g. a fresh
  // sale lands) as long as the bar person hasn't started editing it, and
  // reset back to untouched once a day end has just been recorded — done
  // during render (not an effect) per React's "adjusting state" pattern.
  const [prevExpected, setPrevExpected] = useState(report.expectedCashPence);
  if (!touched && report.expectedCashPence !== prevExpected) {
    setPrevExpected(report.expectedCashPence);
    setCashRemoved((Math.max(0, report.expectedCashPence) / 100).toFixed(2));
  }
  const [prevSuccess, setPrevSuccess] = useState(success);
  if (success !== prevSuccess) {
    setPrevSuccess(success);
    if (success) { setTouched(false); setCarryForward(false); setReason(''); setExpanded(null); }
  }
  const cashRemovedPence = Math.round(parseFloat(cashRemoved || '0') * 100);
  // Signed: positive means more was left in the till than removed, negative means
  // more was removed than the books say was there (e.g. topping up the float from
  // personal cash, or a pre-existing shortfall) — carrying forward works either way.
  const difference = report.expectedCashPence - cashRemovedPence;
  const differs = difference !== 0;
  const reasonRequired = differs && !carryForward;

  async function toggleExpand(kind: DrillKind) {
    if (expanded === kind) { setExpanded(null); return; }
    setExpanded(kind);
    setDrillSales(null); setDrillLedger(null); setDrillLoading(true);
    try {
      const res = await fetch(`/api/bar/report/transactions?kind=${kind}`);
      const data = await res.json();
      if (data.sales) setDrillSales(data.sales);
      if (data.ledger) setDrillLedger(data.ledger);
    } finally {
      setDrillLoading(false);
    }
  }

  const row = (label: string, pence: number, kind?: DrillKind, strong = false) => (
    <div>
      <div
        className={`flex justify-between py-1.5 ${strong ? 'font-bold text-lg border-t mt-1 pt-2' : 'text-sm'} ${kind ? 'cursor-pointer hover:bg-gray-50 rounded px-1 -mx-1' : ''}`}
        onClick={kind ? () => toggleExpand(kind) : undefined}
      >
        <span className={kind ? 'text-blue-700 underline decoration-dotted' : ''}>{label}</span>
        <span>{fmt(pence)}</span>
      </div>
      {kind && expanded === kind && (
        <div className="mt-2 mb-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
          {drillLoading && <p className="text-xs text-gray-500">Loading…</p>}
          {!drillLoading && drillSales && <DrillSalesTable sales={drillSales} />}
          {!drillLoading && drillLedger && <DrillLedgerTable ledger={drillLedger} />}
          {!drillLoading && !drillSales && !drillLedger && <p className="text-xs text-gray-500">No transactions.</p>}
        </div>
      )}
    </div>
  );

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-lg">
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 text-green-800 rounded text-sm">
          Day end recorded — {fmt(success.cashRemovedPence)} removed, float {fmt(success.floatPence)} left in the till.
          {success.carriedForward && success.carriedOutPence !== 0 && (
            <> {fmt(success.carriedOutPence)} carried forward to next time.</>
          )}
        </div>
      )}
      <p className="text-xs text-gray-500 mb-4">Since the last cash-up — {report.salesCount} sales</p>

      {report.carriedForwardPence !== 0 && row('Brought forward from last cash-up', report.carriedForwardPence)}
      {row('Member Account Top-ups (cash)', report.topupsPence, 'cash_topups')}
      {row('Cash Sales', report.cashSalesPence, 'cash_sales')}
      {report.cashMovementsPence !== 0 && row('Cash Movements', report.cashMovementsPence, 'cash_movements')}
      {report.renewalCashPence !== 0 && row('Membership fees (cash)', report.renewalCashPence, 'renewal_cash')}
      {row('Refunds paid out (cash)', report.refundsPence, 'refunds')}
      {row('Expected cash in till', report.expectedCashPence, undefined, true)}

      <div className="mt-5 pt-4 border-t space-y-3">
        <div>
          <label className="block text-sm text-gray-700 mb-1">Cash removed from till</label>
          <div className="flex items-center gap-2">
            <span className="text-gray-600">£</span>
            <input
              value={cashRemoved}
              onChange={(e) => { setCashRemoved(e.target.value); setTouched(true); }}
              inputMode="decimal"
              className="border border-gray-300 rounded px-2 py-1.5 text-sm w-28"
            />
          </div>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-700">Difference</span>
          <span className={differs ? (difference > 0 ? 'text-amber-700 font-medium' : 'text-red-700 font-medium') : 'text-gray-500'}>
            {fmt(difference)}
          </span>
        </div>
        {differs && (
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={carryForward} onChange={(e) => setCarryForward(e.target.checked)} />
            Carry difference forward to next cash-up
          </label>
        )}
        {differs && (
          <div>
            <label className="block text-sm text-gray-700 mb-1">Reason for difference{carryForward ? ' (optional)' : ''}</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={carryForward ? 'e.g. Not cashed up' : 'e.g. till float short at start of shift'}
              className="w-full border border-gray-300 rounded px-2 py-1.5 text-sm"
            />
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-gray-700">Cashing up</span>
          <span>
            <span className="font-medium text-gray-900">{serverName}</span>{' '}
            {onChangeServer && <button onClick={onChangeServer} className="text-blue-700 underline">Change</button>}
          </span>
        </div>
        <button
          onClick={() => onSubmit(cashRemovedPence, carryForward, reason)}
          disabled={submitting || cashRemovedPence < 0 || (reasonRequired && reason.trim() === '')}
          className="w-full py-3 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Confirm Day End'}
        </button>
      </div>

      <div className="mt-5 pt-4 border-t">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">For completeness</h3>
        {row('Member Account Sales', report.byMethodPence.wallet, 'wallet_sales')}
        {row('Card Sales', report.byMethodPence.card, 'card_sales')}
        {row('Member Account Top-ups (by card)', report.cardTopupsPence, 'card_topups')}
        {report.renewalCardPence !== 0 && row('Membership fees (by card)', report.renewalCardPence, 'renewal_card')}
        {(report.renewalCashPence !== 0 || report.renewalCardPence !== 0) && (
          <p className="text-xs text-gray-700 mt-2">Membership fees go in the renewals journal, not the bar journal.</p>
        )}
      </div>
    </div>
  );
}

function DrillSalesTable({ sales }: { sales: BarSaleSummary[] }) {
  if (sales.length === 0) return <p className="text-xs text-gray-500">No sales.</p>;
  return (
    <div className="space-y-1">
      {sales.map((s) => (
        <div key={s.id} className="flex justify-between text-xs text-gray-700">
          <span>
            {new Date(s.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            {' — '}
            {s.isCashMovement ? `Cash Movement — ${s.reason}` : `${s.memberName || 'Visitor'} — ${s.items.map((i) => `${i.name} ×${i.qty}`).join(', ')}`}
          </span>
          <span className="font-medium">{fmt(s.totalPence)}</span>
        </div>
      ))}
    </div>
  );
}

function DrillLedgerTable({ ledger }: { ledger: BarDayEndLedgerRow[] }) {
  if (ledger.length === 0) return <p className="text-xs text-gray-500">No transactions.</p>;
  return (
    <div className="space-y-1">
      {ledger.map((l) => (
        <div key={l.id} className="flex justify-between text-xs text-gray-700">
          <span>
            {new Date(l.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            {' — '}{l.memberName}{l.staff ? ` (staff: ${l.staff})` : ''}
          </span>
          <span className="font-medium">{fmt(l.amountPence)}</span>
        </div>
      ))}
    </div>
  );
}

// Product form fields shown depend on the active pricing mode: Split needs two
// independent prices; the other three modes need one price, and Member Product
// Discount additionally takes an optional per-product override (blank = inherit
// the global default from /admin/config's Bar tab).
function ProductsAdmin({ products, categories, pricingConfig, onChanged }: { products: BarProduct[]; categories: BarCategoryRow[]; pricingConfig: BarPricingConfig; onChanged: () => void }) {
  const isSplit = pricingConfig.mode === 'split';
  const showOverride = pricingConfig.mode === 'member_product_discount';
  const activeCategories = categories.filter((c) => c.active);
  const firstCategoryKey = activeCategories.length > 0 ? activeCategories[0].key : '';

  const [name, setName] = useState('');
  const [category, setCategory] = useState(firstCategoryKey);
  const [price, setPrice] = useState('');           // base/single price, or split member price
  const [visitorPrice, setVisitorPrice] = useState(''); // split mode only
  const [override, setOverride] = useState('');      // member_product_discount mode only
  const [nominalCode, setNominalCode] = useState('');
  const [variablePrice, setVariablePrice] = useState(false); // Cash Movement: amount entered per-transaction
  async function add() {
    if (!name.trim()) return;
    if (variablePrice) {
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, variablePrice: true, nominalCode: nominalCode || undefined }) });
    } else if (isSplit) {
      const pricePence = Math.round(parseFloat(price || '0') * 100);
      const nonMemberPricePence = Math.round(parseFloat(visitorPrice || '0') * 100);
      if (pricePence <= 0 || nonMemberPricePence <= 0) return;
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, pricePence, nonMemberPricePence, nominalCode: nominalCode || undefined }) });
    } else {
      const pricePence = Math.round(parseFloat(price || '0') * 100);
      if (pricePence <= 0) return;
      const overridePercent = override.trim() === '' ? undefined : Math.round(parseFloat(override));
      if (overridePercent !== undefined && (overridePercent < 0 || overridePercent > 100)) return;
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, basePricePence: pricePence, memberDiscountOverridePercent: showOverride ? overridePercent : undefined, nominalCode: nominalCode || undefined }) });
    }
    setName(''); setPrice(''); setVisitorPrice(''); setOverride(''); setNominalCode(''); setVariablePrice(false); onChanged();
  }
  async function toggle(p: BarProduct) {
    await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, setActive: !p.active }) });
    onChanged();
  }

  // Inline edit of an existing product
  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState('');
  const [eCat, setECat] = useState('');
  const [ePrice, setEPrice] = useState('');
  const [eVisitorPrice, setEVisitorPrice] = useState('');
  const [eOverride, setEOverride] = useState('');
  const [eNominalCode, setENominalCode] = useState('');
  const [eVariablePrice, setEVariablePrice] = useState(false);
  function startEdit(p: BarProduct) {
    setEditId(p.id); setEName(p.name); setECat(p.category);
    setEPrice(((isSplit ? p.pricePence : p.basePricePence) / 100).toFixed(2));
    setEVisitorPrice((p.nonMemberPricePence / 100).toFixed(2));
    setEOverride(p.memberDiscountOverridePercent === null ? '' : String(p.memberDiscountOverridePercent));
    setENominalCode(p.nominalCode === null ? '' : p.nominalCode);
    setEVariablePrice(p.variablePrice);
  }
  async function saveEdit(p: BarProduct) {
    if (!eName.trim()) return;
    if (eVariablePrice) {
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, variablePrice: true, nominalCode: eNominalCode || null }) });
    } else if (isSplit) {
      const pricePence = Math.round(parseFloat(ePrice || '0') * 100);
      const nonMemberPricePence = Math.round(parseFloat(eVisitorPrice || '0') * 100);
      if (pricePence <= 0 || nonMemberPricePence <= 0) return;
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, pricePence, nonMemberPricePence, variablePrice: false, nominalCode: eNominalCode || null }) });
    } else {
      const pricePence = Math.round(parseFloat(ePrice || '0') * 100);
      if (pricePence <= 0) return;
      const overridePercent = eOverride.trim() === '' ? null : Math.round(parseFloat(eOverride));
      if (overridePercent !== null && (overridePercent < 0 || overridePercent > 100)) return;
      await fetch('/api/bar/products', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, name: eName.trim(), category: eCat, basePricePence: pricePence, memberDiscountOverridePercent: showOverride ? overridePercent : undefined, variablePrice: false, nominalCode: eNominalCode || null }) });
    }
    setEditId(null); onChanged();
  }

  // ── Manage Categories ────────────────────────────────────────────────────
  const [newCatKey, setNewCatKey] = useState('');
  const [newCatLabel, setNewCatLabel] = useState('');
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLOR_KEYS[0]);
  const [newCatNominal, setNewCatNominal] = useState('');
  async function addCategory() {
    const key = newCatKey.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!key || !newCatLabel.trim()) return;
    await fetch('/api/bar/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, label: newCatLabel.trim(), colorKey: newCatColor, nominalCode: newCatNominal || undefined, isNew: true }) });
    setNewCatKey(''); setNewCatLabel(''); setNewCatNominal(''); onChanged();
  }
  async function toggleCategory(c: BarCategoryRow) {
    await fetch('/api/bar/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: c.key, setActive: !c.active }) });
    onChanged();
  }
  const [editCatKey, setEditCatKey] = useState<string | null>(null);
  const [eCatLabel, setECatLabel] = useState('');
  const [eCatColor, setECatColor] = useState('');
  const [eCatNominal, setECatNominal] = useState('');
  function startEditCategory(c: BarCategoryRow) {
    setEditCatKey(c.key); setECatLabel(c.label); setECatColor(c.colorKey); setECatNominal(c.nominalCode ?? '');
  }
  async function saveEditCategory(c: BarCategoryRow) {
    if (!eCatLabel.trim()) return;
    await fetch('/api/bar/categories', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: c.key, label: eCatLabel.trim(), colorKey: eCatColor, nominalCode: eCatNominal || null, isNew: false }) });
    setEditCatKey(null); onChanged();
  }

  // How a product's pricing reads on the list line, per mode.
  function priceLabel(p: BarProduct): string {
    if (p.variablePrice) return 'Variable amount (Cash Movement)';
    switch (pricingConfig.mode) {
      case 'split':
        return `${fmt(p.pricePence)} member / ${fmt(p.nonMemberPricePence)} visitor`;
      case 'member_discount':
        return `${fmt(p.basePricePence)} (${pricingConfig.memberDiscountPercent}% off whole bill for members)`;
      case 'member_product_discount': {
        const rate = p.memberDiscountOverridePercent ?? pricingConfig.memberDiscountPercent;
        const isOverride = p.memberDiscountOverridePercent !== null;
        return `${fmt(p.basePricePence)} (${rate}% member discount${isOverride ? '' : ', default'})`;
      }
      case 'single':
      default:
        return fmt(p.basePricePence);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-2xl">
        <h2 className="font-bold text-gray-900 mb-3">Manage Categories</h2>
        <div className="flex flex-wrap gap-2 mb-4 items-end">
          <input value={newCatKey} onChange={(e) => setNewCatKey(e.target.value)} placeholder="key (e.g. mixers)" className="border rounded px-2 py-1.5 text-sm w-32" />
          <input value={newCatLabel} onChange={(e) => setNewCatLabel(e.target.value)} placeholder="Label" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[120px]" />
          <select value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
            {CATEGORY_COLOR_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <div>
            <label className="block text-[10px] text-gray-500">Nominal code</label>
            <input value={newCatNominal} onChange={(e) => setNewCatNominal(e.target.value)} placeholder="optional" className="border rounded px-2 py-1.5 text-sm w-28" />
          </div>
          <button onClick={addCategory} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium">Add</button>
        </div>
        {categories.map((c) => (
          editCatKey === c.key ? (
            <div key={c.key} className="flex flex-wrap gap-2 items-center py-1.5 border-b border-gray-100">
              <input value={eCatLabel} onChange={(e) => setECatLabel(e.target.value)} className="border rounded px-2 py-1 text-sm flex-1 min-w-[120px]" />
              <select value={eCatColor} onChange={(e) => setECatColor(e.target.value)} className="border rounded px-2 py-1 text-sm">
                {CATEGORY_COLOR_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              <input value={eCatNominal} onChange={(e) => setECatNominal(e.target.value)} placeholder="Nominal code" className="border rounded px-2 py-1 text-sm w-32" />
              <button onClick={() => saveEditCategory(c)} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium">Save</button>
              <button onClick={() => setEditCatKey(null)} className="text-sm text-gray-500">Cancel</button>
            </div>
          ) : (
            <div key={c.key} className={`flex justify-between items-center text-sm py-1 ${c.active ? '' : 'opacity-40'}`}>
              <span className="flex items-center gap-2">
                <span className={`inline-block w-3 h-3 rounded-full ${categoryColorClasses(c.colorKey).active.split(' ')[0]}`} />
                {c.label} <span className="text-gray-400">({c.key}{c.nominalCode ? ` · ${c.nominalCode}` : ''})</span>
              </span>
              <span className="flex gap-3">
                <button onClick={() => startEditCategory(c)} className="text-xs text-blue-600">Edit</button>
                <button onClick={() => toggleCategory(c)} className="text-xs text-gray-500">{c.active ? 'Deactivate' : 'Activate'}</button>
              </span>
            </div>
          )
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 max-w-2xl">
      <div className="flex flex-wrap gap-2 mb-4 items-end">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item name" className="border rounded px-2 py-1.5 text-sm flex-1 min-w-[140px]" />
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="border rounded px-2 py-1.5 text-sm">
          {activeCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {!variablePrice && (
          <div>
            <label className="block text-[10px] text-gray-500">{isSplit ? 'Member £' : 'Price £'}</label>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
          </div>
        )}
        {!variablePrice && isSplit && (
          <div>
            <label className="block text-[10px] text-gray-500">Visitor £</label>
            <input value={visitorPrice} onChange={(e) => setVisitorPrice(e.target.value)} placeholder="£" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-20" />
          </div>
        )}
        {!variablePrice && showOverride && (
          <div>
            <label className="block text-[10px] text-gray-500">Override % (blank = {pricingConfig.memberDiscountPercent}%)</label>
            <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="%" inputMode="decimal" className="border rounded px-2 py-1.5 text-sm w-32" />
          </div>
        )}
        <div>
          <label className="block text-[10px] text-gray-500">Nominal code</label>
          <input value={nominalCode} onChange={(e) => setNominalCode(e.target.value)} placeholder="optional" className="border rounded px-2 py-1.5 text-sm w-28" />
        </div>
        <label className="flex items-center gap-1 text-xs text-gray-600 pb-1.5">
          <input type="checkbox" checked={variablePrice} onChange={(e) => setVariablePrice(e.target.checked)} />
          Variable price (Cash Movement)
        </label>
        <button onClick={add} className="px-3 py-1.5 bg-green-600 text-white rounded text-sm font-medium">Add</button>
      </div>
      {categories.map((c) => {
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
                    {activeCategories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  {!eVariablePrice && (
                    <input value={ePrice} onChange={(e) => setEPrice(e.target.value)} placeholder={isSplit ? 'Member £' : 'Price £'} inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  )}
                  {!eVariablePrice && isSplit && (
                    <input value={eVisitorPrice} onChange={(e) => setEVisitorPrice(e.target.value)} placeholder="Visitor £" inputMode="decimal" className="border rounded px-2 py-1 text-sm w-20" />
                  )}
                  {!eVariablePrice && showOverride && (
                    <input value={eOverride} onChange={(e) => setEOverride(e.target.value)} placeholder={`Override % (blank = ${pricingConfig.memberDiscountPercent}%)`} inputMode="decimal" className="border rounded px-2 py-1 text-sm w-40" />
                  )}
                  <input value={eNominalCode} onChange={(e) => setENominalCode(e.target.value)} placeholder="Nominal code" className="border rounded px-2 py-1 text-sm w-32" />
                  <label className="flex items-center gap-1 text-xs text-gray-600">
                    <input type="checkbox" checked={eVariablePrice} onChange={(e) => setEVariablePrice(e.target.checked)} />
                    Variable price
                  </label>
                  <button onClick={() => saveEdit(p)} className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium">Save</button>
                  <button onClick={() => setEditId(null)} className="text-sm text-gray-500">Cancel</button>
                </div>
              ) : (
                <div key={p.id} className={`flex justify-between items-center text-sm py-1 ${p.active ? '' : 'opacity-40'}`}>
                  <span>{p.name} — <span className="text-gray-500">{priceLabel(p)}</span></span>
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
    </div>
  );
}
