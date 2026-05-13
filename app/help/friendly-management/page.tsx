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

          <HelpSection title="The Actions dropdown">
            <Body>
              Each game row has a dropdown and a green <strong>Go</strong> button. The dropdown
              pre-selects the most common next action for each status — so for an Open game it
              defaults to <em>Close Entries</em>, for a Selecting game it defaults to{' '}
              <em>Select Team</em>, and so on. Click <strong>Go</strong> to run it, or change the
              dropdown first if you want a different action.
            </Body>
            <Body>
              All available actions for a game&apos;s current status are listed in the dropdown,
              including the backward steps described below.
            </Body>
          </HelpSection>

          <HelpSection title="Opening a game for entries">
            <Step n={1}>Go to <strong>Friendly Management</strong> from the navigation menu.</Step>
            <Step n={2}>Find the game in the <strong>Upcoming</strong> tab (or All).</Step>
            <Step n={3}>Select <strong>Open</strong> from the dropdown and click <strong>Go</strong>, or click Go directly if Open is already the default.</Step>
            <Step n={4}>
              A dialog appears. For <strong>away games</strong>, club details (distance, travel time,
              general information) are shown automatically. You can set the{' '}
              <strong>Pickup Information</strong> — where and when cars leave — at this point, or
              add it later. For away games, a default pickup time is pre-calculated from the travel
              time and match start time.
            </Step>
            <Step n={5}>Optionally add <strong>Special Instructions</strong> (dress code, early arrival, etc.), then click <strong>Open</strong>.</Step>
            <Body>
              Members can now enter from the Friendlies page. The entry count updates live.
            </Body>
          </HelpSection>

          <HelpSection title="Closing entries and selecting the team">
            <Step n={1}>When you are ready to pick the team, select <strong>Close Entries</strong> and click <strong>Go</strong>.</Step>
            <Step n={2}>A dialog appears. For away games you can update the <strong>Pickup Information</strong> before closing. Click <strong>Close</strong> — this closes entries and creates an internal selection sheet.</Step>
            <Step n={3}>Click <strong>Select Team</strong> to open the selection page.</Step>
            <Step n={4}>Mark each player as Playing, Reserve, or Reserve Team.</Step>
            <Step n={5}>Assign a team number and position (Skip, Lead, 2nd, 3rd) to playing members.</Step>
            <Step n={6}>Optionally mark the captain of the day and assign driving duties for away games.</Step>
            <Step n={7}>Save your changes — you can return and edit at any time before publishing.</Step>
            <Note>
              Players who did not enter online can still be added manually using the{' '}
              <strong>Add Players</strong> button on the selection page. If you remove a player
              after the game has been published, you will be asked whether to{' '}
              <strong>Withdraw</strong> them (marks them as withdrawn in the stats) or{' '}
              <strong>Remove</strong> them completely (no trace in the stats — useful when
              moving a player between the two games in a paired game).
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
              Hover over any player&apos;s name on the selection page to see their last 6 games
              history as a tooltip — P (Playing), R (Reserve), T (Reserve Team), D (Did not enter),
              etc. The same history also appears on the Picker Sheet. Only closed-game outcomes are
              shown, so the history stays meaningful.
            </Body>
          </HelpSection>

          <HelpSection title="Selection Helper">
            <Body>
              The <strong>Selection Helper</strong> is an inline panel in the right-hand column
              of the selection page, accessible via the tab toggle at the top of that column. It
              analyses the entered players and surfaces key considerations to help you finalise
              the team:
            </Body>
            <div className="mt-1 space-y-2 text-sm text-gray-700 mb-2">
              <p>
                <strong>Recent Reserves</strong> — players whose most recent closed game was a
                reserve outcome, sorted by consecutive reserve streak. One reserve is shown in
                yellow, two in orange, three or more in red. Each player&apos;s current selection
                status is shown alongside their name.
              </p>
              <p>
                <strong>First Timers</strong> — any entered player who has never been picked to
                play in a friendly.
              </p>
              <p>
                <strong>Couples / Buddies</strong> — buddy pairs (set up in member profiles)
                where both players have entered this game. Worth trying to put them on the same
                rink.
              </p>
              <p>
                <strong>% Played</strong> — shows the group average percentage played, then flags
                any players more than 10 percentage points above or below that average as a
                fairness prompt. If everyone is within range, a &ldquo;no fairness concerns&rdquo;
                message is shown instead.
              </p>
            </div>
            <Tip>
              Use the <strong>Refresh</strong> button within the helper to reload the analysis
              after making selection changes. The <strong>?</strong> toggle shows a brief
              explanation of each section.
            </Tip>
          </HelpSection>

          <HelpSection title="Concurrent editing lock">
            <Body>
              Only one captain can edit a game at a time. When you enter edit mode the system
              records your name and the time. If another captain tries to edit the same game while
              you have it open, they will see a dialog showing who is currently editing and when
              they started.
            </Body>
            <Body>
              The other captain can choose to wait, or click <strong>Override</strong> to take
              over the lock and open the editor themselves. If you are overridden, your
              in-progress changes will not be saved automatically — save or cancel before
              stepping away to avoid conflicts.
            </Body>
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
              You can publish from two places — the <strong>Manage list</strong> (select Publish
              from the dropdown and click Go) or directly from the <strong>selection page</strong>{' '}
              (the teal Publish button in the toolbar, visible when you are not editing).
            </Body>
            <Step n={1}>Click <strong>Publish</strong>. A dialog appears.</Step>
            <Step n={2}>
              For away games, you can review or update the <strong>Pickup Information</strong>
              before publishing — this is what appears on the game card for members.
            </Step>
            <Step n={3}>
              Tick <strong>Email entered players</strong> to send a personalised notification to
              each person who entered the game. Each email shows their individual status (Selected,
              Reserve, or not selected), team details, and a link to view and sign off their name
              online or at the clubhouse. By default all entered players are emailed — switch to{' '}
              <strong>Select players</strong> to choose specific recipients (useful after a late
              swap when only one or two people need to know about the change).
            </Step>
            <Step n={4}>
              For home games, tick <strong>Email tea rota</strong> to notify the members assigned
              to tea duty.
            </Step>
            <Step n={5}>
              Before sending to everyone, click <strong>Send Test Email</strong> to receive a
              preview of the email at your own address. You can do this as many times as you like.
            </Step>
            <Step n={6}>Click <strong>Publish</strong> to confirm.</Step>
            <Body>
              Once published, members can see the full team on the Friendlies page. The selection
              page toolbar shows an orange <strong>Republish</strong> button — use this if you
              need to update the selection after publishing and want to notify players again.
              Republish sends the same email but with the subject <em>Team Selection Updated</em>
              rather than <em>Team Selection Published</em>. The same All / Select players option
              is available — after a single swap, email just the affected players.
            </Body>
            <Note>
              Tea duty members are assigned on the <strong>Tea Rota</strong> page (Lookups → Tea
              Rota). The email here simply notifies whoever is already assigned for that date.
            </Note>
          </HelpSection>

          <HelpSection title="Special Instructions and Pickup Information">
            <Body>
              Both fields can be set or changed at any point using the{' '}
              <strong>Instructions</strong> button on the game editor page (the teal button in the
              toolbar when not in edit mode).
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p>
                <strong>Special Instructions</strong> — a free-text message members see as a{' '}
                <em>See Special Instructions</em> link on the game card. Use it for dress code
                changes, early arrival requests, parking notes, etc. Available when opening a game
                or via the Instructions button.
              </p>
              <p>
                <strong>Pickup Information</strong> — shown on the game card for away games,
                below the date and time. Use it to detail which cars are going and where they
                are picking up from. Available on all away game dialogs (Open, Close, Publish, and
                Instructions).
              </p>
            </div>
            <Tip>
              For away games, the Pickup Information field is pre-filled with a calculated default
              pickup time (based on the travel time to the venue) when you first open a game.
              Edit it freely before saving.
            </Tip>
          </HelpSection>

          <HelpSection title="Reverting a game to a previous status">
            <Body>
              If you need to step a game back — for example to reopen entries after closing early
              by mistake — use the dropdown options prefixed with a left arrow:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>← Upcoming</strong> (available when Open) — reverts to Upcoming, closing entries without creating a selection sheet.</p>
              <p><strong>← Open</strong> (available when Selecting) — reopens entries so members can enter or withdraw again.</p>
              <p><strong>← Selecting</strong> (available when Selected/Published) — unpublishes the selection. Members can no longer see the team sheet. Use Publish again when ready.</p>
            </div>
            <Note>
              Reverting does not delete any data — player entries and selection choices are
              preserved. It simply changes the game status.
            </Note>
          </HelpSection>

          <HelpSection title="Opposition players">
            <Body>
              A member can be recorded as playing for the opposing team by setting their status
              to <strong>Opposition</strong> on the selection page. They appear in a dedicated
              Opposition box on the published team sheet, and the game counts as{' '}
              <em>Opposition</em> in their personal stats rather than as a normal entry.
            </Body>
          </HelpSection>

          <HelpSection title="Player Stats view">
            <Body>
              The Manage page has a toggle at the top right between <strong>Games</strong> and{' '}
              <strong>Player Stats</strong>. The Player Stats view shows a sortable table of
              every player who has entries, with columns for Selected, Reserve, Reserve Team,
              Opposition, Withdrawn, Cancelled, Abandoned, Entered, and Total. Click any column
              header to sort by that column.
            </Body>
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
