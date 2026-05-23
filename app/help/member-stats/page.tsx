'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Note, Body, BackLink } from '../_components';

export default function HelpMemberStatsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Membership Statistics</h1>
          <p className="text-gray-500 text-sm mt-1">A live snapshot of club membership figures</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              Go to the <strong>Admin</strong> menu in the top navigation bar and choose{' '}
              <strong>Membership Statistics</strong>. The figures are drawn live from the Members
              sheet each time the page loads.
            </Body>
            <Note>
              This page is available to Captains, GMC members, and Admins. Treasurer access was
              removed as the Treasurer is already a GMC member.
            </Note>
          </HelpSection>

          <HelpSection title="Membership breakdown">
            <Body>
              The top section shows the total number of members and a breakdown by membership type —
              for example Full, Associate, Social, or Life. Each type shows its count and percentage
              of the total.
            </Body>
          </HelpSection>

          <HelpSection title="Age profile">
            <Body>
              Where date of birth has been recorded, members are grouped into age bands. This gives
              the committee a picture of the age range of the club&apos;s playing membership.
            </Body>
            <Body>
              Members without a recorded date of birth appear in an <strong>Unknown</strong> band at
              the bottom of the list.
            </Body>
          </HelpSection>

          <HelpSection title="Operational indicators">
            <Body>
              Below the breakdown tables, two additional counts help identify data gaps:
            </Body>
            <div className="mt-1 space-y-2 text-sm text-gray-700 mb-2">
              <p>
                <strong>No email address</strong> — members who do not have an email address on
                record. These members cannot receive any portal emails (game confirmations,
                withdrawals, tea rota, etc.).
              </p>
              <p>
                <strong>New this year</strong> — members whose join date falls in the current
                calendar year. Useful for tracking new member growth.
              </p>
            </div>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
