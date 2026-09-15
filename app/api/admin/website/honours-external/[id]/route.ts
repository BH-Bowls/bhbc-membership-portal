// app/api/admin/website/honours-external/[id]/route.ts
// PATCH /api/admin/website/honours-external/[id] — updates an existing external honours result.
// DELETE /api/admin/website/honours-external/[id] — permanently deletes an external honours result.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateHonoursExternal, deleteHonoursExternal } from '@/lib/website-honours-external-supabase';

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
    const { year, competition, detail } = body;

    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'year must be a positive whole number' }, { status: 400 });
    }
    if (!competition || typeof competition !== 'string' || competition.trim() === '') {
      return NextResponse.json({ error: 'competition is required' }, { status: 400 });
    }

    try {
      await updateHonoursExternal(id, {
        year: yearNum,
        competition: competition.trim(),
        detail: typeof detail === 'string' && detail.trim() !== '' ? detail.trim() : null,
      });
    } catch {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/honours-external/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to update honours_external row' }, { status: 500 });
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
      await deleteHonoursExternal(id);
    } catch {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/honours-external/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete honours_external row' }, { status: 500 });
  }
}
