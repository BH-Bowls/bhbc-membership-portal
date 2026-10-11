// app/api/halve-it/settings/route.ts
// Halve It league settings (Darts role / Admin).
// PUT — save a season's settings (min games for the average table, best N games).

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/halveit-auth';
import { saveSettings } from '@/lib/halveit-supabase';
import type { HalveItSettings } from '@/types/halveit';

export async function PUT(request: NextRequest) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { season: number; settings: HalveItSettings };
    if (!Number.isInteger(body.season) || !body.settings) return NextResponse.json({ error: 'Season and settings are required' }, { status: 400 });
    const result = await saveSettings(body.season, body.settings);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PUT /api/halve-it/settings]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
