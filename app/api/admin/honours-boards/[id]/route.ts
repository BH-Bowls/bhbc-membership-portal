// app/api/admin/honours-boards/[id]/route.ts
// One printed honours board layout (Admin only).
// PUT    → save changes to a board
// DELETE → delete a board

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { deleteHonoursBoard, updateHonoursBoard } from '@/lib/honours-boards-supabase';
import type { HonoursBoardInput } from '@/types/honours-boards';

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const body = (await request.json()) as HonoursBoardInput;
    const result = await updateHonoursBoard(id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ board: result.board });
  } catch (error) {
    console.error('[PUT /api/admin/honours-boards/[id]]', error);
    return NextResponse.json({ error: 'Failed to save honours board' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    await deleteHonoursBoard(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/honours-boards/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete honours board' }, { status: 500 });
  }
}
