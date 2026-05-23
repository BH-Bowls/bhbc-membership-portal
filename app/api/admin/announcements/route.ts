// app/api/admin/announcements/route.ts
// GET /api/admin/announcements — all announcements (active and expired) for the admin UI.
// POST /api/admin/announcements — creates a new announcement.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllAnnouncements, createAnnouncement } from '@/lib/announcements-sheets';
import { clearAnnouncementCache } from '@/lib/home-cache';
import type { AdminAnnouncementsResponse } from '@/types/diary';

// GET handler — returns all announcements including expired (admin view, no cache)
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admin, Captain, or GMC may access the full announcements list
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Fetch all announcements — admin always sees fresh data (bypass cache)
    const announcements = await getAllAnnouncements();

    // Return all announcements including expired
    const response: AdminAnnouncementsResponse = { announcements };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/admin/announcements] Error:', error);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }
}

// POST handler — creates a new announcement
export async function POST(request: NextRequest) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admin, Captain, or GMC may create announcements
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

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

    // Create the announcement in the sheet
    const announcement = await createAnnouncement(message.trim(), expiresAt, session.user.userName);

    // Invalidate the shared announcement cache so the next home page load picks it up
    clearAnnouncementCache();

    // Return the newly created announcement
    return NextResponse.json({ success: true, announcement });
  } catch (error) {
    console.error('[POST /api/admin/announcements] Error:', error);
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
  }
}
