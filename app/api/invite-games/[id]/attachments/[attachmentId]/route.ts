// app/api/invite-games/[id]/attachments/[attachmentId]/route.ts
// API route for individual invite game attachment — GET (download/view) + DELETE

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getInviteGameAttachmentById,
  deleteInviteGameAttachment,
} from '@/lib/invite-games-attachments-sheets';
import { deleteFileFromCloudinary, fetchFileFromCloudinary } from '@/lib/cloudinary';

const MIME_FROM_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
};

/**
 * GET /api/invite-games/[id]/attachments/[attachmentId]
 * Serve the attachment file proxied through the server.
 * ?inline=true → Content-Disposition: inline
 * (default)    → Content-Disposition: attachment (download)
 */
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
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (attachment.inviteGameId !== inviteGameId) {
      return NextResponse.json(
        { error: 'Attachment does not belong to this invite game' },
        { status: 400 }
      );
    }

    if (attachment.type === 'link') {
      return NextResponse.redirect(attachment.url);
    }

    if (!attachment.driveFileId) {
      return NextResponse.json({ error: 'File not available' }, { status: 404 });
    }

    const resourceType = attachment.type === 'image' ? 'image' : 'raw';
    const { buffer, contentType: cloudinaryContentType } =
      await fetchFileFromCloudinary(attachment.driveFileId, resourceType as 'image' | 'raw');

    let contentType = attachment.mimeType || cloudinaryContentType;
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = attachment.fileName?.match(/\.[^/.]+$/)?.[0]?.toLowerCase();
      if (ext && MIME_FROM_EXTENSION[ext]) {
        contentType = MIME_FROM_EXTENSION[ext];
      }
    }

    const inline = request.nextUrl.searchParams.get('inline') === 'true';
    const filename = attachment.fileName || attachment.description || 'download';
    const disposition = inline
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': disposition,
        'Content-Length': buffer.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error(
      `[GET /api/invite-games/${inviteGameId}/attachments/${attachmentId}] Error:`,
      error
    );
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}

/**
 * DELETE /api/invite-games/[id]/attachments/[attachmentId]
 * Delete an attachment (committee only)
 */
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

    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

    if (!isCommittee) {
      return NextResponse.json(
        { error: 'Only committee members can delete attachments from invite games' },
        { status: 403 }
      );
    }

    const attachment = await getInviteGameAttachmentById(attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    if (attachment.inviteGameId !== inviteGameId) {
      return NextResponse.json(
        { error: 'Attachment does not belong to this invite game' },
        { status: 400 }
      );
    }

    if (attachment.driveFileId) {
      try {
        await deleteFileFromCloudinary(attachment.driveFileId);
      } catch (error) {
        console.error('[DELETE attachment] Cloudinary delete failed:', error);
      }
    }

    const result = await deleteInviteGameAttachment(attachmentId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(
      `[DELETE /api/invite-games/${inviteGameId}/attachments/${attachmentId}] Error:`,
      error
    );
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
