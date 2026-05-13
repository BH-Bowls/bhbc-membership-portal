// app/api/attachments/upload-session/route.ts
// Creates a Google Drive resumable upload session.
// Returns a session URI the browser can PUT file bytes to directly,
// bypassing Vercel's 4.5 MB payload limit entirely.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getOrCreateEntityFolder, createResumableUploadSession } from '@/lib/drive';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { entityId, fileName, mimeType, category } = await request.json();

    if (!entityId || !fileName || !mimeType) {
      return NextResponse.json(
        { error: 'entityId, fileName and mimeType are required' },
        { status: 400 }
      );
    }

    const origin = request.headers.get('origin') ?? undefined;
    const folderId = await getOrCreateEntityFolder(entityId, category ?? undefined);
    const sessionUri = await createResumableUploadSession(fileName, mimeType, folderId, origin);

    return NextResponse.json({ sessionUri });
  } catch (error) {
    console.error('[POST /api/attachments/upload-session] Error:', error);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
