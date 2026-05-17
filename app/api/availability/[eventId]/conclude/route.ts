// app/api/availability/[eventId]/conclude/route.ts
// API endpoint for concluding an availability event and optionally notifying respondents

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import {
  getAvailabilityEventById,
  getSlotsForEvent,
  concludeAvailabilityEvent,
  getResponsesForEvent,
} from '@/lib/availability-sheets';
import { getUserByUsername, getAllUsers } from '@/lib/sheets';
import { getEmailTransporter, isEmailConfigured } from '@/lib/email/mailer';
import { hasRole } from '@/lib/role-utils';
import type { ConcludeEventPayload } from '@/types/availability';

// POST /api/availability/[eventId]/conclude
// Mark the event as concluded with a winning slot, optionally send conclusion emails
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

    // Fetch event for access check
    const event = await getAvailabilityEventById(eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Only creator or Admin can conclude
    const isCreator = event.createdByUsername === session.user.userName;
    const isAdmin = hasRole(session.user.role, 'Admin');
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Event must be open or closed to conclude it
    if (event.status !== 'open' && event.status !== 'closed') {
      return NextResponse.json(
        { error: 'Only open or closed events can be concluded' },
        { status: 400 }
      );
    }

    // Parse body
    const body: ConcludeEventPayload = await request.json();

    if (!body.concludedSlotId) {
      return NextResponse.json({ error: 'concludedSlotId is required' }, { status: 400 });
    }

    // Verify the concluded slot belongs to this event
    const slots = await getSlotsForEvent(eventId);
    let chosenSlot = null;
    for (const slot of slots) {
      if (slot.slotId === body.concludedSlotId) {
        chosenSlot = slot;
        break;
      }
    }

    if (!chosenSlot) {
      return NextResponse.json(
        { error: 'The chosen slot does not belong to this event' },
        { status: 400 }
      );
    }

    // Step 1: Conclude the event
    await concludeAvailabilityEvent(
      eventId,
      body.concludedSlotId,
      body.conclusionNote || '',
      session.user.userName
    );

    // Step 2: Optionally send conclusion emails to all respondents
    if (body.notifyRespondents && isEmailConfigured()) {
      try {
        await sendConclusionEmails(eventId, event.title, chosenSlot, body.conclusionNote || '', event.createdByUsername);
      } catch (emailError) {
        // Email failure does not block the conclusion
        console.error('[conclude] Error sending conclusion emails:', emailError);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[POST /api/availability/[eventId]/conclude] Error:', error);
    return NextResponse.json({ error: 'Failed to conclude event' }, { status: 500 });
  }
}

// Send conclusion emails to all unique respondents
async function sendConclusionEmails(
  eventId: string,
  eventTitle: string,
  chosenSlot: any,
  conclusionNote: string,
  creatorUsername: string
): Promise<void> {
  // Fetch all responses to get unique respondents
  const responses = await getResponsesForEvent(eventId);

  // Build the chosen slot label for display
  const chosenSlotLabel = chosenSlot.slotLabel
    ? chosenSlot.slotLabel
    : new Date(chosenSlot.slotDatetime).toLocaleDateString('en-GB', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      });

  // Fetch creator name
  const creator = await getUserByUsername(creatorUsername);
  const creatorName = creator ? (creator.fullName || creatorUsername) : creatorUsername;

  // Deduplicate respondents — one email per person regardless of how many slots they responded to
  const seenMembers = new Set<string>();
  const seenVisitorEmails = new Set<string>();
  const memberUserNames: string[] = [];
  const visitorRespondents: Array<{ name: string; email: string }> = [];

  for (const rec of responses) {
    if (rec.respondentType === 'member' && rec.userName) {
      if (!seenMembers.has(rec.userName)) {
        seenMembers.add(rec.userName);
        memberUserNames.push(rec.userName);
      }
    } else if (rec.respondentType === 'visitor' && rec.visitorEmail) {
      if (!seenVisitorEmails.has(rec.visitorEmail)) {
        seenVisitorEmails.add(rec.visitorEmail);
        visitorRespondents.push({ name: rec.visitorName, email: rec.visitorEmail });
      }
    }
  }

  // Load the HTML template
  const { readFileSync } = require('fs');
  const { join } = require('path');
  const Handlebars = require('handlebars');
  const { theme } = require('@/config/theme');

  const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-conclusion.html');
  const templateSource = readFileSync(templatePath, 'utf-8');
  const template = Handlebars.compile(templateSource);

  // Send one BCC email to all member respondents
  if (memberUserNames.length > 0) {
    const allUsers = await getAllUsers();
    const memberEmails: string[] = [];

    for (const userName of memberUserNames) {
      for (const user of allUsers) {
        if (user.userName === userName && user.emailAddress) {
          memberEmails.push(user.emailAddress);
          break;
        }
      }
    }

    if (memberEmails.length > 0) {
      const transporter = getEmailTransporter();
      const html = template({
        respondentName: 'Member',
        eventTitle,
        chosenSlotLabel,
        conclusionNote,
        creatorName,
        BRAND_NAME: theme.brand.name,
        BRAND_SHORT_NAME: theme.brand.shortName,
        HEADER_COLOR: theme.email.headerColor,
        BUTTON_COLOR: theme.email.buttonColor,
        LINK_COLOR: theme.email.buttonColor,
        PRIMARY_COLOR: theme.email.headerColor,
      });

      await transporter.sendMail({
        from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
        bcc: memberEmails.join(', '),
        subject: `Event update — ${eventTitle}`,
        html,
      });
    }
  }

  // Send individual conclusion emails to visitor respondents
  if (visitorRespondents.length > 0) {
    const pooledTransporter = getEmailTransporter(true);

    for (const visitor of visitorRespondents) {
      const html = template({
        respondentName: visitor.name,
        eventTitle,
        chosenSlotLabel,
        conclusionNote,
        creatorName,
        BRAND_NAME: theme.brand.name,
        BRAND_SHORT_NAME: theme.brand.shortName,
        HEADER_COLOR: theme.email.headerColor,
        BUTTON_COLOR: theme.email.buttonColor,
        LINK_COLOR: theme.email.buttonColor,
        PRIMARY_COLOR: theme.email.headerColor,
      });

      await pooledTransporter.sendMail({
        from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
        to: visitor.email,
        subject: `Event update — ${eventTitle}`,
        html,
      });
    }

    pooledTransporter.close();
  }
}
