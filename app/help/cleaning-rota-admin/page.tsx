'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpCleaningRotaAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Cleaning Rota Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing the clubhouse cleaning schedule</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="The cleaning rota">
            <Body>
              The cleaning rota lists members assigned to clean the clubhouse on specific dates. All
              members can view the rota from Lookups → Cleaning Rota. As a GMC member you can add,
              edit, and remove assignments.
            </Body>
          </HelpSection>

          <HelpSection title="Adding an entry">
            <Step n={1}>Go to Lookups → Cleaning Rota.</Step>
            <Step n={2}>Tap Add Entry (visible to GMC members).</Step>
            <Step n={3}>Select the date and the members assigned.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Editing an entry">
            <Step n={1}>Find the entry in the rota list.</Step>
            <Step n={2}>Tap it to open the edit view.</Step>
            <Step n={3}>Update the date or assigned members.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Removing an entry">
            <Body>
              Tap an entry and use the Delete option to remove it. Members who have been notified
              separately will need to be informed of any changes.
            </Body>
          </HelpSection>

          <HelpSection title="Blocked dates">
            <Body>
              Certain dates can be marked as unavailable for cleaning assignments — for example,
              during events or closures. These are shown in the rota as blocked.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
