// app/api/suggestions/[id]/attachments/[attachmentId]/route.ts
// GET redirects the browser to the file on Google Drive.
// DELETE removes from Drive and from Sheets.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttachmentById, deleteAttachment } from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
import { isCommitteeMember } from '@/lib/role-utils';
import { deleteFileFromDrive, driveEmbedUrl, driveDownloadUrl } from '@/lib/drive';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: suggestionId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    if (attachment.suggestionId !== suggestionId) {
      return NextResponse.json({ error: 'Attachment does not belong to this suggestion' }, { status: 400 });
    }

    if (attachment.type === 'link') return NextResponse.redirect(attachment.url);

    if (!attachment.driveFileId) {
      return NextResponse.json({ error: 'File not available' }, { status: 404 });
    }

    // Redirect the browser directly to Google Drive (no Vercel proxy needed)
    const inline = request.nextUrl.searchParams.get('inline') === 'true';
    const url = inline ? driveEmbedUrl(attachment.driveFileId) : driveDownloadUrl(attachment.driveFileId);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error(`[GET /api/suggestions/${suggestionId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: suggestionId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userName = session.user.userName;
    // Multi-role aware — the previous raw compare treated Kiosk/Club as committee
    const isCommittee = isCommitteeMember(session.user.role);

    const attachment = await getAttachmentById(attachmentId);
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    if (attachment.suggestionId !== suggestionId) {
      return NextResponse.json({ error: 'Attachment does not belong to this suggestion' }, { status: 400 });
    }

    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });

    const isOwner = attachment.addedByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;
    if (!isCommittee && !isCoordinator && !isOwner) {
      return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
    }

    if (attachment.driveFileId) {
      try {
        await deleteFileFromDrive(attachment.driveFileId);
      } catch (error) {
        console.error('[DELETE attachment] File delete failed:', error);
      }
    }

    const result = await deleteAttachment(attachmentId);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete attachment' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/suggestions/${suggestionId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
