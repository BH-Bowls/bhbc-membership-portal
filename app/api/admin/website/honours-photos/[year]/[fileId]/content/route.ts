// app/api/admin/website/honours-photos/[year]/[fileId]/content/route.ts
// GET /api/admin/website/honours-photos/[year]/[fileId]/content — the photo itself, so the
// print page can draw a plaque under it in the browser. Only images in that season's
// Honours folder are served.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getHonoursPhotoContent } from '@/lib/website-photos-drive';

function parseYear(raw: string): number | null {
  const year = Number(raw);
  return Number.isInteger(year) && year > 0 ? year : null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string; fileId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { year: yearParam, fileId } = await params;
    const year = parseYear(yearParam);
    if (!year) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

    const photo = await getHonoursPhotoContent(year, fileId);
    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404 });

    return new NextResponse(photo.data, {
      headers: {
        'Content-Type': photo.mimeType,
        // Private: the photo is only for this signed-in admin's browser
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    console.error('[GET /api/admin/website/honours-photos/[year]/[fileId]/content] Error:', error);
    return NextResponse.json({ error: 'Failed to load the photo' }, { status: 500 });
  }
}
