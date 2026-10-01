// app/api/admin/lockers/[id]/route.ts
// Locker Register (admin only).
// PUT    — update a locker (key, status, allocation, notes, etc.).
// DELETE — remove a locker from the register.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateLocker, deleteLocker } from '@/lib/lockers-supabase';
import type { LockerInput } from '@/types/lockers';

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json()) as { locker: LockerInput };
    const result = await updateLocker(id, body.locker);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ locker: result.locker });
  } catch (error) {
    console.error('[PUT /api/admin/lockers/[id]]', error);
    return NextResponse.json({ error: 'Failed to update locker' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteLocker(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/lockers/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete locker' }, { status: 500 });
  }
}
