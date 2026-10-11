// app/api/halve-it/nights/route.ts
// Halve It nights (Darts role / Admin).
// POST — start a new night (as a draft) on a date; its season comes from the date.

import { NextRequest, NextResponse } from 'next/server';
import { requireManager } from '@/lib/halveit-auth';
import { createNight } from '@/lib/halveit-supabase';

export async function POST(request: NextRequest) {
  const denied = await requireManager();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { date: string };
    const result = await createNight(body.date);
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ night: result.night });
  } catch (error) {
    console.error('[POST /api/halve-it/nights]', error);
    return NextResponse.json({ error: 'Failed to create night' }, { status: 500 });
  }
}
