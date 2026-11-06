'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpDataExportPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Data Export</h1>
          <p className="text-gray-500 text-sm mt-1">Building reports and exporting them to Excel</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              <strong>Admin → Members → Data Export</strong> (Admin only) builds a report from the
              portal&apos;s data and exports it as an Excel workbook — for committee reporting, other systems,
              or records.
            </Body>
            <Body>
              Reports can be built from Members, Renewals, Renewal Payments, the Cleaning and Sweeping
              Rotas, Games, Clubs and club Contacts.
            </Body>
          </HelpSection>

          <HelpSection title="Building a report">
            <Step n={1}>Under <strong>Report Configuration</strong>, choose what the report is about.</Step>
            <Step n={2}>
              Choose the columns you want. You can rename a column, or add one with a fixed value.
            </Step>
            <Step n={3}>
              Add <strong>Filters</strong> to narrow it down — for example a value is (or isn&apos;t) in a
              list, is blank or not, contains some text, or is greater or less than a number.
            </Step>
            <Step n={4}>Tap <strong>Run Report</strong> to see a preview.</Step>
            <Step n={5}>Tap <strong>Export to Excel (.xlsx)</strong> to download it.</Step>
          </HelpSection>

          <HelpSection title="Saved reports">
            <Body>
              Save a report you will want again, and give it a name. <strong>Load Saved</strong> lists your{' '}
              <strong>Saved Reports</strong> — open one to run it again, change and update it, or delete it.
            </Body>
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
