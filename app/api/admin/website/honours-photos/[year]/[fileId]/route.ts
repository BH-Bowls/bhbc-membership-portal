// app/api/admin/website/honours-photos/[year]/[fileId]/route.ts
// DELETE /api/admin/website/honours-photos/[year]/[fileId] — removes one champions photo.
// Auth: Admin, Captain, or GMC role required. `year` isn't needed to delete by
// file id, but keeping it in the path matches the GET/upload-session routes.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { deleteHonoursPhoto } from '@/lib/website-photos-drive';
import { revalidateWebsitePath } from '@/lib/revalidate-website';

export async function DELETE(
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

    const { fileId } = await params;

    try {
      await deleteHonoursPhoto(fileId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 500 });
    }

    await revalidateWebsitePath('/honours');
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/honours-photos/[year]/[fileId]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete photo' }, { status: 500 });
  }
}
