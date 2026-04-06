// app/api/competitions/message/route.ts
// GET (public) — returns the competitions message
// PUT (Captain/Admin) — updates the message

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getCompetitionMessage, setCompetitionMessage } from '@/lib/competitions-sheets';

export async function GET() {
  try {
    const message = await getCompetitionMessage();
    return NextResponse.json({ message });
  } catch (err) {
    console.error('GET /api/competitions/message error:', err);
    return NextResponse.json({ error: 'Failed to load message' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user?.role ?? '';
  if (role === 'Member' || role === 'Kiosk' || role === '') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const message = typeof body.message === 'string' ? body.message : '';

  try {
    await setCompetitionMessage(message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/competitions/message error:', err);
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
}
