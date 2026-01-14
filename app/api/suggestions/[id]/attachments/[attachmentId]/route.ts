// app/api/suggestions/[id]/attachments/[attachmentId]/route.ts
// API route for deleting individual attachments

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAttachmentById, deleteAttachment } from '@/lib/attachments-sheets';
import { getSuggestionById } from '@/lib/suggestions-sheets';
import { deleteFileFromCloudinary } from '@/lib/cloudinary';

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

    // Mark as deleted in sheet
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
