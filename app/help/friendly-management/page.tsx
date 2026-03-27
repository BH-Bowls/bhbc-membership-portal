'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpFriendlyManagementPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Friendly Management</h1>
          <p className="text-gray-500 text-sm mt-1">Creating and managing friendly games</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Creating a game">
            <Step n={1}>Go to Admin → Friendly Management.</Step>
            <Step n={2}>Tap New Game.</Step>
            <Step n={3}>Enter the date, opponent, and whether it is home or away.</Step>
            <Step n={4}>Set the format (e.g. Triples) and the number of rinks.</Step>
            <Step n={5}>Save the game — it is saved as a draft and not yet visible to members.</Step>
          </HelpSection>

          <HelpSection title="Selecting the team">
            <Step n={1}>Open the game and go to the Team tab.</Step>
            <Step n={2}>Select players for each rink. Players marked as unavailable will be flagged.</Step>
            <Step n={3}>Assign a skip, second, and lead for each rink.</Step>
            <Step n={4}>Save the team selection.</Step>
          </HelpSection>

          <HelpSection title="Assigning teas">
            <Step n={1}>Go to the Teas tab on the game.</Step>
            <Step n={2}>Select the members assigned to do teas for this home match.</Step>
            <Step n={3}>Save — the names will appear on the Tea Rota for that date.</Step>
          </HelpSection>

          <HelpSection title="Publishing the game">
            <Step n={1}>Once the team and teas are finalised, tap Publish.</Step>
            <Step n={2}>The game becomes visible to all members.</Step>
            <Step n={3}>The tea rota is automatically emailed to the members assigned.</Step>
          </HelpSection>

          <HelpSection title="Recording the result">
            <Step n={1}>After the match, open the game from Friendly Management.</Step>
            <Step n={2}>Enter the result for each rink and the overall match score.</Step>
            <Step n={3}>Save — the result is then visible to all members on the Friendlies page.</Step>
          </HelpSection>

          <HelpSection title="Cancelling a game">
            <Body>
              If a game needs to be cancelled, open it and use the Cancel option. Members who had been
              notified via the tea rota email will need to be informed separately.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
