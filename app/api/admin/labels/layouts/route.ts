// app/api/admin/labels/layouts/route.ts
// Label-sheet layouts for Print Labels (Admin only).
// GET  → all layouts, plus each label type's default layout id
// POST → add a layout

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfig } from '@/lib/config-supabase';
import { createLabelLayout, getLabelLayouts } from '@/lib/label-layouts-supabase';
import { LABEL_TYPES, defaultLayoutKey } from '@/types/label-layouts';
import type { LabelLayoutInput, LabelType } from '@/types/label-layouts';

async function requireAdmin(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const [layouts, config] = await Promise.all([getLabelLayouts(), getConfig()]);
    const defaults: Partial<Record<LabelType, string>> = {};
    for (const t of LABEL_TYPES) {
      const id = config[defaultLayoutKey(t.id)];
      if (id) defaults[t.id] = id;
    }
    return NextResponse.json({ layouts, defaults });
  } catch (error) {
    console.error('[GET /api/admin/labels/layouts]', error);
    return NextResponse.json({ error: 'Failed to load label layouts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;
  try {
    const body = (await request.json()) as LabelLayoutInput;
    const result = await createLabelLayout(body);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ layout: result.layout });
  } catch (error) {
    console.error('[POST /api/admin/labels/layouts]', error);
    return NextResponse.json({ error: 'Failed to add label layout' }, { status: 500 });
  }
}
