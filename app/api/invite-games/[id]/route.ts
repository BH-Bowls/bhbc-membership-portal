// app/api/invite-games/[id]/route.ts
// API routes for a single invite game — GET + PUT + DELETE

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getInviteGameById,
  updateInviteGame,
  deleteInviteGame,
} from '@/lib/invite-games-sheets';
import { getAttachmentsByInviteGameId, deleteInviteGameAttachment } from '@/lib/invite-games-attachments-sheets';
import { deleteFileFromCloudinary } from '@/lib/cloudinary';
import { hasRole } from '@/lib/role-utils';

/**
 * GET /api/invite-games/[id]
 * Return a single invite game
 */
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

    if (!game) {
      return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });
    }

    const isCommittee = hasRole(session.user.role, 'GMC', 'Admin');

    return NextResponse.json({ game, isCommittee });
  } catch (error) {
    console.error(`[GET /api/invite-games/${inviteGameId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to fetch invite game' }, { status: 500 });
  }
}

/**
 * PUT /api/invite-games/[id]
 * Update an invite game (committee only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isCommittee = hasRole(session.user.role, 'GMC', 'Admin');

    if (!isCommittee) {
      return NextResponse.json(
        { error: 'Only committee members can edit invite games' },
        { status: 403 }
      );
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) {
      return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });
    }

    const body = await request.json();
    const { title, description, closingDate, gameDate } = body;

    if (title !== undefined && !title?.trim()) {
      return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 });
    }

    const updates: any = {};
    if (title !== undefined) updates.title = title.trim();
    if (description !== undefined) updates.description = description.trim();
    if ('closingDate' in body) updates.closingDate = closingDate || null;
    if ('gameDate' in body) updates.gameDate = gameDate || null;

    const result = await updateInviteGame(inviteGameId, updates, session.user.userName);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to update invite game' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[PUT /api/invite-games/${inviteGameId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to update invite game' }, { status: 500 });
  }
}

/**
 * DELETE /api/invite-games/[id]
 * Delete an invite game and all its attachments (committee only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: inviteGameId } = await params;

  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const isCommittee = hasRole(session.user.role, 'GMC', 'Admin');

    if (!isCommittee) {
      return NextResponse.json(
        { error: 'Only committee members can delete invite games' },
        { status: 403 }
      );
    }

    const game = await getInviteGameById(inviteGameId);
    if (!game) {
      return NextResponse.json({ error: 'Invite game not found' }, { status: 404 });
    }

    // Delete all attachments first (Cloudinary + sheet rows)
    const attachments = await getAttachmentsByInviteGameId(inviteGameId);
    for (const attachment of attachments) {
      if (attachment.driveFileId) {
        try {
          await deleteFileFromCloudinary(attachment.driveFileId);
        } catch (e) {
          console.error('[DELETE invite game] Cloudinary delete failed:', e);
        }
      }
      await deleteInviteGameAttachment(attachment.attachmentId);
    }

    // Delete the game row
    const result = await deleteInviteGame(inviteGameId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to delete invite game' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(`[DELETE /api/invite-games/${inviteGameId}] Error:`, error);
    return NextResponse.json({ error: 'Failed to delete invite game' }, { status: 500 });
  }
}
