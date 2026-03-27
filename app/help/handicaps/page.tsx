'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, Tip, BackLink } from '../_components';

export default function HelpHandicapsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Handicaps</h1>
          <p className="text-gray-500 text-sm mt-1">Managing competition handicaps for playing members</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="What handicaps are for">
            <Body>
              Each playing member can be assigned a handicap (0–10) which is used in competition
              scoring. Handicaps are managed separately from competition results.
            </Body>
          </HelpSection>

          <HelpSection title="Viewing handicaps">
            <Body>
              Go to Admin → Handicaps to see a list of all playing members — Playing Men first, then
              Playing Ladies — with their current handicap. Members with no handicap set show as blank.
            </Body>
          </HelpSection>

          <HelpSection title="Updating a handicap">
            <Step n={1}>Find the member in the list.</Step>
            <Step n={2}>Tap their current handicap value (or the blank field).</Step>
            <Step n={3}>Enter the new value (0–10, or clear to remove).</Step>
            <Step n={4}>Tap Save All to save all changes at once.</Step>
          </HelpSection>

          <HelpSection title="Bulk updates">
            <Tip>
              You can update multiple members&apos; handicaps before saving. Make all your changes and
              then tap Save All once.
            </Tip>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
