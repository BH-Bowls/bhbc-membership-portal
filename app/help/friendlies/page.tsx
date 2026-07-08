'use client';

import { useSession } from 'next-auth/react';
import { Navbar } from '@/components/Navbar';
import { HelpSection, Step, Note, Tip, Body, BackLink } from '../_components';

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
            <Note>
              The tab you are on is remembered. If you open a game&apos;s details and then go back,
              you will return to the same tab rather than the default Open for Entry view.
            </Note>
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
              Search for a member by name and select them. Each selected name appears as a blue chip
              below the search box — you can add more members one by one before submitting.
            </Step>
            <Step n={4}>
              Once you have selected everyone, tap the blue <strong>Add X Players</strong> button
              to enter them all at once.
            </Step>
          </HelpSection>

          <HelpSection title="Away games">
            <Body>
              Away game cards show additional travel information to help you plan:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>Pickup information</strong> — shown in italics on the card once the Captain has set it. This details where and when cars are leaving from.</p>
              <p><strong>Petrol cost</strong> — shown next to the Away badge if a reimbursement amount has been set.</p>
            </div>
            <Body>
              When you tick a checkbox to enter an away game, a <strong>Making my own way</strong> option
              appears below the checkbox. Tick this if you are travelling to the venue yourself and are
              not part of the car share — the Captain can see this when arranging lifts.
            </Body>
          </HelpSection>

          <HelpSection title="Team sheet">
            <Body>
              Once the Captain has selected the team and published the game, a{' '}
              <strong>View Details</strong> button appears on the game card. Any member can view the
              full team sheet — you do not need to have entered the game.
            </Body>
            <Body>
              You can view the full team selection and sign off your name either by visiting the
              View Details page or at the clubhouse noticeboard.
            </Body>
            <Body>
              Below the View Details button the game card shows your personal status for that game:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong className="text-green-700">You are Selected to play</strong> — you are in the main team.</p>
              <p><strong className="text-amber-700">You are a Reserve</strong> — you are on the reserve list.</p>
              <p><strong className="text-purple-700">Playing — Reserve Rink</strong> — you are in the reserve team.</p>
              <p><span className="text-gray-500">Not selected for this game</span> — you entered but were not selected.</p>
              <p><span className="text-gray-500">Not entered</span> — you did not enter this game.</p>
            </div>
            <Body>
              The team sheet also lists any <strong>Opposition players</strong> — BHBC members who
              are playing for the opposing team that day.
            </Body>
            <Body>
              Use the <strong>My Entries</strong> tab to quickly find your upcoming games.
            </Body>
          </HelpSection>

          <HelpSection title="My Stats">
            <Body>
              The <strong>My Stats</strong> tab shows a complete record of every friendly you have
              been involved in.
            </Body>
            <Body>
              The <strong>Summary</strong> sub-view shows totals for each outcome:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>Selected</strong> — you were in the main playing team.</p>
              <p><strong>Reserve</strong> — you were on the reserve list.</p>
              <p><strong>Reserve Team</strong> — you played in a reserve rink.</p>
              <p><strong>Opposition</strong> — you played for the opposing team.</p>
              <p><strong>Withdrawn</strong> — you withdrew after being selected.</p>
              <p><strong>Cancelled / Abandoned</strong> — the game did not complete.</p>
              <p><strong>Entered</strong> — you entered but the game has not yet closed.</p>
            </div>
            <Body>
              Switch to <strong>Detail</strong> to see the full per-game list, sorted most recent
              first, with the club, date, format, and your status for each game.
            </Body>
            <Note>
              Captains and Admins see a player selector at the top of the My Stats tab and can view
              the stats for any member.
            </Note>
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

          <HelpSection title="Contacting the captains">
            <Body>
              On any published game detail page, tap the <strong>Message Captains</strong> button.
              Type your message and tap <strong>Send</strong> — an email is sent immediately to all
              members with a Captain or Admin role, with your name and email address included so
              they can reply directly to you.
            </Body>
            <Body>
              Use this for anything you would normally say to a captain in person: letting them know
              you are running late, asking about travel arrangements, or anything else related to
              the game.
            </Body>
            <Note>
              The confirmation emails sent out when you enter a game or when the team is published
              come from a no-reply address — please do not reply to those emails, as replies will
              not reach the captains. Use the Message Captains button on the game page instead.
            </Note>
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
