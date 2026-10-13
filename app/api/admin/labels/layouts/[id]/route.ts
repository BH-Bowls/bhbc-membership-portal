// app/api/admin/labels/layouts/[id]/route.ts
// One label-sheet layout (Admin only).
// PUT    → save changes to a layout
// DELETE → delete a layout (not the last one, nor any label type's default)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfig } from '@/lib/config-supabase';
import { deleteLabelLayout, updateLabelLayout } from '@/lib/label-layouts-supabase';
import { LABEL_TYPES, defaultLayoutKey } from '@/types/label-layouts';
import type { LabelLayoutInput } from '@/types/label-layouts';

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
    const body = (await request.json()) as LabelLayoutInput;
    const result = await updateLabelLayout(id, body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ layout: result.layout });
  } catch (error) {
    console.error('[PUT /api/admin/labels/layouts/[id]]', error);
    return NextResponse.json({ error: 'Failed to save label layout' }, { status: 500 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const { id } = await params;
    const config = await getConfig();
    const defaultIds: string[] = [];
    for (const t of LABEL_TYPES) {
      const defaultId = config[defaultLayoutKey(t.id)];
      if (defaultId) defaultIds.push(defaultId);
    }
    const result = await deleteLabelLayout(id, defaultIds);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/labels/layouts/[id]]', error);
    return NextResponse.json({ error: 'Failed to delete label layout' }, { status: 500 });
  }
}
