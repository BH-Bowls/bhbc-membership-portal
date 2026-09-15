// app/api/admin/website/committee/[id]/route.ts
// PATCH /api/admin/website/committee/[id] — updates an existing committee member.
// DELETE /api/admin/website/committee/[id] — permanently deletes a committee member.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateCommitteeMember, deleteCommitteeMember } from '@/lib/website-committee-supabase';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();
    const { name, role, email, display_order, active } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!role || typeof role !== 'string' || role.trim() === '') {
      return NextResponse.json({ error: 'role is required' }, { status: 400 });
    }
    if (email !== null && email !== undefined && email !== '' && typeof email === 'string' && !email.includes('@')) {
      return NextResponse.json({ error: 'email must be a valid address' }, { status: 400 });
    }

    try {
      await updateCommitteeMember(id, {
        name: name.trim(),
        role: role.trim(),
        email: typeof email === 'string' && email.trim() !== '' ? email.trim() : null,
        display_order: Number.isFinite(Number(display_order)) ? Number(display_order) : 0,
        active: active !== false,
      });
    } catch {
      return NextResponse.json({ error: 'Committee member not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/committee/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to update committee member' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      await deleteCommitteeMember(id);
    } catch {
      return NextResponse.json({ error: 'Committee member not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/committee/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete committee member' }, { status: 500 });
  }
}
