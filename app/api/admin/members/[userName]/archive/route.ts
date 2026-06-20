// app/api/admin/members/[userName]/archive/route.ts
// POST — archive an active member: move their row to the Leavers sheet with the
// reason/date/notes and delete it from Members. Sends no email.
// Auth: Admin role required.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import { clearDiaryCache } from '@/lib/home-cache';
import { normalizeToUKDate } from '@/lib/date-utils';
import { archiveMember } from '@/lib/leavers-sheets';

// Allowed reasons for archiving a member
const VALID_REASONS = ['Lapsed', 'Resigned', 'Deceased'];

// POST handler — archives the member identified in the route
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userName: string }> }
) {
  try {
    // Verify the user is logged in
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only Admins may archive members
    if (!hasRole(session.user.role, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The username to archive comes from the route segment
    const { userName } = await params;
    if (!userName) {
      return NextResponse.json({ error: 'userName is required' }, { status: 400 });
    }

    const body = await request.json();

    // Validate the reason
    if (!VALID_REASONS.includes(body.reason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${VALID_REASONS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate the left date
    if (!body.leftDate || typeof body.leftDate !== 'string') {
      return NextResponse.json({ error: 'leftDate is required' }, { status: 400 });
    }

    // Notes are optional
    let notes = '';
    if (typeof body.notes === 'string') {
      notes = body.notes.trim();
    }

    // Move the member to the Leavers sheet (DD/MM/YYYY date)
    const result = await archiveMember(
      userName,
      normalizeToUKDate(body.leftDate),
      body.reason,
      notes
    );
    if (!result.success) {
      // "Member not found" is a 404; anything else is a server error
      const status = result.error === 'Member not found' ? 404 : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    // Clear any cached diary data for the now-archived member
    clearDiaryCache(userName);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST archive] Error:', error);
    return NextResponse.json({ error: 'Failed to archive member' }, { status: 500 });
  }
}
