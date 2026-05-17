// app/api/availability/[eventId]/invitees/route.ts
// API endpoint for adding more invitees to an existing private availability event

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  addInvitees,
  markInviteesNotified,
} from '@/lib/availability-sheets';
import { getUserByUsername, getAllUsers } from '@/lib/sheets';
import { getEmailTransporter, isEmailConfigured } from '@/lib/email/mailer';
import { hasRole } from '@/lib/role-utils';

// POST /api/availability/[eventId]/invitees
// Add new invitees to a private event and send them invite emails
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventId: string }> }
) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { eventId } = await params;

    // Fetch event to check access and settings
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can add invitees
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Only private events have an invitee list
    if (event.visibility !== 'private') {
      return NextResponse.json(
        { error: 'Invitees can only be added to private events' },
        { status: 400 }
      );
    }

    // Event must be open
    if (event.status !== 'open') {
      return NextResponse.json(
        { error: 'Invitees can only be added to open events' },
        { status: 400 }
      );
    }

    // Parse and validate body
    const body = await request.json();
    const memberUserNames: string[] = Array.isArray(body.memberUserNames) ? body.memberUserNames : [];
    const visitorInvitees: Array<{ visitorName: string; visitorEmail: string }> = Array.isArray(body.visitorInvitees) ? body.visitorInvitees : [];

    // At least one invitee required
    if (memberUserNames.length === 0 && visitorInvitees.length === 0) {
      return NextResponse.json(
        { error: 'At least one invitee is required' },
        { status: 400 }
      );
    }

    // Validate visitor invitees have required fields
    for (let i = 0; i < visitorInvitees.length; i++) {
      const vi = visitorInvitees[i];
      if (!vi.visitorName || !vi.visitorName.trim()) {
        return NextResponse.json(
          { error: `Visitor invitee ${i + 1} is missing a name` },
          { status: 400 }
        );
      }
      if (!vi.visitorEmail || !vi.visitorEmail.trim()) {
        return NextResponse.json(
          { error: `Visitor invitee ${i + 1} is missing an email address` },
          { status: 400 }
        );
      }
    }

    // Create invitee rows
    const createdInvitees = await addInvitees(
      eventId,
      event.expiresAt,
      memberUserNames,
      visitorInvitees
    );

    // Send invite emails to new invitees only
    if (isEmailConfigured() && createdInvitees.length > 0) {
      try {
        await sendNewInviteeEmails(eventId, event.title, event.expiresAt, event.createdByUsername, createdInvitees);
      } catch (emailError) {
        // Email failure does not block the response
        console.error('[invitees] Error sending invite emails:', emailError);
      }
    }

    return NextResponse.json({ success: true, addedCount: createdInvitees.length });
  } catch (error) {
    console.error('[POST /api/availability/[eventId]/invitees] Error:', error);
    return NextResponse.json({ error: 'Failed to add invitees' }, { status: 500 });
  }
}

// Send invite emails to newly added invitees
async function sendNewInviteeEmails(
  eventId: string,
  eventTitle: string,
  expiresAt: string,
  creatorUsername: string,
  createdInvitees: any[]
): Promise<void> {
  const creator = await getUserByUsername(creatorUsername);
  const creatorName = creator ? (creator.fullName || creatorUsername) : creatorUsername;

  // Format expiry date for display
  const expiryDate = new Date(expiresAt);
  const expiresAtFormatted = expiryDate.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const appUrl = process.env.NEXTAUTH_URL || '';
  const memberResponseUrl = `${appUrl}/availability/${eventId}`;

  // Load template
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const Handlebars = require('handlebars');
  const { theme } = require('@/config/theme');

  const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-invite.html');
  const templateSource = readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);

  const baseVars = {
    eventTitle,
    creatorName,
    expiresAtFormatted,
    BRAND_NAME: theme.brand.name,
    BRAND_SHORT_NAME: theme.brand.shortName,
    HEADER_COLOR: theme.email.headerColor,
    BUTTON_COLOR: theme.email.buttonColor,
    LINK_COLOR: theme.email.buttonColor,
    PRIMARY_COLOR: theme.email.headerColor,
  };

  // Collect member emails for BCC
  const memberInvitees = createdInvitees.filter((inv) => inv.inviteeType === 'member');
  const visitorInviteesNew = createdInvitees.filter((inv) => inv.inviteeType === 'visitor');

  if (memberInvitees.length > 0) {
    const allUsers = await getAllUsers();
    const memberEmails: string[] = [];

    for (const inv of memberInvitees) {
      for (const user of allUsers) {
        if (user.userName === inv.userName && user.emailAddress) {
          memberEmails.push(user.emailAddress);
          break;
        }
      }
    }

    if (memberEmails.length > 0) {
      const transporter = getEmailTransporter();
      const html = template({ ...baseVars, inviteeName: 'Member', responseUrl: memberResponseUrl });

      await transporter.sendMail({
        from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
        bcc: memberEmails.join(', '),
        subject: `You're invited — ${eventTitle}`,
        html,
      });
    }
  }

  // Send individual emails to visitor invitees
  if (visitorInviteesNew.length > 0) {
    const pooledTransporter = getEmailTransporter(true);

    for (const inv of visitorInviteesNew) {
      const visitorResponseUrl = `${appUrl}/availability/guest/${eventId}?token=${inv.token}`;
      const html = template({ ...baseVars, inviteeName: inv.visitorName, responseUrl: visitorResponseUrl });

      await pooledTransporter.sendMail({
        from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
        to: inv.visitorEmail,
        subject: `You're invited — ${eventTitle}`,
        html,
      });
    }

    pooledTransporter.close();
  }

  // Mark all newly created invitees as notified
  const inviteeIds = createdInvitees.map((inv) => inv.inviteeId);
  await markInviteesNotified(inviteeIds);
}
