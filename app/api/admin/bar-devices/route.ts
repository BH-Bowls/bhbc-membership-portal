// app/api/admin/bar-devices/route.ts
// GET  — list every till device (pending, approved, revoked). Admin only.
// POST — approve (requires the pairing code shown on the physical device) or revoke.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listDevices, approveDevice, revokeDevice } from '@/lib/bar-devices-supabase';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json({ devices: await listDevices() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load devices' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasRole(session.user.role, 'Admin')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  try {
    if (body.action === 'approve') {
      if (!body.deviceId || !body.pairingCode || !body.label) {
        return NextResponse.json({ error: 'deviceId, pairingCode and label are required' }, { status: 400 });
      }
      await approveDevice(body.deviceId, body.pairingCode, body.label, session.user.userName);
    } else if (body.action === 'revoke') {
      if (!body.deviceId) return NextResponse.json({ error: 'deviceId is required' }, { status: 400 });
      await revokeDevice(body.deviceId, session.user.userName);
    } else {
      return NextResponse.json({ error: 'action must be "approve" or "revoke"' }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to update device' }, { status: 400 });
  }
}
