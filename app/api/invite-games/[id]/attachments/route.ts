// app/api/invite-games/[id]/attachments/route.ts
// GET list + POST confirm-upload for invite game attachments (committee only).

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAttachmentsByInviteGameId,
  createInviteGameAttachment,
  validateInviteGameAttachments,
} from '@/lib/invite-games-attachments-sheets';
import { getInviteGameById } from '@/lib/invite-games-sheets';
import { hasRole } from '@/lib/role-utils';
import { setPublicReadPermission, driveViewUrl } from '@/lib/drive';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });

    const attachments = await validateInviteGameAttachments(inviteGameId);
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error(`[GET /api/invite-games/${inviteGameId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!hasRole(session.user.role, 'GMC', 'Admin')) {
      return NextResponse.json(
        { error: 'Only committee members can add attachments to invite games' },
        { status: 403 }
      );
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });

    const body = await request.json();
    const { type, description, url, fileId, fileName, mimeType, fileSize } = body;

    if (!type || !description) {
      return NextResponse.json({ error: 'Type and description are required' }, { status: 400 });
    }
    if (!['link', 'image', 'document'].includes(type)) {
      return NextResponse.json({ error: 'Invalid attachment type' }, { status: 400 });
    }

    let attachmentData: any = {
      inviteGameId,
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

    const result = await createInviteGameAttachment(attachmentData);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to create attachment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachmentId: result.attachmentId });
  } catch (error) {
    console.error(`[POST /api/invite-games/${inviteGameId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to save attachment' }, { status: 500 });
  }
}
