// src/lib/email/availability.ts
// Email send logic for all Availability Planner v2 email types:
//   1. Group added notification (members only — visitors get no email at group creation)
//   2. Event invite (members get BCC batch, visitors get individual emails with tokens)
//   3. Conclusion notification (members BCC batch, visitors individual)
//   4. Response notification to creator (single transactional send)

import {
  getEmailTransporter,
  isEmailConfigured,
  sendTemplateEmail,
} from './mailer';
import { getUserByUsername, getAllUsers } from '../sheets';
import {
  getGroupById,
  getGroupMembers,
} from '../availability-groups-sheets';
import {
  getEventById,
  getSlotsForEvent,
  getInviteesForEvent,
  getResponsesForEvent,
  markInviteesNotified,
} from '../availability-events-sheets';
import type {
  AvailabilityInvitee,
  AvailabilityGroupMember,
} from '@/types/availability';

// Returns the public app URL — used when building email links
function getAppUrl(): string {
  // NEXT_PUBLIC_APP_URL is set in .env.local for all environments
  const url = process.env.NEXT_PUBLIC_APP_URL;
  if (!url) {
    // Fall back to NEXTAUTH_URL if public URL not set
    const nextauthUrl = process.env.NEXTAUTH_URL;
    if (!nextauthUrl) {
      return 'https://members.burgesshill-bowls.co.uk';
    }
    return nextauthUrl;
  }
  return url;
}

// ─── 1. Group Added Notification ──────────────────────────────────────────────

// Send group-added notification to portal members who were added to a group.
// Visitors do NOT receive an email at group-add time — they get invite emails
// when events are created.
// Sends a single BCC email to all new member email addresses.
export async function sendGroupAddedEmail(
  groupId: string,
  newMemberUserNames: string[],
  addedByUsername: string
): Promise<void> {
  // No-op if email is not configured
  if (!isEmailConfigured()) {
    return;
  }

  // No-op if no member usernames provided
  if (!newMemberUserNames || newMemberUserNames.length === 0) {
    return;
  }

  // Fetch the group record to get its name
  const group = await getGroupById(groupId);
  if (!group) {
    console.error(`[sendGroupAddedEmail] Group ${groupId} not found`);
    return;
  }

  // Fetch the "added by" user's display name
  const addedByUser = await getUserByUsername(addedByUsername);
  let addedByName = addedByUsername;
  if (addedByUser) {
    addedByName = addedByUser.fullKnownAs || addedByUser.fullName || addedByUsername;
  }

  // Build the URL to the group page for portal members
  const appUrl = getAppUrl();
  const groupUrl = `${appUrl}/availability/groups/${groupId}`;

  // Collect email addresses for new portal members
  const recipientEmails: string[] = [];
  const allUsers = await getAllUsers();

  // Loop through the new member usernames and find their email addresses
  for (let i = 0; i < newMemberUserNames.length; i++) {
    const uName = newMemberUserNames[i];
    // Find the matching user record
    let foundEmail = '';
    for (let j = 0; j < allUsers.length; j++) {
      if (allUsers[j].userName === uName) {
        // emailAddress is string | null — only use if non-null and non-empty
        if (allUsers[j].emailAddress !== null && allUsers[j].emailAddress !== undefined) {
          foundEmail = allUsers[j].emailAddress as string;
        }
        break;
      }
    }
    if (foundEmail) {
      recipientEmails.push(foundEmail);
    }
  }

  // No emails to send if none of the members have email addresses
  if (recipientEmails.length === 0) {
    return;
  }

  // Send a single BCC email to all new members (they don't know each other's emails)
  const toList = recipientEmails.join(', ');

  const emailResult = await sendTemplateEmail(
    toList,
    `You've been added to a group — ${group.name}`,
    'availability-group-added',
    {
      recipientName: 'there',   // Generic greeting when BCC-ing multiple recipients
      groupName: group.name,
      addedByName: addedByName,
      groupUrl: groupUrl,
      isVisitor: undefined,     // Not a visitor — members get the CTA button
    }
  );

  if (!emailResult.success) {
    console.error('[sendGroupAddedEmail] Email send failed:', emailResult.error);
  }
}

// ─── 2. Event Invite Emails ────────────────────────────────────────────────────

// Send event invite emails to a list of newly created invitees.
// Members: one BCC email with a generic login URL.
// Visitors: sequential individual emails via pooled transporter, each with unique token URL.
// Calls markInviteesNotified() after sending.
export async function sendEventInviteEmails(
  eventId: string,
  groupId: string,
  invitees: AvailabilityInvitee[],
  senderUsername: string
): Promise<void> {
  // No-op if email is not configured
  if (!isEmailConfigured()) {
    return;
  }

  // Fetch the event to get title and expiry
  const event = await getEventById(eventId);
  if (!event) {
    console.error(`[sendEventInviteEmails] Event ${eventId} not found`);
    return;
  }

  // Fetch the sender's display name
  const senderUser = await getUserByUsername(senderUsername);
  let creatorName = senderUsername;
  if (senderUser) {
    creatorName = senderUser.fullKnownAs || senderUser.fullName || senderUsername;
  }

  // Fetch group name if this is a group event
  let groupName = '';
  if (groupId) {
    const group = await getGroupById(groupId);
    if (group) {
      groupName = group.name;
    }
  }

  // Format the expiry date for the email body (e.g. "19 May 2026")
  const expiresDate = new Date(event.expiresAt);
  const expiresAtFormatted = expiresDate.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const appUrl = getAppUrl();

  // Separate member invitees from visitor invitees
  const memberInvitees: AvailabilityInvitee[] = [];
  const visitorInvitees: AvailabilityInvitee[] = [];

  for (let i = 0; i < invitees.length; i++) {
    if (invitees[i].inviteeType === 'member') {
      memberInvitees.push(invitees[i]);
    } else {
      visitorInvitees.push(invitees[i]);
    }
  }

  // Track all successfully notified invitee IDs for markInviteesNotified()
  const notifiedIds: string[] = [];

  // ── Member invitees: single BCC email ──
  if (memberInvitees.length > 0) {
    // Collect email addresses for member invitees
    const allUsers = await getAllUsers();
    const memberEmails: string[] = [];

    for (let i = 0; i < memberInvitees.length; i++) {
      const inv = memberInvitees[i];
      let foundEmail = '';
      // Find email address for this member
      for (let j = 0; j < allUsers.length; j++) {
        if (allUsers[j].userName === inv.userName) {
          // emailAddress is string | null — only use if non-null
          if (allUsers[j].emailAddress !== null && allUsers[j].emailAddress !== undefined) {
            foundEmail = allUsers[j].emailAddress as string;
          }
          break;
        }
      }
      if (foundEmail) {
        memberEmails.push(foundEmail);
        notifiedIds.push(inv.inviteeId);
      }
    }

    if (memberEmails.length > 0) {
      // The response URL for members is the event page (requires login)
      const responseUrl = `${appUrl}/availability/events/${eventId}`;
      const toList = memberEmails.join(', ');

      const emailResult = await sendTemplateEmail(
        toList,
        `New availability poll — ${event.title}`,
        'availability-event-invite',
        {
          inviteeName: 'there',   // Generic greeting for BCC batch
          eventTitle: event.title,
          eventType: event.type,
          groupName: groupName,
          creatorName: creatorName,
          expiresAtFormatted: expiresAtFormatted,
          responseUrl: responseUrl,
        }
      );

      if (!emailResult.success) {
        console.error('[sendEventInviteEmails] Member batch email failed:', emailResult.error);
      }
    }
  }

  // ── Visitor invitees: sequential individual emails via pooled transporter ──
  if (visitorInvitees.length > 0) {
    // Get a pooled transporter for sequential visitor emails (reuses single SMTP connection)
    const pooledTransporter = getEmailTransporter(true);

    // Load the template manually to personalise each visitor's email
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const Handlebars = (await import('handlebars')).default;
    const { theme } = await import('@/config/theme');

    // Read the template file once and compile it
    const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-event-invite.html');
    const templateSource = readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    // Send one email per visitor
    for (let i = 0; i < visitorInvitees.length; i++) {
      const inv = visitorInvitees[i];

      // Skip if this visitor has no email address
      if (!inv.visitorEmail) {
        continue;
      }

      // Build the unique guest response URL with the visitor's token
      const responseUrl = `${appUrl}/availability/guest/${eventId}?token=${inv.token}`;

      // Render the template with this visitor's personalised variables
      const variables = {
        inviteeName: inv.visitorName,
        eventTitle: event.title,
        eventType: event.type,
        groupName: groupName,
        creatorName: creatorName,
        expiresAtFormatted: expiresAtFormatted,
        responseUrl: responseUrl,
        BRAND_NAME: theme.brand.name,
        BRAND_SHORT_NAME: theme.brand.shortName,
        HEADER_COLOR: theme.email.headerColor,
        BUTTON_COLOR: theme.email.buttonColor,
        LINK_COLOR: theme.email.buttonColor,
        PRIMARY_COLOR: theme.email.headerColor,
      };

      const htmlContent = template(variables);

      try {
        await pooledTransporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: inv.visitorEmail,
          subject: `New availability poll — ${event.title}`,
          html: htmlContent,
        });
        notifiedIds.push(inv.inviteeId);
      } catch (err) {
        // Log individual failure but continue sending to other visitors
        console.error(`[sendEventInviteEmails] Failed to send to visitor ${inv.visitorName}:`, err);
      }
    }

    // Always close the pooled connection when done
    pooledTransporter.close();
  }

  // Mark all successfully notified invitees as notified in the sheet
  if (notifiedIds.length > 0) {
    try {
      await markInviteesNotified(notifiedIds);
    } catch (markError) {
      // Log but don't throw — the emails were sent, this is just housekeeping
      console.error('[sendEventInviteEmails] Failed to mark invitees as notified:', markError);
    }
  }
}

// ─── 3. Conclusion Notification ───────────────────────────────────────────────

// Send conclusion notification emails to all respondents of an event.
// Members who responded: single BCC email.
// Visitors who responded: sequential individual emails via pooled transporter.
export async function sendConclusionEmails(eventId: string): Promise<void> {
  // No-op if email is not configured
  if (!isEmailConfigured()) {
    return;
  }

  // Fetch the event record
  const event = await getEventById(eventId);
  if (!event) {
    console.error(`[sendConclusionEmails] Event ${eventId} not found`);
    return;
  }

  // Fetch the creator's display name
  const creatorUser = await getUserByUsername(event.createdByUsername);
  let creatorName = event.createdByUsername;
  if (creatorUser) {
    creatorName = creatorUser.fullKnownAs || creatorUser.fullName || event.createdByUsername;
  }

  // Get the chosen slot label for the email
  let chosenSlotLabel = event.concludedSlotId;
  const slots = await getSlotsForEvent(eventId);
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].slotId === event.concludedSlotId) {
      // Use the slot label if set, otherwise format the datetime
      if (slots[i].slotLabel) {
        chosenSlotLabel = slots[i].slotLabel;
      } else {
        const slotDate = new Date(slots[i].slotDatetime);
        chosenSlotLabel = slotDate.toLocaleDateString('en-GB', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        });
      }
      break;
    }
  }

  // Fetch all responses for this event to find who responded
  const allResponses = await getResponsesForEvent(eventId);

  // Deduplicate respondents — each person only gets one email
  const memberRespondents: Record<string, boolean> = {};
  const visitorRespondents: Array<{ name: string; email: string }> = [];
  const seenVisitorEmails: Record<string, boolean> = {};

  for (let i = 0; i < allResponses.length; i++) {
    const r = allResponses[i];
    if (r.respondentType === 'member' && r.userName) {
      memberRespondents[r.userName] = true;
    } else if (r.respondentType === 'visitor' && r.visitorEmail) {
      if (!seenVisitorEmails[r.visitorEmail]) {
        seenVisitorEmails[r.visitorEmail] = true;
        visitorRespondents.push({ name: r.visitorName, email: r.visitorEmail });
      }
    }
  }

  // ── Member respondents: single BCC email ──
  const memberUsernames = Object.keys(memberRespondents);
  if (memberUsernames.length > 0) {
    const allUsers = await getAllUsers();
    const memberEmails: string[] = [];

    for (let i = 0; i < memberUsernames.length; i++) {
      const uName = memberUsernames[i];
      for (let j = 0; j < allUsers.length; j++) {
        if (allUsers[j].userName === uName) {
          // emailAddress is string | null — only push if non-null
          if (allUsers[j].emailAddress !== null && allUsers[j].emailAddress !== undefined) {
            memberEmails.push(allUsers[j].emailAddress as string);
          }
          break;
        }
      }
    }

    if (memberEmails.length > 0) {
      const toList = memberEmails.join(', ');
      const emailResult = await sendTemplateEmail(
        toList,
        `Event update — ${event.title}`,
        'availability-conclusion',
        {
          respondentName: 'there',   // Generic greeting for BCC batch
          eventTitle: event.title,
          chosenSlotLabel: chosenSlotLabel,
          conclusionNote: event.conclusionNote || '',
          creatorName: creatorName,
        }
      );

      if (!emailResult.success) {
        console.error('[sendConclusionEmails] Member batch email failed:', emailResult.error);
      }
    }
  }

  // ── Visitor respondents: sequential individual emails ──
  if (visitorRespondents.length > 0) {
    const pooledTransporter = getEmailTransporter(true);

    // Load and compile the template once
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const Handlebars = (await import('handlebars')).default;
    const { theme } = await import('@/config/theme');

    const templatePath = join(process.cwd(), 'src', 'lib', 'email', 'templates', 'availability-conclusion.html');
    const templateSource = readFileSync(templatePath, 'utf-8');
    const template = Handlebars.compile(templateSource);

    for (let i = 0; i < visitorRespondents.length; i++) {
      const v = visitorRespondents[i];

      const variables = {
        respondentName: v.name,
        eventTitle: event.title,
        chosenSlotLabel: chosenSlotLabel,
        conclusionNote: event.conclusionNote || '',
        creatorName: creatorName,
        BRAND_NAME: theme.brand.name,
        BRAND_SHORT_NAME: theme.brand.shortName,
        HEADER_COLOR: theme.email.headerColor,
        BUTTON_COLOR: theme.email.buttonColor,
        LINK_COLOR: theme.email.buttonColor,
        PRIMARY_COLOR: theme.email.headerColor,
      };

      const htmlContent = template(variables);

      try {
        await pooledTransporter.sendMail({
          from: `"Burgess Hill Bowls Club" <${process.env.SMTP_USER}>`,
          to: v.email,
          subject: `Event update — ${event.title}`,
          html: htmlContent,
        });
      } catch (err) {
        // Log but continue sending to others
        console.error(`[sendConclusionEmails] Failed to send to visitor ${v.name}:`, err);
      }
    }

    pooledTransporter.close();
  }
}

// ─── 4. Response Notification (Member) ────────────────────────────────────────

// Send a transactional notification to the event creator when a member responds.
// Resolves the member's display name from the Members sheet.
export async function sendResponseNotificationEmail(
  eventId: string,
  respondentUserName: string
): Promise<void> {
  // No-op if email is not configured
  if (!isEmailConfigured()) {
    return;
  }

  // Fetch the event record
  const event = await getEventById(eventId);
  if (!event) {
    console.error(`[sendResponseNotificationEmail] Event ${eventId} not found`);
    return;
  }

  // Fetch the creator's user record to get their email and display name
  const creatorUser = await getUserByUsername(event.createdByUsername);
  if (!creatorUser || !creatorUser.emailAddress) {
    // Cannot send if creator has no email address
    return;
  }

  let creatorName = creatorUser.fullKnownAs || creatorUser.fullName || event.createdByUsername;

  // Fetch the respondent's display name
  const respondentUser = await getUserByUsername(respondentUserName);
  let respondentName = respondentUserName;
  if (respondentUser) {
    respondentName = respondentUser.fullKnownAs || respondentUser.fullName || respondentUserName;
  }

  const appUrl = getAppUrl();
  const manageUrl = `${appUrl}/availability/events/${eventId}/manage`;

  const emailResult = await sendTemplateEmail(
    creatorUser.emailAddress,
    `New response — ${event.title}`,
    'availability-response-notification',
    {
      creatorName: creatorName,
      eventTitle: event.title,
      respondentName: respondentName,
      manageUrl: manageUrl,
    }
  );

  if (!emailResult.success) {
    console.error('[sendResponseNotificationEmail] Email send failed:', emailResult.error);
  }
}

// ─── 5. Response Notification (Visitor) ───────────────────────────────────────

// Send a transactional notification to the event creator when a visitor responds.
// Uses visitorName directly (no Members sheet lookup needed).
export async function sendResponseNotificationEmailForVisitor(
  eventId: string,
  visitorName: string
): Promise<void> {
  // No-op if email is not configured
  if (!isEmailConfigured()) {
    return;
  }

  // Fetch the event record
  const event = await getEventById(eventId);
  if (!event) {
    console.error(`[sendResponseNotificationEmailForVisitor] Event ${eventId} not found`);
    return;
  }

  // Fetch the creator's user record to get their email and display name
  const creatorUser = await getUserByUsername(event.createdByUsername);
  if (!creatorUser || !creatorUser.emailAddress) {
    // Cannot send if creator has no email address
    return;
  }

  const creatorName = creatorUser.fullKnownAs || creatorUser.fullName || event.createdByUsername;

  const appUrl = getAppUrl();
  const manageUrl = `${appUrl}/availability/events/${eventId}/manage`;

  const emailResult = await sendTemplateEmail(
    creatorUser.emailAddress,
    `New response — ${event.title}`,
    'availability-response-notification',
    {
      creatorName: creatorName,
      eventTitle: event.title,
      respondentName: visitorName,
      manageUrl: manageUrl,
    }
  );

  if (!emailResult.success) {
    console.error('[sendResponseNotificationEmailForVisitor] Email send failed:', emailResult.error);
  }
}
