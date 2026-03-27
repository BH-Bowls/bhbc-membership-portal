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
          </HelpSection>

          <HelpSection title="Cleaning Rota">
            <Body>
              Lookups → Cleaning Rota shows the clubhouse cleaning schedule. Each entry shows the
              date and which members are assigned.
            </Body>
          </HelpSection>

          <HelpSection title="Sweeping Rota">
            <Body>
              Lookups → Sweeping Rota shows the green sweeping schedule, showing who is responsible
              for sweeping on each date.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
