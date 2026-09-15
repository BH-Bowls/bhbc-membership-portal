// app/api/admin/website/announcements/[id]/route.ts
// PATCH /api/admin/website/announcements/[id] — updates an existing website announcement.
// DELETE /api/admin/website/announcements/[id] — permanently deletes a website announcement.
// Auth: Admin, Captain, or GMC role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { updateWebsiteAnnouncement, deleteWebsiteAnnouncement, type WebsiteAnnouncementType } from '@/lib/website-announcements-supabase';

const ALLOWED_TYPES: WebsiteAnnouncementType[] = ['open-day', 'visiting-side', 'event', 'notice'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
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

    try {
      await updateWebsiteAnnouncement(id, {
        title: title.trim(),
        body: message.trim(),
        type,
        cta_label: typeof cta_label === 'string' && cta_label.trim() !== '' ? cta_label.trim() : null,
        cta_url: typeof cta_url === 'string' && cta_url.trim() !== '' ? cta_url.trim() : null,
        start_date,
        end_date,
        active: active !== false,
      });
    } catch {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[PATCH /api/admin/website/announcements/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to update announcement' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!hasRole(session.user.role, 'Admin', 'Captain', 'GMC')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;

    try {
      await deleteWebsiteAnnouncement(id);
    } catch {
      return NextResponse.json({ error: 'Announcement not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[DELETE /api/admin/website/announcements/[id]] Error:', error);
    return NextResponse.json({ error: 'Failed to delete announcement' }, { status: 500 });
  }
}
