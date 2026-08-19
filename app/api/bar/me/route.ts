// app/api/bar/me/route.ts
// GET — the logged-in member's own bar balance + history (member self-view).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getMemberAccount } from '@/lib/bar-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.userName) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ account: await getMemberAccount(session.user.userName) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load account' }, { status: 500 });
  }
}
