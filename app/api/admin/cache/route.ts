// app/api/admin/cache/route.ts
// Admin-only diagnostics for the in-memory Members read cache (see /admin/cache).
// Returns hit counts and the recent invalidation log for the serverless instance
// that happens to handle this request.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getUsersCacheStats } from '@/lib/sheets';
import { getFriendliesMembersCacheStats } from '@/lib/friendlies-sheets';

export async function GET() {
  const session = await getServerSession(authOptions);
  const role = session && session.user ? session.user.role : '';
  if (!session || !hasRole(role, 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json({
    usersCache: getUsersCacheStats(),
    friendliesMembersCache: getFriendliesMembersCacheStats(),
    serverTime: Date.now(),
  });
}
