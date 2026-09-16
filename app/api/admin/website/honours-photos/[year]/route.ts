// app/api/admin/website/honours-photos/[year]/route.ts
// GET /api/admin/website/honours-photos/[year] — every champions photo for this season.
// POST /api/admin/website/honours-photos/[year] — confirms an upload completed (the browser PUTs
//   bytes straight to Drive, bypassing this server) and triggers a website revalidate.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { listHonoursPhotos } from '@/lib/website-photos-drive';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year > 0 ? year : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year: yearParam } = await params;
    const year = parseYear(yearParam);
    if (!year) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

    const photos = await listHonoursPhotos(year);
    return NextResponse.json({ photos });
  } catch (error) {
    console.error('[GET /api/admin/website/honours-photos/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to load photos' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await revalidateWebsitePath('/honours');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/admin/website/honours-photos/[year]] Error:', error);
    return NextResponse.json({ error: 'Failed to revalidate' }, { status: 500 });
  }
}
