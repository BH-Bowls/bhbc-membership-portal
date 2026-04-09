// app/api/leagues/message/route.ts
// GET (public) — returns the leagues message
// PUT (committee only) — updates the message

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getLeagueMessage, setLeagueMessage } from '@/lib/leagues-sheets';

export async function GET() {
  try {
    const message = await getLeagueMessage();
    return NextResponse.json({ message });
  } catch (err) {
    console.error('GET /api/leagues/message error:', err);
    return NextResponse.json({ error: 'Failed to load message' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = session.user?.role ?? '';
  if (role === 'Member' || role === 'Kiosk' || role === 'Club' || role === '') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const message = typeof body.message === 'string' ? body.message : '';

  try {
    await setLeagueMessage(message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/leagues/message error:', err);
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
}
