// app/help/availability/page.tsx
// Help page for the Availability Planner v2 feature — covers groups, events, responding, and managing

'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpAvailabilityPage() {
  // Get session to populate the navbar
  const { data: session } = useSession();
  const role = session && session.user ? session.user.role : '';

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session && session.user && session.user.name ? session.user.name : undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Availability Planner</h1>
          <p className="text-gray-700 text-sm mt-1">Coordinate dates and times with groups of members and visitors</p>
        </div>

        <div className="space-y-4">

          <HelpSection title="What is the Availability Planner?">
            <Body>
              The Availability Planner is a WhatsApp-poll-style scheduling tool. Create a poll
              (called an event) with several candidate dates, share it with a group of people, and
              everyone marks each date as Yes, Maybe, or No. The creator then picks the winning
              date to conclude the event.
            </Body>
            <Body>
              There are two ways to use it: Group Events (the usual way) and Public Events
              (for club-wide polls). Both types are described below.
            </Body>
          </HelpSection>

          <HelpSection title="Groups — what they are and how to create one">
            <Body>
              A Group is a saved list of people — portal members and/or external visitors. Once you
              create a group, you can run multiple events against it without re-entering the same
              invitee list each time.
            </Body>
            <Step n={1}>Go to Availability in the navigation bar and tap Create Group.</Step>
            <Step n={2}>Give the group a name (required) and an optional description.</Step>
            <Step n={3}>
              Choose whether to allow members to manage membership (see below).
            </Step>
            <Step n={4}>
              Add portal members by searching for them by name. Add visitors by entering a name
              and email address. You can leave the group empty and add people later.
            </Step>
            <Step n={5}>Tap Create Group. You will be taken to the group page.</Step>
          </HelpSection>

          <HelpSection title="The &quot;Allow member management&quot; setting">
            <Body>
              By default, only the group creator can add or remove people. If you set
              Allow member management to Yes, any group member can add or remove people from the
              group. The group creator can always manage membership regardless of this setting.
            </Body>
          </HelpSection>

          <HelpSection title="Managing group membership">
            <Body>
              From the group page, tap Manage Members to open the membership panel. From there you
              can:
            </Body>
            <Step n={1}>See all current members with their type (Member or Visitor).</Step>
            <Step n={2}>Add new portal members using the searchable member list.</Step>
            <Step n={3}>
              Add new visitors by entering a name and email address and tapping Add Visitor.
            </Step>
            <Step n={4}>Remove any member using the Remove button next to their name.</Step>
            <Body>
              When you add someone to a group that has open events, they are automatically invited
              to those events and receive an invitation email.
            </Body>
          </HelpSection>

          <HelpSection title="Creating an event within a group">
            <Step n={1}>Go to the group page and tap Create Event.</Step>
            <Step n={2}>Fill in the title (required), an optional description, and the expiry date.</Step>
            <Step n={3}>Choose the event type: General, Fixture, or Signup (see below).</Step>
            <Step n={4}>
              Choose whether respondents can see each other's answers (Show responses to all
              respondents). Default is Yes.
            </Step>
            <Step n={5}>
              Optionally turn on Notify me when someone responds (see below).
            </Step>
            <Step n={6}>Add at least one candidate date/time slot using the Add Slot button.</Step>
            <Step n={7}>
              Tap Create Event. All current group members are automatically invited and receive
              invitation emails. You are taken to the management page.
            </Step>
          </HelpSection>

          <HelpSection title="Event types: General, Fixture, Signup">
            <Body>
              Every event has a type. This is for categorisation only — all three types work the
              same way.
            </Body>
            <Step n={1}>
              General — a general availability or scheduling poll (e.g. "When should we have our
              committee meeting?").
            </Step>
            <Step n={2}>
              Fixture — a poll related to a match or game (e.g. "Which Saturday works for our
              friendly?").
            </Step>
            <Step n={3}>
              Signup — a poll where people are indicating they want to take part, not just that
              they are available (e.g. "Who wants to enter the club pairs event?").
            </Step>
          </HelpSection>

          <HelpSection title="Creating a public event">
            <Body>
              Public events are visible to all logged-in portal members. No group or invitee list
              is needed — every member can see the poll and respond.
            </Body>
            <Step n={1}>Go to the Availability hub page and tap Create Public Event.</Step>
            <Step n={2}>Fill in the event details, slots, and settings as normal.</Step>
            <Step n={3}>Tap Create Event. Any portal member can now respond.</Step>
            <Body>
              Visitors cannot be invited to public events. Use a group event if you need to include
              non-members.
            </Body>
          </HelpSection>

          <HelpSection title="How to respond to an event (Yes / Maybe / No)">
            <Body>
              Open an event from the Availability hub or from the group page. For each candidate
              slot, tap one of the three response buttons in your row:
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
              Visitors in a group receive an individual email with a unique link when an event is
              created. Opening that link shows the event details and the response grid — no login
              required. Visitors can return to the same link at any time to update their responses
              before the event expires.
            </Body>
            <Body>
              Visitor links expire at the same time as the event. After the event expires or is
              concluded, the link becomes read-only.
            </Body>
          </HelpSection>

          <HelpSection title="Managing an event — responses, slots, status">
            <Body>
              Only the event creator (and admins) can access the Manage page. From there you can:
            </Body>
            <Step n={1}>Edit the title, description, expiry date, event type, and notification settings.</Step>
            <Step n={2}>
              See the full response grid — all respondents and all slots — regardless of the
              Show responses setting.
            </Step>
            <Step n={3}>Add new slots using the Add Slot button (open events only).</Step>
            <Step n={4}>
              Remove slots — warning: this also permanently deletes all existing responses for
              that slot.
            </Step>
            <Step n={5}>Close the event to stop accepting new responses without concluding it.</Step>
            <Step n={6}>Reopen a closed or concluded event.</Step>
            <Step n={7}>Conclude the event (see below).</Step>
            <Step n={8}>Archive the event to hide it from all views.</Step>
          </HelpSection>

          <HelpSection title="Show responses to all respondents">
            <Body>
              When set to Yes, every respondent can see the full grid — all names and their
              responses — on their response page. When set to No, each person only sees their own
              row. The event creator always sees everyone on the Manage page, regardless of this
              setting.
            </Body>
          </HelpSection>

          <HelpSection title="Notify me when someone responds">
            <Body>
              When turned on, the event creator receives a short email each time any respondent
              (member or visitor) saves their responses. This is most useful for one-on-one
              availability checks where you want an immediate notification. It is turned off by
              default to avoid inbox clutter for larger polls.
            </Body>
          </HelpSection>

          <HelpSection title="Concluding an event">
            <Step n={1}>Open the Manage page for the event and tap Conclude Event.</Step>
            <Step n={2}>Choose the winning slot from the dropdown.</Step>
            <Step n={3}>Optionally write a conclusion note (e.g. "See you there!").</Step>
            <Step n={4}>
              Tick Send notification email to all respondents if you want everyone who responded
              to receive an email with the chosen date.
            </Step>
            <Step n={5}>Tap Confirm Conclusion.</Step>
            <Body>
              Once concluded, the winning slot is highlighted in green in the response grid. You
              can reopen a concluded event if you need to change the outcome.
            </Body>
          </HelpSection>

          <HelpSection title="Archiving a group or event">
            <Body>
              Archiving removes a group or event from all views. Only the creator (and admins) can
              archive. Archived items cannot be restored through the portal.
            </Body>
            <Body>
              Archiving a group does not automatically archive its events — you need to archive
              each event separately if required.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
