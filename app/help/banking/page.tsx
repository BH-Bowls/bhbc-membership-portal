'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpBankingPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Banking</h1>
          <p className="text-gray-500 text-sm mt-1">Importing payments and managing renewals</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              The Banking section (Admin → Banking) allows you to import the club&apos;s bank
              statement, automatically match payments to member renewals, and produce reports for the
              committee.
            </Body>
          </HelpSection>

          <HelpSection title="Importing a bank statement">
            <Step n={1}>Export a CSV from your online banking.</Step>
            <Step n={2}>Go to Admin → Banking and tap Import.</Step>
            <Step n={3}>Upload the CSV file.</Step>
            <Step n={4}>
              The system will parse the transactions and show them ready for matching.
            </Step>
          </HelpSection>

          <HelpSection title="Matching payments to renewals">
            <Step n={1}>
              After importing, each transaction is shown with a suggested match (based on amount and
              member name).
            </Step>
            <Step n={2}>
              Review each match — confirm correct ones and correct any that are wrong.
            </Step>
            <Step n={3}>
              Confirmed matches are marked as paid in the member&apos;s renewal record.
            </Step>
          </HelpSection>

          <HelpSection title="Unmatched payments">
            <Body>
              Transactions that cannot be automatically matched are shown separately. Review these
              manually and either match them to a member or mark them as other income.
            </Body>
          </HelpSection>

          <HelpSection title="Banking report">
            <Step n={1}>Go to Admin → Banking → Report.</Step>
            <Step n={2}>
              The report shows total income, matched and unmatched amounts, and a breakdown by
              payment type.
            </Step>
            <Step n={3}>
              You can download the report as a spreadsheet for committee meetings.
            </Step>
          </HelpSection>

          <HelpSection title="Renewals">
            <Note>
              The Banking section works alongside the Renewals system. When a payment is matched,
              the member&apos;s renewal status updates automatically. Members can check their own
              renewal status from the Renewals page.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
