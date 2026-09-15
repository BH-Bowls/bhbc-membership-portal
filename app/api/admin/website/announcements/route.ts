// app/api/admin/website/announcements/route.ts
// GET /api/admin/website/announcements — all website announcements for the admin UI.
// POST /api/admin/website/announcements — creates a new website announcement.
// Auth: Admin, Captain, or GMC role required.
// Distinct from /api/admin/announcements, which manages the portal's own
// (public schema) home-page banners — this manages website.announcements.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { getAllWebsiteAnnouncements, createWebsiteAnnouncement, type WebsiteAnnouncementType } from '@/lib/website-announcements-supabase';

const ALLOWED_TYPES: WebsiteAnnouncementType[] = ['open-day', 'visiting-side', 'event', 'notice'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const announcements = await getAllWebsiteAnnouncements();
    return NextResponse.json({ announcements });
  } catch (error) {
    console.error('[GET /api/admin/website/announcements] Error:', error);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const { title, body: message, type, cta_label, cta_url, start_date, end_date, active } = body;

    if (!title || typeof title !== 'string' || title.trim() === '') {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return NextResponse.json({ error: 'body is required' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` }, { status: 400 });
    }
    if (typeof start_date !== 'string' || !DATE_RE.test(start_date)) {
      return NextResponse.json({ error: 'start_date must be a YYYY-MM-DD date' }, { status: 400 });
    }
    if (typeof end_date !== 'string' || !DATE_RE.test(end_date)) {
      return NextResponse.json({ error: 'end_date must be a YYYY-MM-DD date' }, { status: 400 });
    }
    if (end_date < start_date) {
      return NextResponse.json({ error: 'end_date must not be before start_date' }, { status: 400 });
    }

    const announcement = await createWebsiteAnnouncement({
      title: title.trim(),
      body: message.trim(),
      type,
      cta_label: typeof cta_label === 'string' && cta_label.trim() !== '' ? cta_label.trim() : null,
      cta_url: typeof cta_url === 'string' && cta_url.trim() !== '' ? cta_url.trim() : null,
      start_date,
      end_date,
      active: active !== false,
    });

    return NextResponse.json({ success: true, announcement });
  } catch (error) {
    console.error('[POST /api/admin/website/announcements] Error:', error);
    return NextResponse.json({ error: 'Failed to create announcement' }, { status: 500 });
  }
}
