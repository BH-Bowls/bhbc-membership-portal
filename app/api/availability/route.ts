// app/api/availability/route.ts
// API endpoints for the Availability Planner event list and event creation

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEvents,
  createAvailabilityEvent,
  addAvailabilitySlot,
  addInvitees,
  getAvailabilityEventById,
  markInviteesNotified,
} from '@/lib/availability-sheets';
import { getUserByUsername, getAllUsers } from '@/lib/sheets';
import { getEmailTransporter, sendTemplateEmail, isEmailConfigured } from '@/lib/email/mailer';
import type { CreateEventPayload } from '@/types/availability';

// GET /api/availability
// Returns all events visible to the current user
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch events filtered by access rules
    const events = await getAvailabilityEvents(session.user.userName);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('[GET /api/availability] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 });
  }
}

// POST /api/availability
// Create a new availability event with slots and optional invitees
export async function POST(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse request body
    const body: CreateEventPayload = await request.json();

    // Validate required fields
    if (!body.title || !body.title.trim()) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (!body.expiresAt) {
      return NextResponse.json({ error: 'Expiry date is required' }, { status: 400 });
    }

    // Expiry must be in the future
    const expiryDate = new Date(body.expiresAt);
    if (isNaN(expiryDate.getTime())) {
      return NextResponse.json({ error: 'Expiry date is not a valid ISO date' }, { status: 400 });
    }
    if (expiryDate <= new Date()) {
      return NextResponse.json({ error: 'Expiry date must be in the future' }, { status: 400 });
    }

    // At least one slot required
    if (!body.slots || body.slots.length === 0) {
      return NextResponse.json({ error: 'At least one slot is required' }, { status: 400 });
    }

    // Validate each slot has a valid slotDatetime
    for (let i = 0; i < body.slots.length; i++) {
      const slot = body.slots[i];
      if (!slot.slotDatetime) {
        return NextResponse.json({ error: `Slot ${i + 1} is missing a date/time` }, { status: 400 });
      }
      const slotDate = new Date(slot.slotDatetime);
      if (isNaN(slotDate.getTime())) {
        return NextResponse.json({ error: `Slot ${i + 1} has an invalid date/time` }, { status: 400 });
      }
    }

    // Private events must have at least one invitee
    if (body.visibility === 'private') {
      const hasMemberInvitees = body.memberInvitees && body.memberInvitees.length > 0;
      const hasVisitorInvitees = body.visitorInvitees && body.visitorInvitees.length > 0;
      if (!hasMemberInvitees && !hasVisitorInvitees) {
        return NextResponse.json(
          { error: 'Private events must have at least one invitee' },
          { status: 400 }
        );
      }
    }

    // Validate visitor invitees have required fields
    if (body.visitorInvitees && body.visitorInvitees.length > 0) {
      for (let i = 0; i < body.visitorInvitees.length; i++) {
        const vi = body.visitorInvitees[i];
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
    }

    // Step 1: Create the event
    const eventId = await createAvailabilityEvent({
      title: body.title.trim(),
      description: body.description || '',
      createdByUsername: session.user.userName,
      visibility: body.visibility,
      showResponsesToRespondents: body.showResponsesToRespondents,
      notifyCreatorOnResponse: body.notifyCreatorOnResponse,
      expiresAt: body.expiresAt,
    });

    // Step 2: Add slots in order
    for (let i = 0; i < body.slots.length; i++) {
      const slot = body.slots[i];
      await addAvailabilitySlot(eventId, slot.slotDatetime, slot.slotLabel || '', i + 1);
    }

    // Step 3: Add invitees if private, then send invite emails
    if (body.visibility === 'private') {
      const memberUserNames = body.memberInvitees || [];
      const visitorInvitees = body.visitorInvitees || [];

      // Create invitee rows and get back the created records
      const createdInvitees = await addInvitees(
        eventId,
        body.expiresAt,
        memberUserNames,
        visitorInvitees
      );

      // Send invite emails if email is configured
      if (isEmailConfigured()) {
        await sendInviteEmails(eventId, createdInvitees, session.user.userName);
      }
    }

    return NextResponse.json({ success: true, eventId });
  } catch (error) {
    console.error('[POST /api/availability] Error:', error);
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}

// Send invite emails to newly created invitees
// Members get one BCC email; visitors each get an individual email with their token
async function sendInviteEmails(
  eventId: string,
  createdInvitees: any[],
  creatorUsername: string
): Promise<void> {
  try {
    // Fetch event and creator details
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      console.error('[sendInviteEmails] Event not found:', eventId);
      return;
    }

    const creator = await getUserByUsername(creatorUsername);
    const creatorName = creator ? (creator.fullName || creatorUsername) : creatorUsername;

    // Format expiry date for display
    const expiryDate = new Date(event.expiresAt);
    const expiresAtFormatted = expiryDate.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    const appUrl = process.env.NEXTAUTH_URL || '';
    const memberResponseUrl = `${appUrl}/availability/${eventId}`;

    // Collect member emails for BCC
    const memberInvitees = createdInvitees.filter((inv) => inv.inviteeType === 'member');
    const visitorInvitees = createdInvitees.filter((inv) => inv.inviteeType === 'visitor');

    // Send one BCC email to all member invitees
    if (memberInvitees.length > 0) {
      const allUsers = await getAllUsers();
      const emailAddresses: string[] = [];

      for (const inv of memberInvitees) {
        // Find member email from users list
        for (const user of allUsers) {
          if (user.userName === inv.userName && user.emailAddress) {
            emailAddresses.push(user.emailAddress);
            break;
          }
        }
      }

      if (emailAddresses.length > 0) {
        const bccString = emailAddresses.join(', ');
        const transporter = getEmailTransporter();
        const htmlResult = buildInviteHtml({
          inviteeName: 'Member',
          eventTitle: event.title,
          eventDescription: event.description,
          creatorName,
          expiresAtFormatted,
          responseUrl: memberResponseUrl,
        });

        await transporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          bcc: bccString,
          subject: `You're invited — ${event.title}`,
          html: htmlResult,
        });
      }
    }

    // Send individual emails to each visitor invitee via pooled transporter
    if (visitorInvitees.length > 0) {
      const pooledTransporter = getEmailTransporter(true);

      for (const inv of visitorInvitees) {
        const visitorResponseUrl = `${appUrl}/availability/guest/${eventId}?token=${inv.token}`;
        const htmlResult = buildInviteHtml({
          inviteeName: inv.visitorName,
          eventTitle: event.title,
          eventDescription: event.description,
          creatorName,
          expiresAtFormatted,
          responseUrl: visitorResponseUrl,
        });

        await pooledTransporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: inv.visitorEmail,
          subject: `You're invited — ${event.title}`,
          html: htmlResult,
        });
      }

      pooledTransporter.close();
    }

    // Mark all invitees as notified
    const allInviteeIds = createdInvitees.map((inv) => inv.inviteeId);
    await markInviteesNotified(allInviteeIds);
  } catch (error) {
    console.error('[sendInviteEmails] Error:', error);
    // Email failure does not block the response
  }
}

// Build invite email HTML using the template variables
function buildInviteHtml(vars: {
  inviteeName: string;
  eventTitle: string;
  eventDescription: string;
  creatorName: string;
  expiresAtFormatted: string;
  responseUrl: string;
}): string {
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const Handlebars = require('handlebars');
  const { theme } = require('@/config/theme');

  const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-invite.html');
  const templateSource = readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);

  return template({
    inviteeName: vars.inviteeName,
    eventTitle: vars.eventTitle,
    eventDescription: vars.eventDescription || '',
    creatorName: vars.creatorName,
    expiresAtFormatted: vars.expiresAtFormatted,
    responseUrl: vars.responseUrl,
    BRAND_NAME: theme.brand.name,
    BRAND_SHORT_NAME: theme.brand.shortName,
    HEADER_COLOR: theme.email.headerColor,
    BUTTON_COLOR: theme.email.buttonColor,
    LINK_COLOR: theme.email.buttonColor,
    PRIMARY_COLOR: theme.email.headerColor,
  });
}

// Export sendInviteEmails so it can be used by the invitees route
export { sendInviteEmails };
