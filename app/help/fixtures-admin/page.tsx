'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpFixturesAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Fixtures &amp; Season Planning</h1>
          <p className="text-gray-500 text-sm mt-1">Managing the fixture list, and planning next season</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Fixtures Management">
            <Body>
              Go to <strong>Admin → Fixtures Management</strong> (Captain and Admin) to manage the
              season&apos;s fixture list. Every fixture is here, whatever its type: Friendly, the
              external leagues (N/S A, N/S B, MSL, JSL, BL) and club Events. Members see the
              published list in Lookups → Fixtures.
            </Body>
            <Body>
              Choose the season at the top, then search by opponent or filter by type to find a
              fixture.
            </Body>
          </HelpSection>

          <HelpSection title="Adding a fixture">
            <Step n={1}>Tap <strong>+ Add Fixture</strong>.</Step>
            <Step n={2}>Choose the type, and enter the date and time.</Step>
            <Step n={3}>
              For a game, choose the club (and its suffix, e.g. &quot;A&quot;), Home or Away, and the
              format. For an Event, there is no opponent — enter a description instead.
            </Step>
            <Step n={4}>
              Add anything else that applies: Ladies, Men or Mixed, dress, the maximum number of
              players, pickup information and a message for the players.
            </Step>
            <Step n={5}>Tap <strong>Add Fixture</strong>.</Step>
          </HelpSection>

          <HelpSection title="Editing or deleting a fixture">
            <Body>
              Use <strong>Edit</strong> on any fixture to change its details, and{' '}
              <strong>Save Changes</strong>. Use <strong>Delete</strong> to remove one that isn&apos;t
              happening — you are asked to confirm, and it can&apos;t be undone.
            </Body>
            <Note>
              A friendly&apos;s result is recorded from Friendly Management, not here — it is shown
              here read-only.
            </Note>
          </HelpSection>

          <HelpSection title="Season Planning">
            <Body>
              <strong>Admin → Season Planning</strong> (Captain and Admin) builds next season&apos;s
              fixture list, in stages:
            </Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>Events</strong> and <strong>Friendlies</strong> — this season&apos;s fixtures are
                carried forward onto next year&apos;s calendar, using the date method you choose. Each
                one starts as Projected; edit the date, time and details as needed, mark it Confirmed,
                and delete anything that isn&apos;t happening. If you used the wrong date method, clear
                the projected ones and run it again.
              </li>
              <li>
                For Friendlies, each club&apos;s <strong>Contact</strong> button opens its contacts and
                fixture history, Mondays are flagged in amber, and you are warned when a day has more
                home games than rinks.
              </li>
              <li>
                <strong>Leagues</strong> — league fixtures come from Sussex County Bowls, so instead of
                carrying them forward you create a blank weekly slot for each league, then fill in the
                opponent, home or away and format as the county publishes them.
              </li>
              <li>
                <strong>Reservations</strong> — rinks booked every week for other uses (league nights,
                Friday Night Drive, the greenkeepers&apos; morning) or for a run of dates such as a
                beginners&apos; course. They count towards the rink warnings on Friendlies, and stay in
                place from one season to the next.
              </li>
            </ul>
          </HelpSection>

          <HelpSection title="League tables">
            <Body>
              The club&apos;s own leagues have their own pages — see the{' '}
              <Link href="/help/leagues-admin" className="text-blue-600 hover:text-blue-800">League Management</Link> help.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
