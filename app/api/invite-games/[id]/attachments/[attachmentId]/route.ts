// app/api/invite-games/[id]/attachments/[attachmentId]/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getInviteGameAttachmentById,
  deleteInviteGameAttachment,
} from '@/lib/invite-games-attachments-supabase';
import { isCommitteeMember } from '@/lib/role-utils';
import { deleteFileFromDrive, driveEmbedUrl, driveDownloadUrl } from '@/lib/drive';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: inviteGameId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const attachment = await getInviteGameAttachmentById(attachmentId);
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    if (attachment.inviteGameId !== inviteGameId) {
      return NextResponse.json({ error: 'Attachment does not belong to this invite game' }, { status: 400 });
    }

    if (attachment.type === 'link') return NextResponse.redirect(attachment.url);
    if (!attachment.driveFileId) return NextResponse.json({ error: 'File not available' }, { status: 404 });

    // Redirect the browser directly to Google Drive
    const inline = request.nextUrl.searchParams.get('inline') === 'true';
    const url = inline ? driveEmbedUrl(attachment.driveFileId) : driveDownloadUrl(attachment.driveFileId);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error(`[GET /api/invite-games/${inviteGameId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const { id: inviteGameId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Committee only — multi-role aware (the previous blocklist let Kiosk/Club through)
    if (!isCommitteeMember(session.user.role)) {
      return NextResponse.json({ error: 'Only committee members can delete attachments' }, { status: 403 });
    }

    const attachment = await getInviteGameAttachmentById(attachmentId);
    if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    if (attachment.inviteGameId !== inviteGameId) {
      return NextResponse.json({ error: 'Attachment does not belong to this invite game' }, { status: 400 });
    }

    if (attachment.driveFileId) {
      try {
        await deleteFileFromDrive(attachment.driveFileId);
      } catch { /* best effort */ }
    }

    const result = await deleteInviteGameAttachment(attachmentId);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/invite-games/${inviteGameId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
