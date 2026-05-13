// app/api/suggestions/[id]/attachments/[attachmentId]/route.ts
// GET redirects browser to Drive (or Cloudinary proxy for legacy files).
// DELETE removes from Drive and from Sheets.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttachmentById, deleteAttachment } from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
import { deleteFileFromDrive, isDriveFileId, driveEmbedUrl, driveViewUrl, driveDownloadUrl } from '@/lib/drive';
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

    // Drive files — redirect browser directly to Google (no Vercel proxy needed)
    if (isDriveFileId(attachment.driveFileId)) {
      const inline = request.nextUrl.searchParams.get('inline') === 'true';
      const url = inline ? driveEmbedUrl(attachment.driveFileId) : driveDownloadUrl(attachment.driveFileId);
      return NextResponse.redirect(url);
    }

    // Legacy Cloudinary files — proxy through server
    const resourceType = attachment.type === 'image' ? 'image' : 'raw';
    const { buffer, contentType: cloudinaryContentType } =
      await fetchFileFromCloudinary(attachment.driveFileId, resourceType as 'image' | 'raw');

    let contentType = attachment.mimeType || cloudinaryContentType;
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = attachment.fileName?.match(/\.[^/.]+$/)?.[0]?.toLowerCase();
      if (ext && MIME_FROM_EXTENSION[ext]) contentType = MIME_FROM_EXTENSION[ext];
    }

    const inline = request.nextUrl.searchParams.get('inline') === 'true';
    const filename = attachment.fileName || attachment.description || 'download';
    const disposition = inline ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`;

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
    const role = session.user.role || 'Member';
    const isCommittee = role !== 'Member' && role !== '';

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
        if (isDriveFileId(attachment.driveFileId)) {
          await deleteFileFromDrive(attachment.driveFileId);
        } else {
          await deleteFileFromCloudinary(attachment.driveFileId);
        }
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
