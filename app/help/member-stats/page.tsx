'use client';
import { LastUpdated, HelpSection, Body, BackLink } from '../_components';

export default function HelpMemberStatsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Membership Statistics</h1>
          <p className="text-gray-500 text-sm mt-1">A live snapshot of club membership figures</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              Choose <strong>Membership Statistics</strong> from the <strong>Admin</strong> menu. It is
              available to Captains, GMC members and Admins. The figures are worked out from the current
              member list each time the page opens.
            </Body>
          </HelpSection>

          <HelpSection title="Membership by type">
            <Body>
              The number of Playing Men, Playing Ladies, Social Men and Social Ladies, with totals for
              playing and social members and a grand total. Members who have left are not counted.
            </Body>
          </HelpSection>

          <HelpSection title="Age demographics">
            <Body>
              Members by age group — Under 18, 18–24, 25–59, 60+ and 80+ — as recorded on each member&apos;s
              profile and renewal. Members with no age group set are counted as{' '}
              <strong>Unknown / Not Set</strong>.
            </Body>
          </HelpSection>

          <HelpSection title="Indicators">
            <Body>
              <strong>No email address on record</strong> — members without an email address. They
              can&apos;t receive any portal emails (game confirmations, tea rota, renewals and so on), so it
              is worth asking them for one.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
