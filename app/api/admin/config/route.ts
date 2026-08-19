// app/api/admin/config/route.ts
// GET  → fetch all app config key-value pairs
// POST → update one or more config keys
// Canonical config endpoint — backs app/admin/config (General + Labels tabs).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getConfig, updateConfig } from '@/lib/config-supabase';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const config = await getConfig();
    return NextResponse.json({ config });
  } catch (error) {
    console.error('[GET /api/admin/config]', error);
    return NextResponse.json({ error: 'Failed to load config' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!hasRole(session.user?.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const updates = await request.json() as Record<string, string>;
    await updateConfig(updates);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/admin/config]', error);
    return NextResponse.json({ error: 'Failed to save config' }, { status: 500 });
  }
}
