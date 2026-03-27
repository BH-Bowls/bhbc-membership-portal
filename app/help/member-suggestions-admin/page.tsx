'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpMemberSuggestionsAdminPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Member Suggestions</h1>
          <p className="text-gray-500 text-sm mt-1">Reviewing and managing improvement suggestions</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="How it works">
            <Body>
              Any member can submit a suggestion for improving the club. GMC members review all
              submissions, decide whether to accept them, and can assign a coordinator to oversee
              delivery. Members can only see their own suggestions plus any accepted ongoing projects.
            </Body>
          </HelpSection>

          <HelpSection title="Reviewing submissions">
            <Step n={1}>Go to Admin → Member Suggestions.</Step>
            <Step n={2}>Use the tabs to filter by status — All, Pending, Accepted, In Progress, Complete, or Rejected.</Step>
            <Step n={3}>Tap a suggestion to open the full details.</Step>
          </HelpSection>

          <HelpSection title="Accepting or rejecting">
            <Step n={1}>Open a suggestion.</Step>
            <Step n={2}>Use the Committee Acceptance field to mark it as Accepted or Rejected.</Step>
            <Step n={3}>If rejected, you can add a note.</Step>
            <Step n={4}>Accepted suggestions become visible to all members as ongoing projects.</Step>
          </HelpSection>

          <HelpSection title="Assigning a coordinator">
            <Body>
              An accepted suggestion can have a coordinator assigned — a member responsible for
              overseeing the work. The coordinator can then update progress notes and estimated costs
              directly from their view of the suggestion.
            </Body>
          </HelpSection>

          <HelpSection title="Committee-only suggestions">
            <Body>
              When a GMC member submits a suggestion, it is automatically marked as committee-only
              and hidden from regular members until it is accepted. You can also manually toggle this
              flag on any suggestion.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
