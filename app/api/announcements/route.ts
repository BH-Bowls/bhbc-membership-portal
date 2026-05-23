// app/api/announcements/route.ts
// GET /api/announcements — returns active (non-expired) announcements for the home page.
// Auth: session required. Uses shared announcement cache (30-min TTL).

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAnnouncementCache, setAnnouncementCache } from '@/lib/home-cache';
import { getActiveAnnouncements } from '@/lib/announcements-sheets';
import type { AnnouncementsResponse } from '@/types/diary';

// GET handler — returns active announcements, using cache where available
export async function GET() {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check the shared announcement cache first — avoids a Sheets call on every home page load
    const cached = getAnnouncementCache();
    if (cached !== null) {
      // Return cached data immediately
      const response: AnnouncementsResponse = { announcements: cached };
      return NextResponse.json(response);
    }

    // Cache miss — fetch fresh active announcements from the sheet
    const announcements = await getActiveAnnouncements();

    // Store result in cache for the next 30 minutes
    setAnnouncementCache(announcements);

    // Return active announcements
    const response: AnnouncementsResponse = { announcements };
    return NextResponse.json(response);
  } catch (error) {
    console.error('[GET /api/announcements] Error:', error);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }
}
