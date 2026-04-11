// app/api/leagues/[leagueId]/attachments/[attachmentId]/route.ts
// GET (proxy/download) + DELETE for a single league attachment

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getLeagueAttachmentById,
  deleteLeagueAttachment,
} from '@/lib/leagues-attachments-sheets';
import { deleteFileFromCloudinary, fetchFileFromCloudinary } from '@/lib/cloudinary';
import { hasRole } from '@/lib/role-utils';

const MIME_FROM_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.txt': 'text/plain',
};

/**
 * GET /api/leagues/[leagueId]/attachments/[attachmentId]
 * ?inline=true → view in browser; default → download
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; attachmentId: string }> }
) {
  const { leagueId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const attachment = await getLeagueAttachmentById(attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    if (attachment.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Attachment does not belong to this league' }, { status: 400 });
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
      if (ext && MIME_FROM_EXTENSION[ext]) contentType = MIME_FROM_EXTENSION[ext];
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
    console.error(`[GET /api/leagues/${leagueId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch attachment' }, { status: 500 });
  }
}

/**
 * DELETE /api/leagues/[leagueId]/attachments/[attachmentId]
 * Committee only.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ leagueId: string; attachmentId: string }> }
) {
  const { leagueId, attachmentId } = await params;
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Captain', 'LeagueCaptain', 'Admin')) {
      return NextResponse.json({ error: 'Committee access required' }, { status: 403 });
    }

    const attachment = await getLeagueAttachmentById(attachmentId);
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    if (attachment.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Attachment does not belong to this league' }, { status: 400 });
    }

    if (attachment.driveFileId) {
      try { await deleteFileFromCloudinary(attachment.driveFileId); } catch { /* best effort */ }
    }

    const result = await deleteLeagueAttachment(attachmentId);
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to delete' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/leagues/${leagueId}/attachments/${attachmentId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
