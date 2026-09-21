// src/lib/bar-supabase.ts
// Data layer for the cashless bar (interim till). Postgres/Supabase only.
// Money is integer PENCE throughout; balance-changing operations go through the
// atomic plpgsql functions defined in supabase/migrations/0025_bar.sql.

import { getSupabaseClient } from './supabase';
import { getAllUsers } from './members-supabase';
import { getConfig } from './config-supabase';

// ── Types ────────────────────────────────────────────────────────────────────

// Categories are admin-managed data (bar_categories table, 0063_bar_day_ends.sql),
// not a fixed set — this is just a readability alias for the key stored on a product.
export type BarCategory = string;

// Club-wide, one active at a time (see BarPricingConfig) — see 0060_bar_pricing_modes.sql
// for the authoritative server-side pricing (bar_price_item), which priceItem() below mirrors
// for client-side display only.
export type BarPricingMode = 'single' | 'split' | 'member_discount' | 'member_product_discount';

export interface BarPricingConfig {
  mode: BarPricingMode;
  memberDiscountPercent: number;  // global default (member_product_discount) / whole-bill rate (member_discount)
}

export async function getPricingConfig(): Promise<BarPricingConfig> {
  const config = await getConfig();
  const mode = (config.bar_pricing_mode as BarPricingMode) || 'member_product_discount';
  const memberDiscountPercent = parseInt(config.bar_member_discount_percent ?? '0', 10) || 0;
  return { mode, memberDiscountPercent };
}

export interface BarProduct {
  id: string;
  name: string;
  category: BarCategory;
  basePricePence: number;                        // "the" price — single/member_discount/member_product_discount modes
  pricePence: number;                             // split mode: member price
  nonMemberPricePence: number;                    // split mode: visitor price
  memberDiscountOverridePercent: number | null;   // member_product_discount mode: null = inherit the global default
  nominalCode: string | null;                     // Xero nominal code override; null = inherit the category's code
  active: boolean;
  sortOrder: number;
}

export interface BarCategoryRow {
  key: string;
  label: string;
  colorKey: string;
  nominalCode: string | null;   // null = inherit the club-wide default sales code
  sortOrder: number;
  active: boolean;
}

/** basePricePence discounted by a given percentage — mirrors bar_member_price() in SQL. */
function discountedPence(basePricePence: number, percent: number): number {
  return Math.round(basePricePence * (100 - percent) / 100);
}

/** What a product actually costs under the active pricing mode — mirrors bar_price_item()
 * in 0060_bar_pricing_modes.sql exactly, for client-side display before a sale is submitted.
 * The server remains the source of truth: this is never trusted for the actual charge. */
export function priceItem(p: BarProduct, config: BarPricingConfig, isMember: boolean): { grossPence: number; netPence: number } {
  switch (config.mode) {
    case 'single':
      return { grossPence: p.basePricePence, netPence: p.basePricePence };
    case 'split':
      return { grossPence: p.nonMemberPricePence, netPence: isMember ? p.pricePence : p.nonMemberPricePence };
    case 'member_discount':
      return { grossPence: p.basePricePence, netPence: isMember ? discountedPence(p.basePricePence, config.memberDiscountPercent) : p.basePricePence };
    case 'member_product_discount':
    default: {
      const rate = p.memberDiscountOverridePercent ?? config.memberDiscountPercent;
      return { grossPence: p.basePricePence, netPence: isMember ? discountedPence(p.basePricePence, rate) : p.basePricePence };
    }
  }
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
  paymentMethod: 'cash' | 'card' | null;  // only meaningful for type 'topup'
  grossTotalPence: number | null;         // only present for type 'purchase' (joined via saleId)
  discountPence: number | null;           // only present for type 'purchase'
  createdAt: string;
}

export interface BasketItem {
  productId: string;
  qty: number;
}

export interface BarReport {
  salesCount: number;
  byMethodPence: { wallet: number; card: number; cash: number };
  byCategoryPence: Record<string, number>;
  byProduct: { name: string; qty: number; totalPence: number }[];
  topupsPence: number;      // cash taken as top-ups in range (card top-ups excluded — see cardTopupsPence)
  cardTopupsPence: number;  // top-ups taken by card in range — informational, not cash in the box
  refundsPence: number;  // cash paid back out in range
  cashSalesPence: number; // = byMethodPence.cash (visitor/emergency cash)
  outstandingPence: number; // current total float owed to members (not range-bound)
  expectedCashPence: number; // top-ups + cash sales − refunds in range (a bank-time guide)
  discountsGivenPence: number; // sum of member discounts given in range — informational, ready for Xero
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
    id: r.id, name: r.name, category: r.category,
    basePricePence: r.base_price_pence,
    pricePence: r.price_pence,
    nonMemberPricePence: r.non_member_price_pence,
    memberDiscountOverridePercent: r.member_discount_override_percent,
    nominalCode: r.nominal_code,
    active: r.active, sortOrder: r.sort_order,
  }));
}

export async function saveProduct(
  input: {
    id?: string; name: string; category: BarCategory;
    basePricePence?: number; pricePence?: number; nonMemberPricePence?: number;
    memberDiscountOverridePercent?: number | null;
    nominalCode?: string | null;
    sortOrder?: number; active?: boolean;
  },
  editedBy: string,
): Promise<void> {
  const supabase = getSupabaseClient();

  let { basePricePence, pricePence, nonMemberPricePence } = input;
  // On creation only: base_price_pence/price_pence/non_member_price_pence are all
  // NOT NULL, but the form only ever fills in whichever "price shape" the active
  // pricing mode needs — mirror across so the columns other modes use still get a
  // sane starting point instead of failing the insert. An existing product's
  // untouched columns are left alone on update (nothing added to `row` below), so
  // switching modes and back doesn't lose previously-entered split/base prices.
  if (!input.id) {
    if (basePricePence === undefined && nonMemberPricePence !== undefined) basePricePence = nonMemberPricePence;
    if (pricePence === undefined && basePricePence !== undefined) pricePence = basePricePence;
    if (nonMemberPricePence === undefined && basePricePence !== undefined) nonMemberPricePence = basePricePence;
  }

  const row: Record<string, unknown> = {
    name: input.name.trim(),
    category: input.category,
    sort_order: input.sortOrder ?? 0,
    active: input.active ?? true,
    updated_by: editedBy,
    updated_at: new Date().toISOString(),
  };
  if (basePricePence !== undefined) row.base_price_pence = basePricePence;
  if (pricePence !== undefined) row.price_pence = pricePence;
  if (nonMemberPricePence !== undefined) row.non_member_price_pence = nonMemberPricePence;
  if (input.memberDiscountOverridePercent !== undefined) row.member_discount_override_percent = input.memberDiscountOverridePercent;
  if (input.nominalCode !== undefined) row.nominal_code = input.nominalCode;

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

// ── Categories (admin-manageable — see 0063_bar_day_ends.sql) ────────────────

export async function getCategories(includeInactive = false): Promise<BarCategoryRow[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('bar_categories').select('*').order('sort_order').order('label');
  if (!includeInactive) query = query.eq('active', true);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load bar categories: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    key: r.key, label: r.label, colorKey: r.color_key, nominalCode: r.nominal_code,
    sortOrder: r.sort_order, active: r.active,
  }));
}

export async function saveCategory(
  input: { key: string; label: string; colorKey: string; nominalCode?: string | null; sortOrder?: number; active?: boolean; isNew: boolean },
): Promise<void> {
  const supabase = getSupabaseClient();
  const row: Record<string, unknown> = {
    label: input.label.trim(),
    color_key: input.colorKey,
    sort_order: input.sortOrder ?? 0,
    active: input.active ?? true,
  };
  if (input.nominalCode !== undefined) row.nominal_code = input.nominalCode;

  if (input.isNew) {
    const { error } = await supabase.from('bar_categories').insert({ key: input.key, ...row });
    if (error) throw new Error(`Failed to create category: ${error.message}`);
  } else {
    const { error } = await supabase.from('bar_categories').update(row).eq('key', input.key);
    if (error) throw new Error(`Failed to update category: ${error.message}`);
  }
}

export async function setCategoryActive(key: string, active: boolean): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('bar_categories').update({ active }).eq('key', key);
  if (error) throw new Error(`Failed to update category: ${error.message}`);
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
    // Lowest balance first — surfaces members who need a top-up reminder before
    // members who are well-funded. Name is the tiebreaker (mostly £0 accounts).
    .sort((a, b) => a.balancePence - b.balancePence || a.fullName.localeCompare(b.fullName));
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
    .from('bar_ledger').select('*, bar_sales ( gross_total_pence, discount_pence )').eq('user_name', userName).order('created_at', { ascending: false }).limit(100);
  if (ledErr) throw new Error(`Failed to load history: ${ledErr.message}`);

  return {
    exists: !!acct,
    balancePence: acct?.balance_pence ?? 0,
    history: (ledger ?? []).map((r: any) => ({
      id: r.id, type: r.type, amountPence: r.amount_pence, balanceAfterPence: r.balance_after_pence,
      note: r.note, saleId: r.sale_id, staff: r.staff, paymentMethod: r.payment_method ?? null,
      grossTotalPence: r.bar_sales?.gross_total_pence ?? null, discountPence: r.bar_sales?.discount_pence ?? null,
      createdAt: r.created_at,
    })),
  };
}

// ── Money operations (atomic RPCs) ───────────────────────────────────────────

export async function topUp(userName: string, amountPence: number, staff: string, note?: string, paymentMethod: 'cash' | 'card' = 'cash'): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_topup', {
    p_user_name: userName, p_amount_pence: amountPence, p_staff: staff, p_note: note ?? null, p_payment_method: paymentMethod,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function walletPurchase(userName: string, items: BasketItem[], staff: string): Promise<{ saleId: string; balancePence: number; totalPence: number; grossTotalPence: number; discountPence: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_wallet_purchase', {
    p_user_name: userName,
    p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_staff: staff,
  });
  if (error) throw new Error(error.message);
  return { saleId: data.sale_id, balancePence: data.balance_pence, totalPence: data.total_pence, grossTotalPence: data.gross_total_pence, discountPence: data.discount_pence };
}

/** userName attributes a card/cash sale to a known member (e.g. "Pay by Card") without
 * touching their wallet — priced at the member rate. Omitted, it's a plain visitor sale
 * priced at the non-member rate, exactly as before. */
export async function visitorSale(method: 'card' | 'cash', items: BasketItem[], staff: string, userName?: string): Promise<{ saleId: string; totalPence: number; grossTotalPence: number; discountPence: number }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_visitor_sale', {
    p_payment_method: method,
    p_items: items.map((i) => ({ product_id: i.productId, qty: i.qty })),
    p_staff: staff,
    p_user_name: userName ?? null,
  });
  if (error) throw new Error(error.message);
  return { saleId: data.sale_id, totalPence: data.total_pence, grossTotalPence: data.gross_total_pence, discountPence: data.discount_pence };
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

/** Everything not yet linked to a Day End (bar_day_ends, 0063_bar_day_ends.sql) --
 * "since the last cash-up", not a calendar day, since a day end isn't guaranteed
 * to align with midnight. Once bar_create_day_end() links every current row,
 * this naturally goes back to reporting nothing until fresh activity happens. */
export async function getReport(): Promise<BarReport> {
  const supabase = getSupabaseClient();

  // Non-voided, not-yet-linked sales, with line items + product info
  const { data: sales, error: salesErr } = await supabase
    .from('bar_sales')
    .select('id, payment_method, total_pence, discount_pence, voided, created_at, bar_sale_items ( qty, unit_price_pence, bar_products ( name, category ) )')
    .is('day_end_id', null).eq('voided', false);
  if (salesErr) throw new Error(`Failed to load sales: ${salesErr.message}`);

  const byMethodPence = { wallet: 0, card: 0, cash: 0 };
  const byCategoryPence: Record<string, number> = {};
  const byProductMap = new Map<string, { name: string; qty: number; totalPence: number }>();
  let discountsGivenPence = 0;

  for (const s of sales ?? []) {
    const method = s.payment_method as 'wallet' | 'card' | 'cash';
    byMethodPence[method] = (byMethodPence[method] ?? 0) + s.total_pence;
    discountsGivenPence += s.discount_pence ?? 0;
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

  // Top-ups / refunds not yet linked (cash in / cash out). Card top-ups are
  // tracked separately — they're not cash landing in the till.
  const { data: ledger, error: ledErr } = await supabase
    .from('bar_ledger').select('type, amount_pence, payment_method').is('day_end_id', null).in('type', ['topup', 'refund']);
  if (ledErr) throw new Error(`Failed to load ledger: ${ledErr.message}`);
  let topupsPence = 0, cardTopupsPence = 0, refundsPence = 0;
  for (const l of ledger ?? []) {
    if (l.type === 'topup') {
      if (l.payment_method === 'card') cardTopupsPence += l.amount_pence;
      else topupsPence += l.amount_pence; // 'cash' or null (legacy rows, all cash)
    } else if (l.type === 'refund') refundsPence += -l.amount_pence; // stored negative → make positive
  }

  // Current outstanding float (not range-bound)
  const { data: accts, error: acctErr } = await supabase.from('bar_accounts').select('balance_pence');
  if (acctErr) throw new Error(`Failed to load balances: ${acctErr.message}`);
  const outstandingPence = (accts ?? []).reduce((sum: number, a: any) => sum + a.balance_pence, 0);

  const cashSalesPence = byMethodPence.cash;

  return {
    salesCount: (sales ?? []).length,
    byMethodPence, byCategoryPence,
    byProduct: [...byProductMap.values()].sort((a, b) => b.totalPence - a.totalPence),
    topupsPence, cardTopupsPence, refundsPence, cashSalesPence, outstandingPence,
    expectedCashPence: topupsPence + cashSalesPence - refundsPence,
    discountsGivenPence,
  };
}

// ── Day End (cash-up) ─────────────────────────────────────────────────────────

export interface BarDayEnd {
  id: string;
  staff: string;
  createdAt: string;
  floatPence: number;
  cashTopupsPence: number;
  cashSalesPence: number;
  refundsPence: number;
  cashExpectedPence: number;
  cashRemovedPence: number;
  differenceReason: string | null;
  walletSalesPence: number;
  cardSalesPence: number;
  cardTopupsPence: number;
  discountsGivenPence: number;
  outstandingBalancePence: number;
  xeroExportedAt: string | null;
  xeroExportedBy: string | null;
}

function mapDayEndRow(r: any): BarDayEnd {
  return {
    id: r.id, staff: r.staff, createdAt: r.created_at, floatPence: r.float_pence,
    cashTopupsPence: r.cash_topups_pence, cashSalesPence: r.cash_sales_pence, refundsPence: r.refunds_pence,
    cashExpectedPence: r.cash_expected_pence, cashRemovedPence: r.cash_removed_pence,
    differenceReason: r.difference_reason, walletSalesPence: r.wallet_sales_pence,
    cardSalesPence: r.card_sales_pence, cardTopupsPence: r.card_topups_pence,
    discountsGivenPence: r.discounts_given_pence, outstandingBalancePence: r.outstanding_balance_pence,
    xeroExportedAt: r.xero_exported_at, xeroExportedBy: r.xero_exported_by,
  };
}

/** Aggregates every bar_ledger/bar_sales row not yet linked to a day end into one
 * durable record, then links them all to it (see bar_create_day_end() in
 * 0063_bar_day_ends.sql) -- the whole "run it again, nothing to report" mechanic
 * lives in that one atomic function, not here. */
export async function createDayEnd(staff: string, cashRemovedPence: number, reason?: string): Promise<BarDayEnd> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.rpc('bar_create_day_end', {
    p_staff: staff, p_cash_removed_pence: cashRemovedPence, p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return mapDayEndRow(data);
}

export async function getDayEnds(includeExported = false): Promise<BarDayEnd[]> {
  const supabase = getSupabaseClient();
  let query = supabase.from('bar_day_ends').select('*').order('created_at', { ascending: false });
  if (!includeExported) query = query.is('xero_exported_at', null);
  const { data, error } = await query;
  if (error) throw new Error(`Failed to load day ends: ${error.message}`);
  return (data ?? []).map(mapDayEndRow);
}

export async function markDayEndsExported(dayEndIds: string[], exportedBy: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('bar_day_ends')
    .update({ xero_exported_at: new Date().toISOString(), xero_exported_by: exportedBy })
    .in('id', dayEndIds);
  if (error) throw new Error(`Failed to mark day ends exported: ${error.message}`);
}

// ── Day End drill-down (Treasurer Bar Reconciliation) ────────────────────────

export interface BarDayEndLedgerRow {
  id: string;
  type: 'topup' | 'refund';
  amountPence: number;
  paymentMethod: 'cash' | 'card' | null;
  userName: string;
  memberName: string;
  staff: string | null;
  note: string | null;
  createdAt: string;
}

/** The sales making up one payment-method line of a Day End (e.g. "Wallet sales" -> the
 * bar_sales rows linked to it with payment_method = 'wallet'). dayEndId null means "not
 * yet linked to any Day End" -- the till's live Dayend screen, before Confirm Day End. */
export async function getDayEndSales(dayEndId: string | null, method: 'wallet' | 'card' | 'cash'): Promise<BarSaleSummary[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('bar_sales')
    .select('id, created_at, payment_method, user_name, total_pence, gross_total_pence, discount_pence, voided, bar_sale_items ( qty, unit_price_pence, bar_products ( name ) )')
    .eq('payment_method', method).eq('voided', false);
  query = dayEndId === null ? query.is('day_end_id', null) : query.eq('day_end_id', dayEndId);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load sales: ${error.message}`);
  const names = await nameMap();
  return (data ?? []).map((s: any) => ({
    id: s.id,
    createdAt: s.created_at,
    paymentMethod: s.payment_method,
    userName: s.user_name,
    memberName: s.user_name ? (names.get(s.user_name.toLowerCase()) || s.user_name) : null,
    totalPence: s.total_pence,
    grossTotalPence: s.gross_total_pence,
    discountPence: s.discount_pence,
    voided: s.voided,
    items: (s.bar_sale_items ?? []).map((i: any) => ({ name: i.bar_products?.name ?? 'Item', qty: i.qty, unitPricePence: i.unit_price_pence })),
  }));
}

/** The top-ups/refunds making up one line of a Day End. paymentMethod 'cash' also matches
 * legacy rows with a null payment_method, mirroring getReport()'s cash/null equivalence.
 * dayEndId null means "not yet linked to any Day End" -- the till's live Dayend screen. */
export async function getDayEndLedger(dayEndId: string | null, type: 'topup' | 'refund', paymentMethod?: 'cash' | 'card'): Promise<BarDayEndLedgerRow[]> {
  const supabase = getSupabaseClient();
  let query = supabase
    .from('bar_ledger')
    .select('id, type, amount_pence, payment_method, user_name, staff, note, created_at')
    .eq('type', type);
  query = dayEndId === null ? query.is('day_end_id', null) : query.eq('day_end_id', dayEndId);
  if (paymentMethod === 'card') query = query.eq('payment_method', 'card');
  else if (paymentMethod === 'cash') query = query.or('payment_method.is.null,payment_method.eq.cash');
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to load ledger: ${error.message}`);
  const names = await nameMap();
  return (data ?? []).map((r: any) => ({
    id: r.id, type: r.type, amountPence: Math.abs(r.amount_pence), paymentMethod: r.payment_method,
    userName: r.user_name, memberName: names.get(r.user_name.toLowerCase()) || r.user_name,
    staff: r.staff, note: r.note, createdAt: r.created_at,
  }));
}

export interface BarNominalRevenue {
  nominalCode: string | null;   // null = no product/category override; caller falls back to the global default
  pence: number;
}

/** Net revenue (what was actually charged, after any member discount) for one payment
 * method of a Day End, split by nominal code via the product -> category -> default
 * hierarchy. Used to build the per-code revenue lines of the Xero export. */
export async function getDayEndRevenueByNominalCode(dayEndId: string, method: 'wallet' | 'card' | 'cash'): Promise<BarNominalRevenue[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('bar_sales')
    .select('bar_sale_items ( qty, unit_price_pence, bar_products ( nominal_code, category, bar_categories ( nominal_code ) ) )')
    .eq('day_end_id', dayEndId).eq('payment_method', method).eq('voided', false);
  if (error) throw new Error(`Failed to load sale items: ${error.message}`);
  const totals = new Map<string | null, number>();
  for (const s of (data ?? []) as any[]) {
    for (const item of (s.bar_sale_items ?? []) as any[]) {
      const line = item.qty * item.unit_price_pence;
      const code = item.bar_products?.nominal_code ?? item.bar_products?.bar_categories?.nominal_code ?? null;
      totals.set(code, (totals.get(code) ?? 0) + line);
    }
  }
  return [...totals.entries()].map(([nominalCode, pence]) => ({ nominalCode, pence }));
}

// ── Recent sales (for the void screen) ───────────────────────────────────────

export interface BarSaleItem {
  name: string;
  qty: number;
  unitPricePence: number;
}

export interface BarSaleSummary {
  id: string;
  createdAt: string;
  paymentMethod: 'wallet' | 'card' | 'cash';
  userName: string | null;
  memberName: string | null;   // null for visitor sales
  totalPence: number;
  grossTotalPence: number;
  discountPence: number;
  voided: boolean;
  items: BarSaleItem[];
}

export async function getRecentSales(limit = 40): Promise<BarSaleSummary[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('bar_sales')
    .select('id, created_at, payment_method, user_name, total_pence, gross_total_pence, discount_pence, voided, bar_sale_items ( qty, unit_price_pence, bar_products ( name ) )')
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
    grossTotalPence: s.gross_total_pence,
    discountPence: s.discount_pence,
    voided: s.voided,
    items: (s.bar_sale_items ?? []).map((i: any) => ({ name: i.bar_products?.name ?? 'Item', qty: i.qty, unitPricePence: i.unit_price_pence })),
  }));
}
