'use client';
import { useSession } from 'next-auth/react';
import { LastUpdated, HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpTeaRotaAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Tea Rota Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing tea duty for friendly match days</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="How the tea rota works">
            <Body>
              The tea rota lists the members assigned to tea duty for each home friendly. Assignments
              are managed directly on the Tea Rota page. When a game is published from Friendly
              Management, the captain has the option to email the assigned tea duty members with their
              details.
            </Body>
          </HelpSection>

          <HelpSection title="Viewing the rota">
            <Body>
              Go to Lookups → Tea Rota to see the full rota. All members can view it. The rota shows
              the date, opponent, and the three members on teas for each home game — Tea Lead, Tea First
              and Tea Second. Members&apos; own duties are highlighted, and they can swap them themselves.
            </Body>
          </HelpSection>

          <HelpSection title="Making manual changes">
            <Step n={1}>Go to Lookups → Tea Rota.</Step>
            <Step n={2}>Tap <strong>Edit</strong> (committee members only). Each name becomes a box you can search in.</Step>
            <Step n={3}>Pick a different member for any of the three places, or clear one.</Step>
            <Step n={4}>Tap <strong>Save</strong> at the top (or Cancel).</Step>
          </HelpSection>

          <HelpSection title="Cancelled games">
            <Body>
              The tea rota follows the fixtures. When a game is cancelled in Friendly Management it stays
              on the rota marked <strong>Cancelled</strong>, so there is nothing to delete. Members who were
              told about their tea duty will need to be told it is off.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
