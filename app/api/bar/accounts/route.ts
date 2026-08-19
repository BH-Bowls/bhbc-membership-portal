// app/api/bar/accounts/route.ts
// GET  — list cash members (opt-in) with balances
// POST — make a member a cash member { userName }
// Both committee-gated (the till device is logged in as a committee/bar account).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getCashAccounts, addCashAccount } from '@/lib/bar-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ accounts: await getCashAccounts() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await req.json();
  if (!body.userName) return NextResponse.json({ error: 'userName required' }, { status: 400 });
  try {
    await addCashAccount(body.userName);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to add cash member' }, { status: 500 });
  }
}
