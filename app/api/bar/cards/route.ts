// app/api/bar/cards/route.ts
// GET — what the till needs to check membership card scans (offline too) and to know
// which members must scan a card or enter a PIN for Pay by Account / Top Up.
// See src/lib/bar-card.ts.

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { canUseBarTill } from '@/lib/role-utils';
import { getTillCards } from '@/lib/bar-card';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canUseBarTill(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    return NextResponse.json(await getTillCards());
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to load cards' }, { status: 500 });
  }
}
