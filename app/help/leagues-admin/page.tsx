'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

export default function HelpLeaguesAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Leagues Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Setting up leagues, managing squads and fixtures</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              League management is accessed via <strong>Admin → Leagues Admin</strong>. From there
              you can create new leagues, change their status, manage teams and squads, generate or
              add fixtures, and record results.
            </Body>
            <Body>
              Each league has three tabs in the management view: <strong>Squad</strong>,{' '}
              <strong>Fixtures</strong>, and <strong>Settings</strong>.
            </Body>
          </HelpSection>

          <HelpSection title="Creating a league">
            <Step n={1}>
              Go to <strong>Admin → Leagues Admin</strong> and tap <strong>New League</strong>.
            </Step>
            <Step n={2}>Enter a name, choose the type (Triples or Pairs), and set the season.</Step>
            <Step n={3}>
              The league is created with status <strong>Not Started</strong>. Change the status to{' '}
              <strong>Entries Open</strong> when you are ready for members to sign up.
            </Step>
          </HelpSection>

          <HelpSection title="League status">
            <Body>
              Status controls what members can see and do. Change it using the dropdown at the top
              of the management page. The four statuses are:
            </Body>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 mb-3 ml-1">
              <li><strong>Not Started</strong> — league is visible but entries are closed</li>
              <li><strong>Entries Open</strong> — members can enter or withdraw</li>
              <li><strong>In Progress</strong> — entries closed, fixtures under way</li>
              <li><strong>Complete</strong> — league finished, final table shown</li>
            </ul>
          </HelpSection>

          <HelpSection title="Announcement message">
            <Body>
              On the main Leagues page there is a message panel. If you are a committee member, you
              will see an <strong>Edit</strong> button — use this to post a message that all members
              will see when they open the Leagues section, for example to announce when entries open
              or to share a reminder about the schedule.
            </Body>
          </HelpSection>

          <HelpSection title="Setting up teams">
            <Note>
              Teams need to be created before you can assign players or generate fixtures.
            </Note>
            <Step n={1}>Open the league management page.</Step>
            <Step n={2}>
              In the left panel, tap <strong>+ Add team</strong> and enter a team name.
            </Step>
            <Step n={3}>Repeat for each team in the league.</Step>
            <Body>
              Teams can be renamed or deleted at any time before fixtures are generated.
            </Body>
          </HelpSection>

          <HelpSection title="Assigning players to teams">
            <Body>
              The <strong>Squad</strong> tab shows a slot-based editor for each team.
              For a triples league each team has 2 Skip slots, 2 No.2 slots, and 2 Lead slots.
              For a pairs league each team has 2 Skip slots and 2 Lead slots.
            </Body>
            <Step n={1}>Select a team by tapping its name in the team list on the left.</Step>
            <Step n={2}>
              For each slot, start typing the player&apos;s name in the box — type a surname or part of
              a name to filter the list (e.g. type <em>Dann</em> to find <em>Colin Dann</em>).
              Select from the dropdown.
            </Step>
            <Step n={3}>
              Tap <strong>Save Team</strong> to save the assignments. The button is disabled until
              you have made a change.
            </Step>
            <Step n={4}>
              Repeat for each team. Players already assigned to another team are shown with a
              strikethrough in the overview and cannot be selected again.
            </Step>
            <Tip>
              Tap <strong>Discard &amp; reload saved</strong> to undo unsaved changes for the
              current team.
            </Tip>
            <Body>
              Players entered in the league but not yet assigned to a team appear under{' '}
              <strong>Unassigned</strong> in the overview at the top of the Squad tab.
            </Body>
          </HelpSection>

          <HelpSection title="Generating fixtures">
            <Body>
              Once teams are set up, go to the <strong>Fixtures</strong> tab and tap{' '}
              <strong>Generate Round-Robin</strong>. This creates a full double round-robin schedule
              — every team plays every other team twice (once at home, once away).
            </Body>
            <Note>
              Generating fixtures replaces any existing unplayed fixtures. Played or walkover matches
              are not affected.
            </Note>
          </HelpSection>

          <HelpSection title="Adding fixtures manually">
            <Body>
              To add a single fixture — for example to replace a cancelled match or add a
              supplementary game — tap <strong>+ Add fixture</strong> on the Fixtures tab, select
              the home and away teams, and tap <strong>Add</strong>.
            </Body>
          </HelpSection>

          <HelpSection title="Scheduling fixtures (dates &amp; times)">
            <Body>
              Fixtures are not automatically given dates — you set them once you know the
              schedule. Tap the <strong>Edit</strong> button next to any fixture to set the date
              and time. For triples leagues a specific date and time is set; for pairs leagues a
              play-by date is set instead.
            </Body>
            <Body>
              On the public Leagues page, fixtures are grouped by their scheduled date. Matches
              without a date appear under <strong>Unscheduled</strong>.
            </Body>
          </HelpSection>

          <HelpSection title="Recording results">
            <Body>
              Results can be entered from either the manage page or the public league page. Tap
              <strong> Enter Score</strong> on an unplayed match, or <strong>Edit</strong> on a
              match that already has a result.
            </Body>
            <Body>
              The dialog has a <strong>Result type</strong> dropdown with three options:
            </Body>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 mb-3 ml-1">
              <li><strong>Score</strong> — enter the score for both teams; the league table updates automatically</li>
              <li><strong>Walkover</strong> — records the match as a walkover with no score</li>
              <li><strong>Cancelled</strong> — marks the match as cancelled</li>
            </ul>
            <Note>
              Only committee members can edit a result once it has been saved. Squad members can
              only enter scores for their own team&apos;s unplayed matches.
            </Note>
          </HelpSection>

          <HelpSection title="Settings tab">
            <Body>
              The <strong>Settings</strong> tab on the manage page lets you rename the league or
              delete it. Deleting a league permanently removes all teams, squad entries, and
              fixtures — this cannot be undone.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
