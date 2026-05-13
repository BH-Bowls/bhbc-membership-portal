// app/api/friendlies/manage/message/route.ts
// PUT — update special instructions message for a game (Captain/Admin only)

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { updateGameMessage } from '@/lib/friendlies-sheets';
import { hasRole } from '@/lib/role-utils';

export async function PUT(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const role = session.user?.role ?? '';
  if (!hasRole(role, 'Captain', 'Admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const tabName = typeof body.tab_name === 'string' ? body.tab_name : '';
  const rowNumber = typeof body.row_number === 'number' ? body.row_number : undefined;
  const message = typeof body.message === 'string' ? body.message : '';

  if (!tabName && !rowNumber) {
    return NextResponse.json({ error: 'tab_name or row_number is required' }, { status: 400 });
  }

  try {
    await updateGameMessage(tabName, message, rowNumber, session.user?.userName);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('PUT /api/friendlies/manage/message error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save message' }, { status: 500 });
  }
}
