// app/api/200-club/draw/route.ts
// POST — record a draw's winning numbers (1st/2nd/3rd). GMC or Admin.
// The member + prize amount are resolved server-side from the entries + settings.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { recordDraw, MAX_PRIZES } from '@/lib/two-hundred-club-sheets';
import { sendWinnerEmails } from '@/lib/email/two-hundred-club';

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
    const date = (body.date ?? '').toString().trim();
    if (!season || !date) {
      return NextResponse.json({ error: 'Season and draw date are required' }, { status: 400 });
    }

    const picks = Array.isArray(body.picks)
      ? body.picks
          .map((p: { position: unknown; number: unknown }) => ({
            position: parseInt(String(p.position), 10),
            number: (p.number ?? '').toString().trim(),
          }))
          .filter((p: { position: number; number: string }) => p.number && p.position >= 1 && p.position <= MAX_PRIZES)
      : [];

    if (picks.length === 0) {
      return NextResponse.json({ error: 'Enter at least one winning number' }, { status: 400 });
    }

    const result = await recordDraw(season, date, picks);

    // Email each winner. Don't fail the draw if email has a hiccup.
    let emailed = 0;
    try {
      const sendResult = await sendWinnerEmails(season, result.winners);
      emailed = sendResult.sent;
    } catch (emailError) {
      console.error('[POST /api/200-club/draw] winner emails failed', emailError);
    }

    return NextResponse.json({ ok: true, recorded: result.recorded, emailed });
  } catch (error) {
    console.error('[POST /api/200-club/draw]', error);
    return NextResponse.json({ error: 'Failed to record draw' }, { status: 500 });
  }
}
