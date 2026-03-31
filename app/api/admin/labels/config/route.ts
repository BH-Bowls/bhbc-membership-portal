// app/api/admin/labels/config/route.ts
// GET  → fetch Labels config from Config spreadsheet
// POST → update Labels config

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getLabelConfig, updateLabelConfig } from '@/lib/config-sheets';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const config = await getLabelConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error('[GET /api/admin/labels/config]', error);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const updates = await request.json() as Record<string, string>;
    await updateLabelConfig(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/admin/labels/config]', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
