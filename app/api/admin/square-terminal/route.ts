// app/api/admin/square-terminal/route.ts
// Square Terminal set-up (specs/RENEWALS_XERO_PAYMENTS_SPEC.md §10). Admin only.
// GET  — set-up status, sandbox test devices, and Terminal payments needing attention.
// POST — { action: 'pair', name }        get a sign-in code to enter on the Terminal
//        { action: 'check', codeId }     has the code been used? if so, save the device
//        { action: 'test-device', deviceId }  sandbox only: use a simulated Terminal
//        { action: 'unpair' }            stop using the Terminal (till goes back to the tick box)
//        { action: 'dealt-with', id }    a paid-but-not-recorded payment has been sorted by hand

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { createDeviceCode, getDeviceCode, isSquareSandbox, SANDBOX_TEST_DEVICES } from '@/lib/square';
import { getTerminalSetup, setTerminalDevice, getCheckoutsNeedingAttention, markCheckoutDealtWith } from '@/lib/bar-square';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const setup = await getTerminalSetup();
    const attention = await getCheckoutsNeedingAttention();
    return NextResponse.json({
      setup: setup,
      testDevices: setup.sandbox ? SANDBOX_TEST_DEVICES : [],
      attention: attention,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load the Terminal set-up';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !session.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === 'pair') {
      const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'Bar Terminal';
      const code = await createDeviceCode(name);
      return NextResponse.json({ code: code, name: name });
    }
    if (body.action === 'check') {
      if (typeof body.codeId !== 'string') return NextResponse.json({ error: 'codeId is required' }, { status: 400 });
      const code = await getDeviceCode(body.codeId);
      if (code.status === 'PAIRED' && code.deviceId) {
        const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : 'Bar Terminal';
        await setTerminalDevice(code.deviceId, name);
      }
      return NextResponse.json({ code: code });
    }
    if (body.action === 'test-device') {
      if (!isSquareSandbox()) return NextResponse.json({ error: 'Test devices only work in the Square sandbox' }, { status: 400 });
      let found = null;
      for (const d of SANDBOX_TEST_DEVICES) {
        if (d.id === body.deviceId) found = d;
      }
      if (!found) return NextResponse.json({ error: 'Unknown test device' }, { status: 400 });
      await setTerminalDevice(found.id, found.name);
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'unpair') {
      await setTerminalDevice('', '');
      return NextResponse.json({ ok: true });
    }
    if (body.action === 'dealt-with') {
      if (typeof body.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 });
      await markCheckoutDealtWith(body.id, session.user.userName || 'admin');
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Square request failed';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
