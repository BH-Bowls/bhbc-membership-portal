'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpFixturesAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Fixtures &amp; League Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing the fixture list and league tables</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Fixtures">
            <Body>
              Go to Admin → Fixtures Management to manage the season fixture list. Fixtures are the
              scheduled matches against other clubs for the playing season.
            </Body>
          </HelpSection>

          <HelpSection title="Adding a fixture">
            <Step n={1}>Tap New Fixture.</Step>
            <Step n={2}>Enter the date, opponent, and whether it is home or away.</Step>
            <Step n={3}>Set the format and any additional details.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Editing or removing a fixture">
            <Body>
              Tap any existing fixture to edit its details. Use Delete to remove a fixture that has
              been cancelled. Published fixtures are visible to all members on the Fixtures page.
            </Body>
          </HelpSection>

          <HelpSection title="League management">
            <Body>
              Go to Admin → League Management to manage league tables. Leagues are used for internal
              competitions where teams accumulate points over multiple matches.
            </Body>
          </HelpSection>

          <HelpSection title="Updating league results">
            <Step n={1}>Open the relevant league.</Step>
            <Step n={2}>Find the fixture whose result needs recording.</Step>
            <Step n={3}>Enter the scores for each team.</Step>
            <Step n={4}>Save — the league table updates automatically.</Step>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
