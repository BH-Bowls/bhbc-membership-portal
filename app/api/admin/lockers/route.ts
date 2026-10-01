// app/api/admin/lockers/route.ts
// Locker Register (admin only).
// GET  — every locker, with the allocated member's name.
// POST — add a locker.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllLockers, createLocker } from '@/lib/lockers-supabase';
import type { LockerInput } from '@/types/lockers';

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const lockers = await getAllLockers();
    return NextResponse.json({ lockers });
  } catch (error) {
    console.error('[GET /api/admin/lockers]', error);
    return NextResponse.json({ error: 'Failed to load lockers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { locker: LockerInput };
    const result = await createLocker(body.locker);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ locker: result.locker });
  } catch (error) {
    console.error('[POST /api/admin/lockers]', error);
    return NextResponse.json({ error: 'Failed to add locker' }, { status: 500 });
  }
}
