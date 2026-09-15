// app/api/admin/website/coaches/[id]/route.ts
// PATCH /api/admin/website/coaches/[id] — updates an existing coach.
// DELETE /api/admin/website/coaches/[id] — permanently deletes a coach.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateCoach, deleteCoach } from '@/lib/website-coaches-supabase';

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
    const { name, qualification, bio, active } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!qualification || typeof qualification !== 'string' || qualification.trim() === '') {
      return NextResponse.json({ error: 'qualification is required' }, { status: 400 });
    }

    try {
      await updateCoach(id, {
        name: name.trim(),
        qualification: qualification.trim(),
        bio: typeof bio === 'string' && bio.trim() !== '' ? bio.trim() : null,
        active: active !== false,
      });
    } catch {
      return NextResponse.json({ error: 'Coach not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/coaches/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to update coach' }, { status: 500 });
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
      await deleteCoach(id);
    } catch {
      return NextResponse.json({ error: 'Coach not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/coaches/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete coach' }, { status: 500 });
  }
}
