// app/api/200-club/assign/route.ts
// POST — assign or clear a number's holder for a season. GMC or Admin.
// Body: { season, number, username, expected? }. Empty username = clear the number.
// expected (optional) = the current holder as the page showed it; 409 if it has changed.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { assignNumber, getHolder } from '@/lib/two-hundred-club-supabase';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'GMC', 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const season = (body.season ?? '').toString().trim();
    const number = (body.number ?? '').toString().trim();
    const username = (body.username ?? '').toString().trim();
    if (!season || !number) {
      return NextResponse.json({ error: 'Season and number are required' }, { status: 400 });
    }

    // `expected` = the holder the page showed ('' = unallocated). If the number has
    // changed hands since (e.g. a member picked it on their renewal), refuse rather
    // than overwrite it — the page reloads and shows who holds it now.
    if (typeof body.expected === 'string') {
      const holder = await getHolder(season, number);
      if (holder.toLowerCase() !== body.expected.trim().toLowerCase()) {
        return NextResponse.json(
          { error: `Number ${number} has changed since this page loaded${holder ? ' — it has been taken' : ''}. The list has been refreshed; please check and try again.` },
          { status: 409 }
        );
      }
    }

    await assignNumber(season, number, username);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/200-club/assign]', error);
    return NextResponse.json({ error: 'Failed to update number' }, { status: 500 });
  }
}
