// app/api/suggestions/[id]/attachments/[attachmentId]/route.ts
// API route for individual attachment operations - GET (download/view) + DELETE

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttachmentById, deleteAttachment } from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
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
 * GET /api/suggestions/[id]/attachments/[attachmentId]
 * Serve the attachment file (proxied through the server to avoid Cloudinary 401).
 * Query params:
 *   ?inline=true  — serve with Content-Disposition: inline  (for PDFs / viewable files)
 *   (default)     — serve with Content-Disposition: attachment (triggers download)
 */
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

    // Get attachment
    const attachment = await getAttachmentById(attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Verify attachment belongs to this suggestion
    if (attachment.suggestionId !== suggestionId) {
      return NextResponse.json({ error: 'Attachment does not belong to this suggestion' }, { status: 400 });
    }

    // For links, just redirect
    if (attachment.type === 'link') {
      return NextResponse.redirect(attachment.url);
    }

    // Must have a Cloudinary publicId
    if (!attachment.driveFileId) {
      return NextResponse.json({ error: 'File not available' }, { status: 404 });
    }

    // Determine resource type
    const resourceType = attachment.type === 'image' ? 'image' : 'raw';

    // Fetch from Cloudinary (server-side — authenticated, no 401)
    const { buffer, contentType: cloudinaryContentType } =
      await fetchFileFromCloudinary(attachment.driveFileId, resourceType as 'image' | 'raw');

    // Work out the best Content-Type
    let contentType = attachment.mimeType || cloudinaryContentType;
    if (!contentType || contentType === 'application/octet-stream') {
      const ext = attachment.fileName?.match(/\.[^/.]+$/)?.[0]?.toLowerCase();
      if (ext && MIME_FROM_EXTENSION[ext]) {
        contentType = MIME_FROM_EXTENSION[ext];
      }
    }

    // Determine disposition (inline vs attachment)
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
    console.error(`[GET /api/suggestions/${suggestionId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch attachment' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suggestions/[id]/attachments/[attachmentId]
 * Delete an attachment
 */
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

    // Get attachment
    const attachment = await getAttachmentById(attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }

    // Verify attachment belongs to this suggestion
    if (attachment.suggestionId !== suggestionId) {
      return NextResponse.json({ error: 'Attachment does not belong to this suggestion' }, { status: 400 });
    }

    // Get suggestion
    const suggestion = await getSuggestionById(suggestionId);
    if (!suggestion) {
      return NextResponse.json({ error: 'Suggestion not found' }, { status: 404 });
    }

    // Check permissions
    const isOwner = attachment.addedByUsername === userName;
    const isCoordinator = suggestion.coordinatorUsername === userName;
    const canDelete = isCommittee || isCoordinator || isOwner;

    if (!canDelete) {
      return NextResponse.json(
        { error: 'Only the attachment owner, committee members, and coordinators can delete attachments' },
        { status: 403 }
      );
    }

    // Delete from Cloudinary if it's a file
    if (attachment.driveFileId) {
      try {
        await deleteFileFromCloudinary(attachment.driveFileId);
      } catch (error) {
        console.error('[DELETE attachment] Error deleting from Cloudinary:', error);
        // Continue even if Cloudinary deletion fails (file might already be deleted)
      }
    }

    // Delete row from sheet
    const result = await deleteAttachment(attachmentId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete attachment' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/suggestions/${suggestionId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }
}
