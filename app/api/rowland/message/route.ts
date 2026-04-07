// app/api/rowland/message/route.ts
// GET (public) — returns the Rowland Cup message
// PUT (committee only) — updates the message

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getRowlandMessage, setRowlandMessage } from '@/lib/rowland-sheets';

export async function GET() {
  try {
    const message = await getRowlandMessage();
    return NextResponse.json({ message });
  } catch (err) {
    console.error('GET /api/rowland/message error:', err);
    return NextResponse.json({ error: 'Failed to load message' }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user?.role ?? '';
  if (role === 'Member' || role === 'Kiosk' || role === 'Club' || role === '') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const message = typeof body.message === 'string' ? body.message : '';

  try {
    await setRowlandMessage(message);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('PUT /api/rowland/message error:', err);
    return NextResponse.json({ error: 'Failed to save message' }, { status: 500 });
  }
}
