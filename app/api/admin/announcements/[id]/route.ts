// app/api/admin/announcements/[id]/route.ts
// PATCH /api/admin/announcements/[id] — updates message and expiry of an existing announcement.
// DELETE /api/admin/announcements/[id] — permanently deletes an announcement.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateAnnouncement, deleteAnnouncement } from '@/lib/announcements-sheets';
import { clearAnnouncementCache } from '@/lib/home-cache';

// PATCH handler — updates message and expiry of an existing announcement
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admin, Captain, or GMC may update announcements
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Extract the announcement ID from the dynamic route segment
    const { id } = await params;

    // Parse the request body
    const body = await request.json();
    const { message, expiresAt } = body;

    // Validate message — must be a non-empty string
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json(
        { error: 'message is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Validate expiresAt — must be present and a string
    if (!expiresAt || typeof expiresAt !== 'string') {
      return NextResponse.json(
        { error: 'expiresAt is required and must be an ISO datetime string' },
        { status: 400 }
      );
    }

    // Parse the datetime and confirm it is valid
    const expiresDate = new Date(expiresAt);
    if (isNaN(expiresDate.getTime())) {
      return NextResponse.json(
        { error: 'expiresAt must be a valid ISO datetime string' },
        { status: 400 }
      );
    }

    // Confirm expiresAt is in the future
    if (expiresDate <= new Date()) {
      return NextResponse.json(
        { error: 'expiresAt must be in the future' },
        { status: 400 }
      );
    }

    // Update the announcement in the sheet — updateAnnouncement throws if the ID is not found
    try {
      await updateAnnouncement(id, message.trim(), expiresAt, session.user.userName);
    } catch {
      // ID was not found in the sheet
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    // Invalidate the shared announcement cache
    clearAnnouncementCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/announcements/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
}

// DELETE handler — permanently removes an announcement row from the sheet
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admin, Captain, or GMC may delete announcements
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Extract the announcement ID from the dynamic route segment
    const { id } = await params;

    // Delete the announcement row from the sheet — deleteAnnouncement throws if the ID is not found
    try {
      await deleteAnnouncement(id);
    } catch {
      // ID was not found in the sheet
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    // Invalidate the shared announcement cache
    clearAnnouncementCache();

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/announcements/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 });
  }
}
