'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Body, BackLink } from '../_components';

export default function HelpLookupsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Lookups</h1>
          <p className="text-gray-500 text-sm mt-1">Finding members, clubs, and rota information</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Members">
            <Body>
              Go to Lookups → Members to search for any club member by name. You can view contact
              details, address (if the member has allowed handbook entry), and other information they
              have shared. Use the search box to filter by name.
            </Body>
          </HelpSection>

          <HelpSection title="Clubs">
            <Body>
              Lookups → Clubs lists all visiting clubs in the Rowland Cup and other competitions.
              Each club&apos;s page shows contact names for each competition they are entered in, plus
              the club&apos;s address, phone, email, and website where available. Contact names are
              highlighted with their competition badge so you can quickly find the right person to
              arrange a match.
            </Body>
          </HelpSection>

          <HelpSection title="Fixtures">
            <Body>
              Lookups → Fixtures shows the club&apos;s full fixture list for the current season —
              friendlies, league matches (John Spriggs and others), and events all appear together
              in date order.
            </Body>
            <Body>
              Tabs at the top let you filter to a single category if you only want to see, for
              example, league fixtures or events.
            </Body>
          </HelpSection>

          <HelpSection title="Tea Rota">
            <Body>
              Lookups → Tea Rota shows who is assigned to do teas for upcoming friendly matches. The
              rota is generated automatically when a friendly game is published by the Captain. It
              shows the date, opponent, and the members assigned.
            </Body>
            <Body>
              If you need to swap your tea duty with another member, tap <strong>Swap</strong> next
              to your name, select the member you want to swap with, and confirm. An email
              notification is sent to that member so they know about the swap.
            </Body>
          </HelpSection>

          <HelpSection title="Cleaning Rota">
            <Body>
              Lookups → Cleaning Rota shows the clubhouse cleaning schedule. Each entry shows the
              date and which members are assigned.
            </Body>
            <Body>
              If you need to swap your cleaning duty with another member, tap <strong>Swap</strong>
              next to your name, select the member you want to swap with, and confirm. An email
              notification is sent to that member so they know about the swap.
            </Body>
          </HelpSection>

          <HelpSection title="Sweeping Rota">
            <Body>
              Lookups → Sweeping Rota shows a calendar of green sweeping duties. Use the arrow
              buttons to navigate between months, or tap <strong>Today</strong> to return to the
              current month.
            </Body>
            <Body>
              <strong>Adding individual days</strong> — tap any available day on the calendar to
              select it (it will be highlighted). You can tap multiple days before confirming. Once
              you have selected all the days you want, tap the <strong>Add Selected</strong> button
              to sign yourself up for all of them at once.
            </Body>
            <Body>
              <strong>Removing yourself</strong> — tap any day you are already assigned to and
              confirm the cancellation prompt to remove your name from that slot.
            </Body>
            <Body>
              <strong>Adding a pattern</strong> — tap the <strong>Add Pattern</strong> button to
              sign up for a recurring schedule without selecting days one by one. You can choose:
            </Body>
            <Body>
              <em>Frequency</em> — Every week, First of month, Second, Third, Fourth, Last, or
              1st &amp; 3rd / 2nd &amp; 4th fortnightly patterns.
            </Body>
            <Body>
              <em>Day of week</em> — which day the pattern falls on (e.g. every Tuesday).
            </Body>
            <Body>
              <em>Date range</em> — a from month and to month (up to 12 months ahead).
            </Body>
            <Body>
              Before confirming, a preview of all the matching dates is shown so you can check
              what you are signing up for. Tap <strong>Confirm</strong> to add them all at once.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
