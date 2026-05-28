// app/api/availability/events/[eventId]/nudge/route.ts
// Send reminder emails to invitees who have not yet responded

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { hasRole } from '@/lib/role-utils';
import {
  getEventById,
  getInviteesForEvent,
  getResponsesForEvent,
  markInviteesNotified,
} from '@/lib/availability-events-sheets';
import { getAllUsers, getUserByUsername } from '@/lib/sheets';
import { getGroupById, getGroupMembers } from '@/lib/availability-groups-sheets';
import { sendTemplateEmail, getEmailTransporter, isEmailConfigured } from '@/lib/email/mailer';
import { theme } from '@/config/theme';
import type { AvailabilityInvitee } from '@/types/availability';

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'https://members.burgesshill-bowls.co.uk';
}

// POST /api/availability/events/[eventId]/nudge
// Re-send invite emails to all invitees who have not yet responded
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !session.user || !session.user.userName) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const userName = session.user.userName;
    const userRole = session.user.role || '';
    const isAdmin = hasRole(userRole, 'Admin');
    const isCreator = event.createdByUsername === userName;

    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: 'Email is not configured' }, { status: 500 });
    }

    // Fetch invitees and responses
    const [invitees, responses] = await Promise.all([
      getInviteesForEvent(eventId),
      getResponsesForEvent(eventId),
    ]);

    // Build set of usernames that have already responded
    const respondedUserNames = new Set<string>();
    const respondedInviteeIds = new Set<string>();
    for (const r of responses) {
      if (r.respondentType === 'member' && r.userName) respondedUserNames.add(r.userName);
      if (r.inviteeId) respondedInviteeIds.add(r.inviteeId);
    }

    // Determine who to nudge.
    // For pre-v2 events (group event with no invitee records), fall back to group members.
    let nonResponders: AvailabilityInvitee[] = [];
    if (invitees.length > 0) {
      nonResponders = invitees.filter((inv) => {
        if (inv.inviteeType === 'member') return !respondedUserNames.has(inv.userName);
        return !respondedInviteeIds.has(inv.inviteeId);
      });
    } else if (event.groupId) {
      // No invitee records — build synthetic member invitees from the group
      const groupMembers = await getGroupMembers(event.groupId);
      for (const m of groupMembers) {
        if (m.memberType === 'member' && m.userName && !respondedUserNames.has(m.userName)) {
          nonResponders.push({
            inviteeId: '',           // no persisted invitee record
            eventId,
            groupMemberId: m.memberId,
            inviteeType: 'member',
            userName: m.userName,
            visitorName: '',
            visitorEmail: '',
            token: '',
            tokenExpiresAt: '',
            notifiedAt: '',
            createdAt: '',
          });
        }
      }
    }

    if (nonResponders.length === 0) {
      return NextResponse.json({ success: true, nudgedCount: 0 });
    }

    // Fetch sender display name
    const senderUser = await getUserByUsername(event.createdByUsername);
    const creatorName = senderUser
      ? (senderUser.fullKnownAs || senderUser.fullName || event.createdByUsername)
      : event.createdByUsername;

    let groupName = '';
    if (event.groupId) {
      const group = await getGroupById(event.groupId);
      if (group) groupName = group.name;
    }

    const expiresAtFormatted = new Date(event.expiresAt).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    const appUrl = getAppUrl();
    const notifiedIds: string[] = [];

    // Member non-responders: single BCC email
    const memberNonResponders = nonResponders.filter((i) => i.inviteeType === 'member');
    if (memberNonResponders.length > 0) {
      const allUsers = await getAllUsers();
      const memberEmails: string[] = [];
      for (const inv of memberNonResponders) {
        const u = allUsers.find((u) => u.userName === inv.userName);
        if (u && u.emailAddress) {
          memberEmails.push(u.emailAddress);
          notifiedIds.push(inv.inviteeId);
        }
      }
      if (memberEmails.length > 0) {
        const responseUrl = `${appUrl}/availability/events/${eventId}`;
        await sendTemplateEmail(
          memberEmails.join(', '),
          `Reminder: ${event.title}`,
          'availability-event-invite',
          {
            inviteeName: 'there',
            eventTitle: event.title,
            eventType: event.type,
            groupName,
            creatorName,
            expiresAtFormatted,
            responseUrl,
          }
        );
      }
    }

    // Visitor non-responders: individual emails with their token
    const visitorNonResponders = nonResponders.filter((i) => i.inviteeType === 'visitor');
    if (visitorNonResponders.length > 0) {
      const pooledTransporter = getEmailTransporter(true);
      const { readFileSync } = await import('fs');
      const { join } = await import('path');
      const Handlebars = (await import('handlebars')).default;
      const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-event-invite.html');
      const templateSource = readFileSync(templatePath, 'utf-8');
      const compiled = Handlebars.compile(templateSource);

      for (const inv of visitorNonResponders) {
        if (!inv.visitorEmail) continue;
        const responseUrl = `${appUrl}/availability/guest/${eventId}?token=${inv.token}`;
        const html = compiled({
          inviteeName: inv.visitorName,
          eventTitle: event.title,
          eventType: event.type,
          groupName,
          creatorName,
          expiresAtFormatted,
          responseUrl,
          BRAND_NAME: theme.brand.name,
          BRAND_SHORT_NAME: theme.brand.shortName,
          HEADER_COLOR: theme.email.headerColor,
          BUTTON_COLOR: theme.email.buttonColor,
          LINK_COLOR: theme.email.buttonColor,
          PRIMARY_COLOR: theme.email.headerColor,
        });
        try {
          await pooledTransporter.sendMail({
            from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
            to: inv.visitorEmail,
            subject: `Reminder: ${event.title}`,
            html,
          });
          notifiedIds.push(inv.inviteeId);
        } catch (err) {
          console.error(`[nudge] Failed to send reminder to visitor ${inv.visitorName}:`, err);
        }
      }
      pooledTransporter.close();
    }

    // Update notified_at for all nudged invitees (skip blank IDs from pre-v2 fallback)
    const realNotifiedIds = notifiedIds.filter((id) => id !== '');
    if (realNotifiedIds.length > 0) {
      try {
        await markInviteesNotified(realNotifiedIds);
      } catch (err) {
        console.error('[nudge] Failed to mark invitees notified:', err);
      }
    }

    return NextResponse.json({ success: true, nudgedCount: notifiedIds.length });
  } catch (error) {
    console.error('[POST /api/availability/events/[eventId]/nudge] Error:', error);
    return NextResponse.json({ error: 'Failed to send reminders' }, { status: 500 });
  }
}
