'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpLeaguesPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Club Leagues</h1>
          <p className="text-gray-500 text-sm mt-1">Entering leagues, viewing fixtures and results</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              The Leagues page lists all club leagues — triples and pairs formats — grouped by status:
              In Progress, Entries Open, Not Started, and Complete. Tap any league card to open it.
            </Body>
            <Body>
              If you are already entered in a league, the card shows a green <strong>Entered</strong> badge
              so you can see at a glance which leagues you have signed up for.
            </Body>
          </HelpSection>

          <HelpSection title="Entering a league">
            <Note>
              You can only enter a league when its status is <strong>Entries Open</strong>. If no
              leagues are currently open, check back later or ask the Captain.
            </Note>
            <Step n={1}>Open the league you want to enter.</Step>
            <Step n={2}>Tap the green <strong>Enter League</strong> button near the top of the page.</Step>
            <Step n={3}>Tap <strong>Confirm Entry</strong>. You will see a blue confirmation banner.</Step>
            <Body>
              Once entries close, the Captain will arrange players into teams and generate the fixture
              schedule.
            </Body>
          </HelpSection>

          <HelpSection title="Withdrawing from a league">
            <Body>
              While a league is still in the <strong>Entries Open</strong> status, you can withdraw
              by opening the league and tapping the <strong>Withdraw</strong> button. Once entries
              close, contact the Captain if you need to withdraw.
            </Body>
          </HelpSection>

          <HelpSection title="Fixtures &amp; results">
            <Body>
              Tap the <strong>Fixtures &amp; Results</strong> tab to see all matches for the league.
              Matches are grouped by date — each date shows as a heading with all matches for that
              day listed underneath. Where a time has been set, it is shown next to the match.
            </Body>
            <Body>
              Matches that have not yet been given a date appear under an <strong>Unscheduled</strong>{' '}
              heading at the bottom.
            </Body>
            <Body>
              Each match shows the two teams, the score once entered, and a coloured status badge:
            </Body>
            <ul className="text-sm text-gray-700 list-disc list-inside space-y-1 mb-3 ml-1">
              <li><strong>Scheduled</strong> — match is upcoming</li>
              <li><strong>Played</strong> — result has been recorded</li>
              <li><strong>Walkover</strong> — a team received a walkover win</li>
              <li><strong>Cancelled</strong> — match will not be played</li>
            </ul>
          </HelpSection>

          <HelpSection title="Scores and results">
            <Body>
              Results are entered by the committee once a match has been played. If a score looks
              incorrect, contact the Captain to have it corrected.
            </Body>
          </HelpSection>

          <HelpSection title="League table">
            <Body>
              The <strong>League Table</strong> tab shows standings — Played, Won, Drew, Lost,
              Shots For, Shots Against, Shot Difference, and Points. The table updates automatically
              as results are recorded.
            </Body>
          </HelpSection>

          <HelpSection title="Players tab">
            <Body>
              The <strong>Players</strong> tab shows everyone entered in the league. Once teams have
              been set up by the committee, players are listed under their team name. Players not yet
              assigned to a team appear under <strong>Reserves</strong>.
            </Body>
            <Body>
              Your own entry is shown in the blue banner at the top of the page — it tells you
              which team you have been placed in and your position, if one has been assigned.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
