// app/api/admin/website/honours-external/route.ts
// GET /api/admin/website/honours-external — all external honours results for the admin UI.
// POST /api/admin/website/honours-external — creates a new external honours result.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllHonoursExternal, createHonoursExternal } from '@/lib/website-honours-external-supabase';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const rows = await getAllHonoursExternal();
    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[GET /api/admin/website/honours-external] Error:', error);
    return NextResponse.json({ error: 'Failed to load honours_external' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { year, competition, detail } = body;

    const yearNum = Number(year);
    if (!Number.isInteger(yearNum) || yearNum <= 0) {
      return NextResponse.json({ error: 'year must be a positive whole number' }, { status: 400 });
    }
    if (!competition || typeof competition !== 'string' || competition.trim() === '') {
      return NextResponse.json({ error: 'competition is required' }, { status: 400 });
    }

    const row = await createHonoursExternal({
      year: yearNum,
      competition: competition.trim(),
      detail: typeof detail === 'string' && detail.trim() !== '' ? detail.trim() : null,
    });

    await revalidateWebsitePath('/honours');
    return NextResponse.json({ success: true, row });
  } catch (error) {
    console.error('[POST /api/admin/website/honours-external] Error:', error);
    return NextResponse.json({ error: 'Failed to create honours_external row' }, { status: 500 });
  }
}
