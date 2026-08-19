// src/lib/bar-supabase.ts
// Data layer for the cashless bar (interim till). Postgres/Supabase only.
// Money is integer PENCE throughout; balance-changing operations go through the
// atomic plpgsql functions defined in supabase/migrations/0025_bar.sql.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type BarCategory = 'beer' | 'wine' | 'spirit' | 'zero_gf' | 'soft' | 'snack';

export interface BarProduct {
  id: string;
  name: string;
  category: BarCategory;
  pricePence: number;
  active: boolean;
  sortOrder: number;
}

export interface BarAccount {
  userName: string;
  fullName: string;
  balancePence: number;
}

export interface BarPerson {
  userName: string;
  fullName: string;
}

export interface BarLedgerEntry {
  id: string;
  type: 'topup' | 'purchase' | 'refund' | 'adjustment';
  amountPence: number;
  balanceAfterPence: number;
  note: string | null;
  saleId: string | null;
  staff: string | null;
  createdAt: string;
}

export interface BasketItem {
  productId: string;
  qty: number;
}

export interface BarReport {
  fromIso: string;
  toIso: string;
  salesCount: number;
  byMethodPence: { wallet: number; card: number; cash: number };
  byCategoryPence: Record<string, number>;
  byProduct: { name: string; qty: number; totalPence: number }[];
  topupsPence: number;   // cash taken as top-ups in range
  refundsPence: number;  // cash paid back out in range
  cashSalesPence: number; // = byMethodPence.cash (visitor/emergency cash)
  outstandingPence: number; // current total float owed to members (not range-bound)
  expectedCashPence: number; // top-ups + cash sales − refunds in range (a bank-time guide)
}

// ── Name lookup helper ───────────────────────────────────────────────────────

async function nameMap(): Promise<Map<string, string>> {
  const users = await getAllUsers();
  return new Map(users.map((u) => [u.userName.toLowerCase(), u.fullName || u.userName]));
}

// ── Products ─────────────────────────────────────────────────────────────────

export async function getProducts(includeInactive = false): Promise<BarProduct[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('bar_products').select('*').order('category').order('sort_order').order('name');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load bar products: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    id: r.id, name: r.name, category: r.category, pricePence: r.price_pence,
    active: r.active, sortOrder: r.sort_order,
  }));
}

export async function saveProduct(
  input: { id?: string; name: string; category: BarCategory; pricePence: number; sortOrder?: number; active?: boolean },
  editedBy: string,
): Promise<void> {
  const supabase = getSupabaseClient();
  const row = {
    name: input.name.trim(),
    category: input.category,
    price_pence: input.pricePence,
    sort_order: input.sortOrder ?? 0,
    active: input.active ?? true,
    updated_by: editedBy,
    updated_at: new Date().toISOString(),
  };
  if (input.id) {
    const { error } = await supabase.from('bar_products').update(row).eq('id', input.id);
    if (error) throw new Error(`Failed to update product: ${error.message}`);
  } else {
    const { error } = await supabase.from('bar_products').insert(row);
    if (error) throw new Error(`Failed to create product: ${error.message}`);
  }
}

export async function setProductActive(id: string, active: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('bar_products').update({ active, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(`Failed to update product: ${error.message}`);
}

// ── Cash accounts (opt-in members) ───────────────────────────────────────────

export async function getCashAccounts(): Promise<BarAccount[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('bar_accounts').select('user_name, balance_pence');
  if (error) throw new Error(`Failed to load bar accounts: ${error.message}`);
  const names = await nameMap();
  return (data ?? [])
    .map((r: any) => ({
      userName: r.user_name,
      fullName: names.get(r.user_name.toLowerCase()) || r.user_name,
      balancePence: r.balance_pence,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/** Make a member a cash member (creates a zero-balance account; no-op if one exists). */
export async function addCashAccount(userName: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('bar_accounts').upsert({ user_name: userName }, { onConflict: 'user_name', ignoreDuplicates: true });
  if (error) throw new Error(`Failed to add cash account: ${error.message}`);
}

/** Members flagged as bar-duty volunteers — the "Served by" list. */
export async function getBarPersons(): Promise<BarPerson[]> {
  const users = await getAllUsers();
  return users
    .filter((u) => {
      const v = (u.barDuty ?? '').trim().toLowerCase();
      return v !== '' && v !== 'n' && v !== 'no';
    })
    .map((u) => ({ userName: u.userName, fullName: u.fullName || u.userName }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// ── Member account (balance + history) ───────────────────────────────────────

export async function getMemberAccount(userName: string): Promise<{ balancePence: number; exists: boolean; history: BarLedgerEntry[] }> {
  const supabase = getSupabaseClient();
  const { data: acct, error: acctErr } = await supabase
    .from('bar_accounts').select('balance_pence').eq('user_name', userName).maybeSingle();
  if (acctErr) throw new Error(`Failed to load account: ${acctErr.message}`);

  const { data: ledger, error: ledErr } = await supabase
    .from('bar_ledger').select('*').eq('user_name', userName).order('created_at', { ascending: false }).limit(100);
  if (ledErr) throw new Error(`Failed to load history: ${ledErr.message}`);

  return {
    exists: !!acct,
    balancePence: acct?.balance_pence ?? 0,
    history: (ledger ?? []).map((r: any) => ({
      id: r.id, type: r.type, amountPence: r.amount_pence, balanceAfterPence: r.balance_after_pence,
      note: r.note, saleId: r.sale_id, staff: r.staff, createdAt: r.created_at,
    })),
  };
}

// ── Money operations (atomic RPCs) ───────────────────────────────────────────

export async function topUp(userName: string, amountPence: number, staff: string, note?: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_topup', {
    p_user_name: userName, p_amount_pence: amountPence, p_staff: staff, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function walletPurchase(userName: string, items: BasketItem[], staff: string): Promise<{ saleId: string; balancePence: number; totalPence: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_wallet_purchase', {
    p_user_name: userName,
    p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_staff: staff,
  });
  if (error) throw new Error(error.message);
  return { saleId: data.sale_id, balancePence: data.balance_pence, totalPence: data.total_pence };
}

export async function visitorSale(method: 'card' | 'cash', items: BasketItem[], staff: string): Promise<{ saleId: string; totalPence: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_visitor_sale', {
    p_payment_method: method,
    p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_staff: staff,
  });
  if (error) throw new Error(error.message);
  return { saleId: data.sale_id, totalPence: data.total_pence };
}

export async function voidSale(saleId: string, staff: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.rpc('bar_void_sale', { p_sale_id: saleId, p_staff: staff });
  if (error) throw new Error(error.message);
}

export async function refund(userName: string, amountPence: number, staff: string, note?: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_refund', {
    p_user_name: userName, p_amount_pence: amountPence, p_staff: staff, p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

// ── Reporting ────────────────────────────────────────────────────────────────

export async function getReport(fromIso: string, toIso: string): Promise<BarReport> {
  const supabase = getSupabaseClient();

  // Non-voided sales in range, with line items + product info
  const { data: sales, error: salesErr } = await supabase
    .from('bar_sales')
    .select('id, payment_method, total_pence, voided, created_at, bar_sale_items ( qty, unit_price_pence, bar_products ( name, category ) )')
    .gte('created_at', fromIso).lte('created_at', toIso).eq('voided', false);
  if (salesErr) throw new Error(`Failed to load sales: ${salesErr.message}`);

  const byMethodPence = { wallet: 0, card: 0, cash: 0 };
  const byCategoryPence: Record<string, number> = {};
  const byProductMap = new Map<string, { name: string; qty: number; totalPence: number }>();

  for (const s of sales ?? []) {
    const method = s.payment_method as 'wallet' | 'card' | 'cash';
    byMethodPence[method] = (byMethodPence[method] ?? 0) + s.total_pence;
    for (const item of (s.bar_sale_items ?? []) as any[]) {
      const line = item.qty * item.unit_price_pence;
      const cat = item.bar_products?.category ?? 'other';
      const name = item.bar_products?.name ?? 'Unknown';
      byCategoryPence[cat] = (byCategoryPence[cat] ?? 0) + line;
      const cur = byProductMap.get(name) ?? { name, qty: 0, totalPence: 0 };
      cur.qty += item.qty; cur.totalPence += line;
      byProductMap.set(name, cur);
    }
  }

  // Top-ups / refunds in range (cash in / cash out)
  const { data: ledger, error: ledErr } = await supabase
    .from('bar_ledger').select('type, amount_pence').gte('created_at', fromIso).lte('created_at', toIso).in('type', ['topup', 'refund']);
  if (ledErr) throw new Error(`Failed to load ledger: ${ledErr.message}`);
  let topupsPence = 0, refundsPence = 0;
  for (const l of ledger ?? []) {
    if (l.type === 'topup') topupsPence += l.amount_pence;       // positive
    else if (l.type === 'refund') refundsPence += -l.amount_pence; // stored negative → make positive
  }

  // Current outstanding float (not range-bound)
  const { data: accts, error: acctErr } = await supabase.from('bar_accounts').select('balance_pence');
  if (acctErr) throw new Error(`Failed to load balances: ${acctErr.message}`);
  const outstandingPence = (accts ?? []).reduce((sum: number, a: any) => sum + a.balance_pence, 0);

  const cashSalesPence = byMethodPence.cash;

  return {
    fromIso, toIso,
    salesCount: (sales ?? []).length,
    byMethodPence, byCategoryPence,
    byProduct: [...byProductMap.values()].sort((a, b) => b.totalPence - a.totalPence),
    topupsPence, refundsPence, cashSalesPence, outstandingPence,
    expectedCashPence: topupsPence + cashSalesPence - refundsPence,
  };
}

// ── Recent sales (for the void screen) ───────────────────────────────────────

export interface BarSaleSummary {
  id: string;
  createdAt: string;
  paymentMethod: 'wallet' | 'card' | 'cash';
  userName: string | null;
  memberName: string | null;   // null for visitor sales
  totalPence: number;
  voided: boolean;
  items: { name: string; qty: number }[];
}

export async function getRecentSales(limit = 40): Promise<BarSaleSummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('bar_sales')
    .select('id, created_at, payment_method, user_name, total_pence, voided, bar_sale_items ( qty, bar_products ( name ) )')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to load sales: ${error.message}`);
  const names = await nameMap();
  return (data ?? []).map((s: any) => ({
    id: s.id,
    createdAt: s.created_at,
    paymentMethod: s.payment_method,
    userName: s.user_name,
    memberName: s.user_name ? (names.get(s.user_name.toLowerCase()) || s.user_name) : null,
    totalPence: s.total_pence,
    voided: s.voided,
    items: (s.bar_sale_items ?? []).map((i: any) => ({ name: i.bar_products?.name ?? 'Item', qty: i.qty })),
  }));
}
