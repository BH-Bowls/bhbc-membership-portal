// app/api/banking/bar-reconciliation/export/route.ts
// POST { dayEndIds?: string[], bankingIds?: string[] } — builds one combined
// Xero Manual Journal CSV covering both pools (specs/BAR_BANKING_XERO_SPEC.md
// §6.3: "order independence" -- either can be empty, a Day End can be exported
// before or after being banked) and marks whichever were included exported.
// See src/lib/xero-export.ts for the column-format caveat: not yet verified
// against a live Xero org.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfirmedDayEnds, markDayEndsExported, getBankings, markBankingsExported } from '@/lib/bar-supabase';
import { getConfig } from '@/lib/config-supabase';
import { buildXeroManualJournalCsv } from '@/lib/xero-export';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const dayEndIds: string[] = Array.isArray(body.dayEndIds) ? body.dayEndIds : [];
  const bankingIds: string[] = Array.isArray(body.bankingIds) ? body.bankingIds : [];
  if (dayEndIds.length === 0 && bankingIds.length === 0) {
    return NextResponse.json({ error: 'Select at least one day end or banking' }, { status: 400 });
  }

  try {
    const config = await getConfig();
    const nominalConfig = {
      cashAccount: config.bar_nominal_cash_account || '',
      cardAccount: config.bar_nominal_card_account || '',
      walletLiabilityAccount: config.bar_nominal_wallet_liability_account || '',
      discountsAccount: config.bar_nominal_discounts_account || '',
      cashVarianceAccount: config.bar_nominal_cash_variance_account || '',
      defaultSalesAccount: config.bar_nominal_default_sales_account || '',
      cashBankedAccount: config.bar_nominal_cash_banked_account || '',
    };

    let selectedDayEnds: Awaited<ReturnType<typeof getConfirmedDayEnds>> = [];
    if (dayEndIds.length > 0) {
      const confirmed = await getConfirmedDayEnds();
      selectedDayEnds = confirmed.filter((d) => dayEndIds.includes(d.id));
      if (selectedDayEnds.length !== dayEndIds.length) {
        return NextResponse.json({ error: 'One or more day ends were not found, or are not yet confirmed' }, { status: 404 });
      }
    }

    let selectedBankings: Awaited<ReturnType<typeof getBankings>> = [];
    if (bankingIds.length > 0) {
      const bankings = await getBankings(true);
      selectedBankings = bankings.filter((b) => bankingIds.includes(b.id));
      if (selectedBankings.length !== bankingIds.length) {
        return NextResponse.json({ error: 'One or more bankings were not found' }, { status: 404 });
      }
    }

    const csv = await buildXeroManualJournalCsv(selectedDayEnds, selectedBankings, nominalConfig);
    if (dayEndIds.length > 0) await markDayEndsExported(dayEndIds, session.user.userName);
    if (bankingIds.length > 0) await markBankingsExported(bankingIds, session.user.userName);
    return NextResponse.json({ csv, dayEndCount: selectedDayEnds.length, bankingCount: selectedBankings.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to export' }, { status: 500 });
  }
}
