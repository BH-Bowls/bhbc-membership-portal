// app/api/bar/devices/route.ts
// POST — register a till device's id + pairing code. Called by the till itself before
// it's logged in (the till has no session yet at this point), so this is deliberately
// unauthenticated — it only ever creates an unapproved, powerless pending row; nothing
// works until an admin approves it on /admin/bar-devices using the code shown on the
// till's own screen.

import { NextRequest, NextResponse } from 'next/server';
import { registerDevice } from '@/lib/bar-devices-supabase';

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.deviceId || !body.pairingCode) {
    return NextResponse.json({ error: 'deviceId and pairingCode are required' }, { status: 400 });
  }
  try {
    await registerDevice(body.deviceId, body.pairingCode);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to register device' }, { status: 500 });
  }
}
