// app/help/availability/page.tsx
// Help page for the Availability Planner feature

'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpAvailabilityPage() {
  const { data: session } = useSession();
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user && session.user.name ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Availability Planner</h1>
          <p className="text-gray-500 text-sm mt-1">Coordinate dates and times with members and visitors</p>
        </div>

        <div className="space-y-4">

          <HelpSection title="What is the Availability Planner?">
            <Body>
              The Availability Planner is a Doodle-style scheduling tool. Any member can create an
              event with several candidate date and time slots. Other members — and external
              visitors — mark each slot as Yes, Maybe, or No. The event creator then reviews the
              responses and optionally picks a winning slot to conclude the event.
            </Body>
          </HelpSection>

          <HelpSection title="Creating an event">
            <Step n={1}>Go to Availability in the navigation bar.</Step>
            <Step n={2}>Tap Create Event.</Step>
            <Step n={3}>Fill in the title, an optional description, and the date the event closes (no responses accepted after this date).</Step>
            <Step n={4}>
              Choose visibility. Public events appear in every member's list. Private events are
              visible only to people you explicitly invite.
            </Step>
            <Step n={5}>
              Choose whether respondents can see each other's answers (Show responses to all
              respondents). If set to No, each person only sees their own row.
            </Step>
            <Step n={6}>
              Optionally turn on Notify me when someone responds — useful for one-on-one polls
              where you want to know immediately when the other person replies.
            </Step>
            <Step n={7}>Add at least one candidate date/time slot using the Add Slot button.</Step>
            <Step n={8}>For private events, add your invitees (see below).</Step>
            <Step n={9}>Tap Create Event. You will be taken to the management page.</Step>
          </HelpSection>

          <HelpSection title="Adding invitees to a private event">
            <Body>
              When Visibility is set to Private, an Invitees section appears at the bottom of the
              form. You can add two types of invitee:
            </Body>
            <Step n={1}>
              Members — search by name using the searchable list. Selected members receive a
              single BCC email with a link to the event. They must be logged in to respond.
            </Step>
            <Step n={2}>
              Visitors — enter a name and email address and tap Add Visitor. Each visitor receives
              their own individual email containing a unique link. They do not need an account to
              respond.
            </Step>
            <Body>
              You can also add more invitees later from the Manage page while the event is open.
            </Body>
          </HelpSection>

          <HelpSection title="Responding to an event">
            <Body>
              Open an event from the Availability list. For each candidate slot, click one of the
              three response buttons in your row:
            </Body>
            <Step n={1}>✓ Yes — you are available.</Step>
            <Step n={2}>? Maybe — you might be available.</Step>
            <Step n={3}>✗ No — you are not available.</Step>
            <Body>
              Tap Save My Responses when you are done. You can update your responses at any time
              while the event is open and has not expired.
            </Body>
          </HelpSection>

          <HelpSection title="What visitors see">
            <Body>
              Visitors receive an email with a unique link. Opening that link takes them to a
              response page that shows the event details, the slot grid, and their own row to
              fill in — no login required. They can return to the same link at any time to update
              their responses before the event closes.
            </Body>
          </HelpSection>

          <HelpSection title="Managing an event">
            <Body>
              Only the event creator (and admins) can access the Manage page. From there you can:
            </Body>
            <Step n={1}>Edit the title, description, expiry date, and notification settings.</Step>
            <Step n={2}>
              See the full response grid — all respondents, all slots — regardless of whether
              Show responses is turned on for regular respondents.
            </Step>
            <Step n={3}>Add new slots (open events only).</Step>
            <Step n={4}>Remove slots — this also deletes all existing responses for that slot.</Step>
            <Step n={5}>Close the event to stop accepting new responses.</Step>
            <Step n={6}>Reopen a closed or concluded event.</Step>
            <Step n={7}>Conclude the event (see below).</Step>
            <Step n={8}>Archive the event to hide it from all views.</Step>
          </HelpSection>

          <HelpSection title="Show responses to all respondents">
            <Body>
              When this is set to Yes, every respondent can see the full grid — all names and
              their responses — on the response page. When set to No, each person only sees their
              own row (the creator always sees everyone on the Manage page).
            </Body>
          </HelpSection>

          <HelpSection title="Notify me when someone responds">
            <Body>
              When this is turned on, the event creator receives a short email each time any
              respondent (member or visitor) saves their responses. This is most useful for
              one-on-one availability checks where you want an immediate notification.
              It is turned off by default to avoid inbox clutter for larger polls.
            </Body>
          </HelpSection>

          <HelpSection title="Concluding an event">
            <Step n={1}>Open the Manage page for the event.</Step>
            <Step n={2}>Tap Conclude Event.</Step>
            <Step n={3}>Choose the winning slot from the dropdown.</Step>
            <Step n={4}>Optionally write a conclusion note (e.g. "See you there!").</Step>
            <Step n={5}>
              Check Send notification email to all respondents if you want everyone who responded
              to receive an email with the chosen date.
            </Step>
            <Step n={6}>Tap Confirm Conclusion.</Step>
            <Body>
              Once concluded, the winning slot is highlighted in the response grid and shown on
              the event list. You can reopen a concluded event if you need to change the outcome.
            </Body>
          </HelpSection>

          <HelpSection title="Archiving an event">
            <Body>
              Archiving removes the event from all member lists. Only the creator and admins can
              archive. An archived event cannot be restored through the UI.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
