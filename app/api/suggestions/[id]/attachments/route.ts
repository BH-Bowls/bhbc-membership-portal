// app/api/suggestions/[id]/attachments/route.ts
// GET list + POST confirm-upload for suggestion attachments.
// File bytes never touch this route — the browser uploads directly to Drive
// via the session URI returned by /api/attachments/upload-session.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getAttachmentsBySuggestionId,
  createAttachment,
  validateAttachments,
} from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
import { isCommitteeMember } from '@/lib/role-utils';
import { setPublicReadPermission, driveViewUrl } from '@/lib/drive';

/**
 * GET /api/suggestions/[id]/attachments
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    const attachments = await validateAttachments(suggestionId);
    return NextResponse.json({ attachments });
  } catch (error) {
    console.error(`[GET /api/suggestions/${suggestionId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachments' }, { status: 500 });
  }
}

/**
 * POST /api/suggestions/[id]/attachments
 * Body (JSON):
 *   Links:  { type: 'link', description, url }
 *   Files:  { type: 'image'|'document', description, fileId, fileName, mimeType, fileSize }
 *           fileId is the Drive file ID returned by the browser after uploading to the session URI.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: suggestionId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userName = session.user.userName;
    // Multi-role aware — the previous raw compare treated Kiosk/Club as committee
    const isCommittee = isCommitteeMember(session.user.role);

    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    const isOwner = suggestion.createdByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;
    const canAddAttachment =
      isCommittee || isCoordinator || (isOwner && suggestion.committeeAcceptance !== 'Y');

    if (!canAddAttachment) {
      return NextResponse.json(
        { error: 'Only the suggestion owner (before acceptance), committee members, and coordinators can add attachments' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { type, description, url, fileId, fileName, mimeType, fileSize } = body;

    if (!type || !description) {
      return NextResponse.json({ error: 'Type and description are required' }, { status: 400 });
    }
    if (!['link', 'image', 'document'].includes(type)) {
      return NextResponse.json({ error: 'Invalid attachment type' }, { status: 400 });
    }

    let attachmentData: any = { suggestionId, type, description, addedByUsername: userName };

    if (type === 'link') {
      if (!url) return NextResponse.json({ error: 'URL is required for links' }, { status: 400 });
      attachmentData.url = url;
    } else {
      if (!fileId || !fileName || !mimeType) {
        return NextResponse.json({ error: 'fileId, fileName and mimeType are required' }, { status: 400 });
      }
      // Make file publicly readable (anyone with link can view)
      await setPublicReadPermission(fileId);

      attachmentData.driveFileId = fileId;
      attachmentData.url = driveViewUrl(fileId);
      attachmentData.fileName = fileName;
      attachmentData.mimeType = mimeType;
      attachmentData.fileSize = fileSize ?? null;
    }

    const result = await createAttachment(attachmentData);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to create attachment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, attachmentId: result.attachmentId });
  } catch (error) {
    console.error(`[POST /api/suggestions/${suggestionId}/attachments] Error:`, error);
    return NextResponse.json({ error: 'Failed to save attachment' }, { status: 500 });
  }
}
