'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpDataExportPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Data Export</h1>
          <p className="text-gray-500 text-sm mt-1">Exporting member data</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              The Data Export tool (Admin → Data Export) allows you to extract member data from the
              portal in spreadsheet format. Exports can be used for committee reporting, external
              systems, or record keeping.
            </Body>
          </HelpSection>

          <HelpSection title="Running an export">
            <Step n={1}>Go to Admin → Data Export.</Step>
            <Step n={2}>Select the export definition you want to run from the list.</Step>
            <Step n={3}>Tap Run Export.</Step>
            <Step n={4}>The file will download automatically as a CSV or Excel file.</Step>
          </HelpSection>

          <HelpSection title="Export definitions">
            <Body>
              Each export definition specifies which fields are included and how the data is
              filtered. Definitions can be created and edited from the Definitions tab. For example,
              you might have a definition for all playing members, or for members who have not yet
              renewed.
            </Body>
          </HelpSection>

          <HelpSection title="Creating a definition">
            <Step n={1}>Go to the Definitions tab.</Step>
            <Step n={2}>Tap New Definition.</Step>
            <Step n={3}>Give it a name and select the fields to include.</Step>
            <Step n={4}>Apply any filters (e.g. member type, renewal status).</Step>
            <Step n={5}>Save.</Step>
          </HelpSection>

          <HelpSection title="Data handling">
            <Note>
              Exported data contains personal member information. Handle it in accordance with the
              club&apos;s data protection policy and do not share it outside the committee without
              authorisation.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
