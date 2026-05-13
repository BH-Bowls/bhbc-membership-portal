// app/api/leagues/[leagueId]/attachments/route.ts
// GET list + POST confirm-upload for league attachments (committee only).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeagueAttachmentsByLeagueId,
  createLeagueAttachment,
} from '@/lib/leagues-attachments-sheets';
import { hasRole } from '@/lib/role-utils';
import { setPublicReadPermission, driveViewUrl } from '@/lib/drive';

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

    const body = await request.json();
    const { type, description, url, fileId, fileName, mimeType, fileSize } = body;

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
    } else {
      if (!fileId || !fileName || !mimeType) {
        return NextResponse.json({ error: 'fileId, fileName and mimeType are required' }, { status: 400 });
      }
      await setPublicReadPermission(fileId);
      attachmentData.driveFileId = fileId;
      attachmentData.url = driveViewUrl(fileId);
      attachmentData.fileName = fileName;
      attachmentData.mimeType = mimeType;
      attachmentData.fileSize = fileSize ?? null;
    }

    const result = await createLeagueAttachment(attachmentData);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to create attachment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachmentId: result.attachmentId });
  } catch (error) {
    console.error(`[POST /api/leagues/${leagueId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to save attachment' }, { status: 500 });
  }
}
