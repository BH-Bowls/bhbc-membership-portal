// app/api/banking/bar-reconciliation/export/route.ts
// POST { dayEndIds: string[] } — builds a Xero Manual Journal CSV for a batch of
// Day End records and marks them exported in the same call. See
// src/lib/xero-export.ts for the column-format caveat: not yet verified against
// a live Xero org.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getDayEnds, markDayEndsExported } from '@/lib/bar-supabase';
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
  if (dayEndIds.length === 0) return NextResponse.json({ error: 'dayEndIds is required' }, { status: 400 });

  try {
    const config = await getConfig();
    const nominalConfig = {
      cashAccount: config.bar_nominal_cash_account || '',
      cardAccount: config.bar_nominal_card_account || '',
      walletLiabilityAccount: config.bar_nominal_wallet_liability_account || '',
      discountsAccount: config.bar_nominal_discounts_account || '',
      cashVarianceAccount: config.bar_nominal_cash_variance_account || '',
      defaultSalesAccount: config.bar_nominal_default_sales_account || '',
    };

    const all = await getDayEnds(true);
    const selected = all.filter((d) => dayEndIds.includes(d.id));
    if (selected.length !== dayEndIds.length) {
      return NextResponse.json({ error: 'One or more day ends were not found' }, { status: 404 });
    }

    const csv = await buildXeroManualJournalCsv(selected, nominalConfig);
    await markDayEndsExported(dayEndIds, session.user.userName);
    return NextResponse.json({ csv, count: selected.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to export' }, { status: 500 });
  }
}
