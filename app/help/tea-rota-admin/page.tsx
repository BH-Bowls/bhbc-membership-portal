'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpTeaRotaAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Tea Rota Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing tea duty for friendly match days</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="How the tea rota works">
            <Body>
              The tea rota is generated automatically when a friendly game is published. Members
              assigned to teas are selected during the Friendly Management process (on the Teas tab of
              each game). When the game is published, an email is sent to those members with their tea
              duty details.
            </Body>
          </HelpSection>

          <HelpSection title="Viewing the rota">
            <Body>
              Go to Lookups → Tea Rota to see the full rota. All members can view it. The rota shows
              the date, opponent, and the members assigned for each home game.
            </Body>
          </HelpSection>

          <HelpSection title="Making manual changes">
            <Step n={1}>Go to Lookups → Tea Rota.</Step>
            <Step n={2}>As a Captain you will see edit controls on each entry.</Step>
            <Step n={3}>Tap an entry to edit the assigned members.</Step>
            <Step n={4}>Save your changes.</Step>
          </HelpSection>

          <HelpSection title="Removing an entry">
            <Body>
              If a game is cancelled, the tea rota entry can be deleted from the Tea Rota page.
              Members who received the email notification will need to be told separately.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
