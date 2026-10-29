// app/api/banking/member-accounts/route.ts
// GET ?from=<ISO>&to=<ISO> — Member Accounts report: every bar wallet with its
// opening/closing balance and movement totals for [from, to). The client sends
// both boundaries as instants (local midnight), so BST is handled by the browser.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getMemberAccountsReport } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin', 'Treasurer', 'T')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const from = req.nextUrl.searchParams.get('from');
  const to = req.nextUrl.searchParams.get('to');
  if (!from || !to || isNaN(Date.parse(from)) || isNaN(Date.parse(to))) {
    return NextResponse.json({ error: 'from and to are required' }, { status: 400 });
  }

  try {
    return NextResponse.json({ accounts: await getMemberAccountsReport(from, to) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load member accounts' }, { status: 500 });
  }
}
