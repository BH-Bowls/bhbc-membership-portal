// app/api/bar/account/route.ts
// GET ?userName= — a member's bar balance + history (committee/till use).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { isCommitteeMember } from '@/lib/role-utils';
import { getMemberAccount } from '@/lib/bar-supabase';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isCommitteeMember(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const userName = req.nextUrl.searchParams.get('userName');
  if (!userName) return NextResponse.json({ error: 'userName required' }, { status: 400 });
  try {
    return NextResponse.json({ account: await getMemberAccount(userName) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load account' }, { status: 500 });
  }
}
