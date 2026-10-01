// app/api/banking/bar-reconciliation/banking/route.ts
// GET ?bankingId=<id> — the Day Ends bundled into one Banking record.
// POST { bankedDate, dayEndIds, note? } — bundles confirmed, not-yet-banked Day
// Ends into a new Banking record (specs/BAR_BANKING_XERO_SPEC.md §5).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getBankingDayEnds, createBanking } from '@/lib/bar-supabase';

function canAccess(role: string | undefined | null): boolean {
  return hasRole(role, 'Admin', 'Treasurer', 'T');
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const bankingId = req.nextUrl.searchParams.get('bankingId');
  if (!bankingId) return NextResponse.json({ error: 'bankingId is required' }, { status: 400 });

  try {
    return NextResponse.json({ dayEnds: await getBankingDayEnds(bankingId) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load banking' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canAccess(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const dayEndIds: string[] = Array.isArray(body.dayEndIds) ? body.dayEndIds : [];
  if (!body.bankedDate || dayEndIds.length === 0) {
    return NextResponse.json({ error: 'bankedDate and at least one dayEndId are required' }, { status: 400 });
  }

  try {
    const banking = await createBanking(session.user.userName, body.bankedDate, dayEndIds, body.note || undefined);
    return NextResponse.json({ ok: true, banking });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to create banking' }, { status: 500 });
  }
}
