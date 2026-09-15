// app/api/admin/website/documents/upload-session/route.ts
// Creates a Google Drive resumable upload session for a new website document PDF.
// Returns a session URI the browser PUTs file bytes to directly — same pattern
// as /api/attachments/upload-session, bypassing Vercel's payload limit.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { createWebsiteDocumentUploadSession } from '@/lib/website-documents-drive';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { category, fileName } = await request.json();

    if (!category || typeof category !== 'string' || category.trim() === '') {
      return NextResponse.json({ error: 'category is required' }, { status: 400 });
    }
    if (!fileName || typeof fileName !== 'string' || fileName.trim() === '') {
      return NextResponse.json({ error: 'fileName is required' }, { status: 400 });
    }
    if (!fileName.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files can be uploaded here' }, { status: 400 });
    }

    const origin = request.headers.get('origin') ?? undefined;

    let sessionUri: string;
    try {
      sessionUri = await createWebsiteDocumentUploadSession(category.trim(), fileName.trim(), origin);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json({ sessionUri });
  } catch (error) {
    console.error('[POST /api/admin/website/documents/upload-session] Error:', error);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
