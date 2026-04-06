'use client';
import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Body, Note, Tip, BackLink } from '../_components';

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
          <p className="text-gray-500 text-sm mt-1">Managing the full lifecycle of friendly matches</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview — game statuses">
            <Body>
              Every game moves through a series of statuses. The Manage page shows all games in a
              table with the current status and the actions available at that point.
            </Body>
            <div className="mt-2 space-y-1.5 text-sm text-gray-700">
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Upcoming</span><span>Game created but not yet open for entries.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Open</span><span>Members can enter. Entry counts are shown live.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Selecting</span><span>Entries closed. Captain is building the team.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Selected</span><span>Team published and visible to members.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Played</span><span>Result recorded.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Cancelled</span><span>Game called off before it was played.</span></div>
              <div className="flex gap-2"><span className="font-medium w-24 shrink-0">Abandoned</span><span>Game started but not completed.</span></div>
            </div>
          </HelpSection>

          <HelpSection title="Opening a game for entries">
            <Step n={1}>Go to <strong>Friendly Management</strong> from the navigation menu.</Step>
            <Step n={2}>Find the game in the <strong>Upcoming</strong> tab (or All).</Step>
            <Step n={3}>Click <strong>Open</strong> in the Actions column and confirm.</Step>
            <Body>
              The game is now open. Members can enter from the Friendlies page. The entry count
              updates live as members add themselves.
            </Body>
          </HelpSection>

          <HelpSection title="Closing entries and selecting the team">
            <Step n={1}>When you are ready to pick the team, click <strong>Close</strong> next to the game.</Step>
            <Step n={2}>Confirm — this closes entries and creates an internal selection sheet.</Step>
            <Step n={3}>Click <strong>Select Team</strong> to open the selection page.</Step>
            <Step n={4}>Mark each player as Playing, Reserve, or Reserve Team.</Step>
            <Step n={5}>Assign a team number and position (Skip, Lead, 2nd, 3rd) to playing members.</Step>
            <Step n={6}>Optionally mark the captain of the day and assign driving duties.</Step>
            <Step n={7}>Save your changes — you can return and edit at any time before publishing.</Step>
            <Note>
              Players who did not enter online can still be added manually on the selection page using
              the Add Player button.
            </Note>
            <Body>
              The selection page has two print buttons:
            </Body>
            <div className="ml-0 space-y-1.5 text-sm text-gray-700 mb-2">
              <p><strong>Print Match Card</strong> — a formatted card showing the full team with positions, driving assignments, tea rota, and venue details. This is the card players take to the match.</p>
              <p><strong>Print Picker Sheet</strong> — a working sheet listing all entered players with their stats (name down, picked, % played) to help you decide who to select.</p>
            </div>
          </HelpSection>

          <HelpSection title="Publishing the selection">
            <Step n={1}>When the team is finalised, click <strong>Publish</strong>.</Step>
            <Step n={2}>A dialog appears with two optional email checkboxes:</Step>
            <div className="ml-9 space-y-1 text-sm text-gray-700 mb-3">
              <p><strong>Email entered players</strong> — sends a notification to everyone who entered the game telling them whether they are playing, reserve, or not selected.</p>
              <p><strong>Email tea rota</strong> — for home games, notifies the members assigned to tea duty with their details. This option only appears for home games.</p>
            </div>
            <Step n={3}>Tick whichever emails you want to send, then click <strong>Publish</strong>.</Step>
            <Body>
              Once published, members can see the full team selection on the Friendlies page and on
              their match card.
            </Body>
            <Note>
              Tea duty members are assigned on the <strong>Tea Rota</strong> page (Lookups → Tea Rota),
              not within Friendly Management. The email here simply notifies whoever is already
              assigned for that date.
            </Note>
          </HelpSection>

          <HelpSection title="Adding a special instructions message">
            <Body>
              Any game (at any active status) can have a message attached to it — for example,
              a change of dress code, an early arrival request, or parking information.
            </Body>
            <Step n={1}>Click <strong>Message</strong> in the Actions column next to the game.</Step>
            <Step n={2}>Type the instructions in the dialog and click <strong>Save</strong>.</Step>
            <Step n={3}>Members will see a <strong>See Special Instructions</strong> link on the game card, which opens the message in a popup.</Step>
            <Tip>
              The Message button is amber when a message already exists, grey when there is none.
              Clear the text and save to remove a message.
            </Tip>
          </HelpSection>

          <HelpSection title="Recording a result">
            <Step n={1}>After the match, click <strong>Record Result</strong> next to the selected game.</Step>
            <Step n={2}>Choose what happened: <strong>Played</strong>, <strong>Cancelled</strong>, or <strong>Abandoned</strong>.</Step>
            <Step n={3}>
              For Played or Abandoned, enter the Burgess Hill score and the opponent score.
              For Cancelled or Abandoned, enter the reason and who initiated it.
            </Step>
            <Step n={4}>Click <strong>Save</strong> — the result appears on the Friendlies page for all members to see.</Step>
          </HelpSection>

          <HelpSection title="Cancelling a game">
            <Body>
              A <strong>Cancel</strong> button is shown for any game that has not yet been played
              (Upcoming, Open, or Selecting). You will be asked for a reason and who cancelled.
              Members who had been notified via email will need to be told separately.
            </Body>
          </HelpSection>

          <HelpSection title="Paired games">
            <Body>
              A paired game is when two separate games take place on the same date — typically a
              Ladies game and a Men&apos;s game. Because members enter without knowing which game
              they will be assigned to, entries are pooled and the captain then allocates them
              between the two games.
            </Body>
            <Body>
              Paired games appear as a single combined row in the Manage table, highlighted in purple.
              The workflow is slightly different from a standard game:
            </Body>
            <Step n={1}><strong>Open Both</strong> — opens both games together for entries. Members enter as normal and the system combines the counts.</Step>
            <Step n={2}><strong>Close &amp; Allocate</strong> — closes both games and takes you to the allocation page, where you assign members to each of the two games.</Step>
            <Step n={3}>Once allocated, each game moves independently through the Selecting → Selected → Played flow using the standard Select Team and Publish actions.</Step>
            <Body>
              <strong>Setting up a paired game:</strong> Paired games are created by ticking the <strong>Paired game</strong> checkbox when adding or editing a game in Fixtures Admin (Admin → Fixtures Management). Both games on that date must have the Paired checkbox ticked — the system then automatically groups them together in the Manage view.
            </Body>
            <Note>
              The Message button on a paired row sets the message for the first game. If you need
              separate messages for each game, handle them individually after allocation.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
