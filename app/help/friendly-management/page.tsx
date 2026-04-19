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

          <HelpSection title="Keeping the list up to date">
            <Body>
              The game list loads instantly from a local cache when you navigate back from a game.
              A small circular arrow icon next to the page title lets you force a fresh reload from
              the server — useful if another captain has just made changes and you want to see the
              latest counts or statuses.
            </Body>
          </HelpSection>

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
            <Step n={6}>Optionally mark the captain of the day and assign driving duties for away games.</Step>
            <Step n={7}>Save your changes — you can return and edit at any time before publishing.</Step>
            <Note>
              Players who did not enter online can still be added manually using the{' '}
              <strong>Add Players</strong> button, which appears when you are in edit mode.
            </Note>
          </HelpSection>

          <HelpSection title="Swapping players">
            <Body>
              On the selection page you can swap two players&apos; team and position assignments
              without having to manually update each field. The most common use is replacing a
              player who has withdrawn — swap the withdrawn player with a reserve to slot the
              reserve straight into the vacated position.
            </Body>
            <Step n={1}>Click the <strong>swap icon</strong> (two arrows) on any player&apos;s row.</Step>
            <Step n={2}>A dialog opens. Choose the player you want to swap with from the dropdown.</Step>
            <Step n={3}>Click <strong>Swap</strong> — team numbers, positions, and driving are exchanged.</Step>
            <Note>
              Swapping only affects team assignment fields. Each player&apos;s confirmed / withdrawn
              status is not changed.
            </Note>
          </HelpSection>

          <HelpSection title="Player stats on the selection page">
            <Body>
              Each player row shows a compact stats summary to help with selection decisions:
            </Body>
            <div className="mt-1 mb-2 p-2 bg-gray-100 rounded font-mono text-sm text-gray-800 text-center">
              ND/Pk(%)&nbsp;+&nbsp;FE
            </div>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>ND</strong> (Name Down) — number of closed games where the player was selected (Playing, Reserve, or Reserve Team). Does not count games they simply entered.</p>
              <p><strong>Pk</strong> (Picked) — number of those games where the player was in the main playing team.</p>
              <p><strong>%</strong> — Pk as a percentage of ND. A rough fairness measure.</p>
              <p><strong>FE</strong> (Future Entered) — number of future open games the player has already entered. Useful context when balancing the team.</p>
            </div>
            <Body>
              The last 6 games history (shown in a tooltip on the selection page and on the Picker
              Sheet) shows only closed-game outcomes — P, R, T, D etc. Future entries are not
              included so the history stays meaningful.
            </Body>
          </HelpSection>

          <HelpSection title="Selection Helper">
            <Body>
              The amber <strong>Selection Helper</strong> button (next to Print Picker Sheet) opens
              a panel that surfaces key considerations before you finalise the team. It analyses the
              current entered players and highlights:
            </Body>
            <div className="mt-1 space-y-2 text-sm text-gray-700 mb-2">
              <p>
                <strong>🍺 Bar Volunteers</strong> (home games) — lists all entered players who are
                willing to do bar duty, and warns if none are currently selected.
              </p>
              <p>
                <strong>🚗 Drivers Needed</strong> (away games) — calculates how many cars are
                required (total players ÷ 4) and lists available drivers. Warns if the number of
                selected drivers is below what is needed.
              </p>
              <p>
                <strong>⭐ Recent Reserves</strong> — lists all entered players whose most recent
                closed game was a reserve, regardless of whether they are already selected for this
                game. Sorted by consecutive reserve streak: one reserve in a row is shown in
                yellow, two in orange, three or more in red. Each player&apos;s current selection
                status is shown alongside their name. Ties are broken by % played (lower first).
              </p>
              <p>
                <strong>🌟 First Timers</strong> — any entered player who has never been picked to
                play in a friendly.
              </p>
              <p>
                <strong>💑 Couples / Buddies</strong> — buddy pairs (set up in member profiles)
                where both players have entered this game. Worth trying to put them on the same
                rink. Shows each person&apos;s current selection status alongside their name.
              </p>
              <p>
                <strong>📊 % Played</strong> — shows the group average percentage played, then
                lists any players who are more than 10 percentage points above or below that
                average as a fairness prompt. Players who have never been picked (shown in First
                Timers) are not repeated here. If everyone is within 10% of the average, a
                reassuring &ldquo;no fairness concerns&rdquo; message is shown instead.
              </p>
            </div>
            <Tip>
              The Selection Helper loads fresh data when you open it. You can close and reopen it
              at any point during selection to see an updated picture as you make changes.
            </Tip>
          </HelpSection>

          <HelpSection title="Print buttons">
            <Body>
              Two print buttons are always visible on the selection page:
            </Body>
            <div className="mt-1 space-y-1.5 text-sm text-gray-700 mb-2">
              <p>
                <strong>Print Match Card</strong> — a formatted card showing the full team with
                positions, driving assignments, tea rota, and venue details. This is the card
                players take to the match.
              </p>
              <p>
                <strong>Print Picker Sheet</strong> — a working A4 sheet listing all entered players
                with their stats (ND/Pk/% + Future Entered) and last 6 games history. Use this when
                deciding who to select.
              </p>
            </div>
            <Note>
              Navigating to either print page and coming back does not reload the selection data —
              your edits are preserved and no extra sheet reads are made.
            </Note>
          </HelpSection>

          <HelpSection title="Publishing the selection">
            <Body>
              You can publish from two places — the <strong>Manage list</strong> (Publish button in
              the Actions column) or directly from the <strong>selection page</strong> (the teal
              Publish button in the toolbar, visible when you are not editing).
            </Body>
            <Step n={1}>Click <strong>Publish</strong>. A dialog appears with options.</Step>
            <Step n={2}>
              Tick <strong>Email entered players</strong> to send a personalised notification to
              each person who entered the game. Each email shows their individual status (Selected,
              Reserve, or not selected), team details, and a link to view and sign off their name
              online or at the clubhouse.
            </Step>
            <Step n={3}>
              For home games, tick <strong>Email tea rota</strong> to notify the members assigned
              to tea duty.
            </Step>
            <Step n={4}>
              Before sending to everyone, click <strong>Send Test Email</strong> to receive a
              preview of the email at your own address. You can do this as many times as you like.
            </Step>
            <Step n={5}>Click <strong>Publish</strong> to confirm.</Step>
            <Body>
              Once published, members can see the full team on the Friendlies page. The selection
              page toolbar shows an orange <strong>Republish</strong> button — use this if you
              need to update the selection after publishing and want to notify players again.
              Republish sends the same email but with the subject <em>Team Selection Updated</em>
              rather than <em>Team Selection Published</em>.
            </Body>
            <Note>
              Tea duty members are assigned on the <strong>Tea Rota</strong> page (Lookups → Tea
              Rota). The email here simply notifies whoever is already assigned for that date.
            </Note>
          </HelpSection>

          <HelpSection title="Adding a special instructions message">
            <Body>
              Any game (at any active status) can have a message attached — for example, a change
              of dress code, an early arrival request, or parking information.
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
              Paired games appear as a single combined row in the Manage table, highlighted in
              purple. The workflow is slightly different from a standard game:
            </Body>
            <Step n={1}><strong>Open Both</strong> — opens both games together for entries. Members enter as normal and the system combines the counts.</Step>
            <Step n={2}><strong>Close &amp; Allocate</strong> — closes both games and takes you to the allocation page, where you assign members to each of the two games.</Step>
            <Step n={3}>Once allocated, each game moves independently through the Selecting → Selected → Played flow using the standard Select Team and Publish actions.</Step>
            <Body>
              <strong>Setting up a paired game:</strong> Paired games are created by ticking the{' '}
              <strong>Paired game</strong> checkbox when adding or editing a game in Fixtures Admin
              (Admin → Fixtures Management). Both games on that date must have the Paired checkbox
              ticked — the system then automatically groups them together in the Manage view.
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
