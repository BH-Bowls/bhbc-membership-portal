'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpInviteGamesPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Invite Games</h1>
          <p className="text-gray-500 text-sm mt-1">Managing invitation games for visiting clubs</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="What are invite games?">
            <Body>
              Invite games are matches you organise for visiting clubs to come and play at Burgess
              Hill. This section allows you to create invite game listings, attach relevant
              documents, and track them.
            </Body>
          </HelpSection>

          <HelpSection title="Creating an invite game">
            <Step n={1}>Go to Admin → Invite Games.</Step>
            <Step n={2}>Tap New Game.</Step>
            <Step n={3}>Enter the date, opposing club, format, and any additional details.</Step>
            <Step n={4}>Save.</Step>
          </HelpSection>

          <HelpSection title="Attaching documents">
            <Step n={1}>Open an invite game.</Step>
            <Step n={2}>Use the Attachments section to upload any relevant files (e.g. confirmation letters, maps).</Step>
            <Step n={3}>Files are stored securely and accessible from the game's page.</Step>
          </HelpSection>

          <HelpSection title="Editing or deleting">
            <Body>
              Open an invite game to edit any of its details. Use Delete to remove a game that has
              been cancelled. Deleted games and their attachments are permanently removed.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
