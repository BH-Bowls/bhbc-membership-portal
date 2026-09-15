// app/api/admin/website/honours-photos/[year]/upload-session/route.ts
// Creates a Drive resumable upload session for an Honours champions photo.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { createHonoursPhotoUploadSession } from '@/lib/website-photos-drive';

function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year > 0 ? year : null;
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

    const { year: yearParam } = await params;
    const year = parseYear(yearParam);
    if (!year) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

    const { fileName } = await request.json();
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }

    const origin = request.headers.get('origin') ?? undefined;
    const sessionUri = await createHonoursPhotoUploadSession(year, fileName.trim(), origin);

    return NextResponse.json({ sessionUri });
  } catch (error) {
    console.error('[POST /api/admin/website/honours-photos/[year]/upload-session] Error:', error);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
