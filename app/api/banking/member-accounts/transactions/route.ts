// app/api/banking/member-accounts/transactions/route.ts
// GET ?userName=<u>&from=<ISO>&to=<ISO> — one member's bar wallet ledger rows
// in [from, to), oldest first (drill-down from the Member Accounts report).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getMemberAccountTransactions } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin', 'Treasurer', 'T')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const userName = req.nextUrl.searchParams.get('userName');
  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!userName || !from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'userName, from and to are required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ transactions: await getMemberAccountTransactions(userName, from, to) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load transactions' }, { status: 500 });
  }
}
