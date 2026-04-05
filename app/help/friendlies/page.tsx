'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpFriendliesPage() {
  const { data: session } = useSession();
  const role = session?.user?.role ?? '';
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar userName={session?.user?.name ?? undefined} userRole={role} />
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Friendlies</h1>
          <p className="text-gray-500 text-sm mt-1">Entering games and viewing match details</p>
        </div>
        <div className="space-y-4">

          <HelpSection title="The tabs">
            <Body>
              The Friendlies page has four tabs to filter the game list:
            </Body>
            <Body>
              <strong>All Games</strong> — every game in the list regardless of status.
            </Body>
            <Body>
              <strong>Open for Entry</strong> — only games currently accepting entries. This is the
              default view.
            </Body>
            <Body>
              <strong>My Entries</strong> — games you have entered that have not yet been played or
              cancelled. This includes games that are open, selecting, or selected.
            </Body>
            <Body>
              <strong>My Played</strong> — games you entered that have been played, cancelled, or
              abandoned.
            </Body>
          </HelpSection>

          <HelpSection title="When games open">
            <Body>
              The Captain opens games for entry a few weeks before the play date — at the same time
              the card goes up on the noticeboard in the clubhouse. The game will show an{' '}
              <strong>Open</strong> badge (green) when it is accepting entries.
            </Body>
            <Body>
              When the card comes down from the noticeboard and the Captain begins selecting the
              team, the game is marked as <strong>Selecting</strong> (yellow). At this point entries
              are closed and no further changes can be made.
            </Body>
          </HelpSection>

          <HelpSection title="Entering a game">
            <Step n={1}>
              Go to <strong>Friendlies</strong> and make sure you are on the{' '}
              <strong>Open for Entry</strong> tab.
            </Step>
            <Step n={2}>
              Find the game you want to enter and tick the checkbox on the game card.
            </Step>
            <Step n={3}>
              Tick or untick as many games as you like. A green <strong>Update X Games</strong>{' '}
              button will appear at the bottom of the screen showing how many changes are pending.
            </Step>
            <Step n={4}>
              Tap the green <strong>Update X Games</strong> button to save your entries. Your
              changes are not saved until you tap this button — ticking or unticking a checkbox alone
              does nothing until you tap the button.
            </Step>
            <Note>
              To remove yourself from an Open game, untick the checkbox and tap{' '}
              <strong>Update X Games</strong>. Your name will be removed from the entry list
              immediately. You can only do this while the game is still Open.
            </Note>
          </HelpSection>

          <HelpSection title="Viewing who has entered">
            <Body>
              On any Open game card, tap the <strong>View / Add</strong> button to see a list of
              all members who have entered that game.
            </Body>
          </HelpSection>

          <HelpSection title="Entering another member">
            <Step n={1}>
              Tap <strong>View / Add</strong> on the game card to open the players panel.
            </Step>
            <Step n={2}>
              Tap the green <strong>Add Players</strong> button to open the search.
            </Step>
            <Step n={3}>
              Search for a member by name and select them. They are added to a list below the
              search — you can search and add more members one by one before submitting.
            </Step>
            <Step n={4}>
              Once you have selected everyone, tap the blue <strong>Add X Players</strong> button
              to enter them all at once.
            </Step>
          </HelpSection>

          <HelpSection title="Team sheet">
            <Body>
              Once the Captain has selected the team and published the game, you will be able to see
              who has been selected to play. Your name will be highlighted if you are in the team.
              Use the <strong>My Entries</strong> tab to quickly find your upcoming games.
            </Body>
            <Body>
              Tap <strong>View Details</strong> on a selected game card to open the full team sheet.
            </Body>
          </HelpSection>

          <HelpSection title="Confirming and withdrawing once selected">
            <Body>
              Once the team has been published, open the game details and you will see two options:
            </Body>
            <Body>
              <strong>Confirm</strong> — tap this to confirm you are able to play. This lets the
              Captain know the team is set.
            </Body>
            <Body>
              <strong>Withdraw</strong> — if you can no longer play after being selected, tap
              Withdraw. Your name will be marked as withdrawn and an email will be sent to the
              captains so they can rearrange the team. This is different from simply unticking an
              Open game — withdrawing after selection always notifies the captains.
            </Body>
          </HelpSection>

          <HelpSection title="Tea rota">
            <Body>
              The tea rota for each home game is shown on the game detail page. It lists the members
              assigned to do teas. The rota is also emailed to those members when the game is
              published.
            </Body>
          </HelpSection>

          <HelpSection title="Results">
            <Body>
              After a game, the result is recorded by the Captain. You can view the final score on
              the game card and on the game detail page.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
