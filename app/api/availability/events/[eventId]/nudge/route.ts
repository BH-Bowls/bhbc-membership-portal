// app/api/availability/events/[eventId]/nudge/route.ts
// Republish / remind: re-send the poll invite email to a chosen set of recipients.
// Body (all optional): { target: 'nonresponders' | 'all' | 'selected', selectedUserNames: string[], message: string }
// Defaults to non-responders (the old "nudge" behaviour) when no body is sent.

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getResponsesForEvent,
} from '@/lib/availability-events-sheets';
import { ensureGroupMemberTokens } from '@/lib/availability-groups-sheets';
import { isEmailConfigured } from '@/lib/email/mailer';
import type { AvailabilityGroupMember } from '@/types/availability';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Verify the user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only the creator or an Admin may re-send poll emails
    const userName = session.user.userName;
    const userRole = session.user.role || '';
    if (event.createdByUsername !== userName && !hasRole(userRole, 'Admin')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email is not configured' }, { status: 500 });
    }

    // Parse the (optional) body — a bare POST defaults to reminding non-responders
    let target: 'nonresponders' | 'all' | 'selected' = 'nonresponders';
    let selectedUserNames: string[] = [];
    let message = '';
    try {
      const body = await request.json();
      if (body) {
        if (body.target === 'all' || body.target === 'selected' || body.target === 'nonresponders') {
          target = body.target;
        }
        if (Array.isArray(body.selectedUserNames)) {
          selectedUserNames = body.selectedUserNames.filter((u: unknown) => typeof u === 'string' && u);
        }
        if (typeof body.message === 'string') {
          message = body.message.trim();
        }
      }
    } catch {
      // No JSON body — keep the defaults
    }

    // The roster IS the group's members (each carrying a token, ensured here). No group → nobody.
    if (!event.groupId) {
      return NextResponse.json({ success: true, sentCount: 0 });
    }
    const members = await ensureGroupMemberTokens(event.groupId);
    const responses = await getResponsesForEvent(eventId);

    // Who has already responded (members keyed by userName, visitors by visitor email)
    const respondedUserNames = new Set<string>();
    const respondedVisitorEmails = new Set<string>();
    for (const r of responses) {
      if (r.respondentType === 'member' && r.userName) respondedUserNames.add(r.userName);
      if (r.respondentType === 'visitor' && r.visitorEmail) respondedVisitorEmails.add(r.visitorEmail);
    }

    // Resolve the recipient list from the chosen target
    let recipients: AvailabilityGroupMember[] = [];
    if (target === 'all') {
      recipients = members;
    } else if (target === 'selected') {
      const chosen = new Set(selectedUserNames);
      recipients = members.filter((m) => m.memberType === 'member' && m.userName !== '' && chosen.has(m.userName));
    } else {
      // non-responders
      recipients = members.filter((m) => {
        if (m.memberType === 'member') return !respondedUserNames.has(m.userName);
        return !respondedVisitorEmails.has(m.visitorEmail);
      });
    }

    if (recipients.length === 0) {
      return NextResponse.json({ success: true, sentCount: 0 });
    }

    // Reuse the unified sender — inherits the captain footer + Reply-To, tokenised links,
    // and the optional organiser message. Subject is framed as a reminder.
    const { sendEventInviteEmails } = await import('@/lib/email/availability');
    const sentCount = await sendEventInviteEmails(
      eventId,
      event.groupId,
      recipients,
      event.createdByUsername,
      { customMessage: message, subject: `Reminder: ${event.title}` }
    );

    return NextResponse.json({ success: true, sentCount });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/nudge] Error:', error);
    return NextResponse.json({ error: 'Failed to send emails' }, { status: 500 });
  }
}
