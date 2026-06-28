// app/api/200-club/settings/route.ts
// POST — set the season prize table (draws, price, 1st/2nd/3rd). GMC or Admin.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { saveSettings, MAX_PRIZES, DEFAULT_NUMBERS } from '@/lib/two-hundred-club-sheets';

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
    if (!season) {
      return NextResponse.json({ error: 'Season is required' }, { status: 400 });
    }
    const num = (v: unknown) => { const n = parseFloat(String(v)); return isNaN(n) ? 0 : n; };

    // amounts: prize per position (1st = amounts[0]); length = number of prizes (1..MAX_PRIZES)
    const rawAmounts = Array.isArray(body.amounts) ? body.amounts : [];
    const amounts = rawAmounts.slice(0, MAX_PRIZES).map(num);
    if (amounts.length === 0) {
      return NextResponse.json({ error: 'Enter at least one prize amount' }, { status: 400 });
    }

    await saveSettings({
      season,
      draws: num(body.draws) || 6,
      price: num(body.price) || 6,
      numbers: num(body.numbers) || DEFAULT_NUMBERS,
      amounts,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[POST /api/200-club/settings]', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
