// app/api/leagues/[leagueId]/attachments/route.ts
// GET list + POST upload for league attachments (rules documents)

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeagueAttachmentsByLeagueId,
  createLeagueAttachment,
} from '@/lib/leagues-attachments-sheets';
import { uploadFileToCloudinary } from '@/lib/cloudinary';
import { hasRole } from '@/lib/role-utils';

/**
 * GET /api/leagues/[leagueId]/attachments
 * Any authenticated user can view.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const attachments = await getLeagueAttachmentsByLeagueId(leagueId);
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error(`[GET /api/leagues/${leagueId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

/**
 * POST /api/leagues/[leagueId]/attachments
 * Committee only (Captain, LeagueOrganiser, Admin).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string }> }
) {
  const { leagueId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'LeagueOrganiser', 'Admin')) {
      return NextResponse.json({ error: 'Committee access required' }, { status: 403 });
    }

    const formData = await request.formData();
    const type = formData.get('type') as string;
    const description = formData.get('description') as string;
    const url = formData.get('url') as string | null;
    const file = formData.get('file') as File | null;

    if (!type || !description) {
      return NextResponse.json({ error: 'Type and description are required' }, { status: 400 });
    }

    let attachmentData: any = {
      leagueId,
      type,
      description,
      addedByUsername: session.user.userName,
    };

    if (type === 'link') {
      if (!url) return NextResponse.json({ error: 'URL is required for links' }, { status: 400 });
      attachmentData.url = url;
    } else if (file) {
      const maxSize = 50 * 1024 * 1024;
      if (file.size > maxSize) {
        return NextResponse.json({ error: 'File size exceeds 50MB limit' }, { status: 400 });
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const cloudinaryFile = await uploadFileToCloudinary(
        leagueId,
        buffer,
        file.name,
        file.type,
        'bhbc-leagues'
      );

      attachmentData.driveFileId = cloudinaryFile.publicId;
      attachmentData.url = cloudinaryFile.secureUrl;
      attachmentData.fileName = file.name;
      attachmentData.mimeType = file.type;
      attachmentData.fileSize = file.size;
    } else {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const result = await createLeagueAttachment(attachmentData);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to create attachment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachmentId: result.attachmentId });
  } catch (error) {
    console.error(`[POST /api/leagues/${leagueId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
