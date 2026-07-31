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
              The Friendlies page groups games under three main tabs, each with its own sub-filters
              along the top:
            </Body>
            <Body>
              <strong>All Games</strong> — every game, filtered by status:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>Upcoming</strong> — not yet open for entry.</p>
              <p><strong>Open</strong> — accepting entries. This is the default view when you arrive.</p>
              <p><strong>Selecting</strong> — entries are closed and the Captain is picking the team.</p>
              <p><strong>Played</strong> — games that have been played, cancelled, or abandoned.</p>
            </div>
            <Body>
              <strong>My Games</strong> — only games you are in:
            </Body>
            <div className="mt-1 space-y-1 text-sm text-gray-700 mb-2">
              <p><strong>Not played</strong> — your upcoming games (open, selecting, or selected).</p>
              <p><strong>Played</strong> — your games that have been played, cancelled, or abandoned.</p>
            </div>
            <Body>
              <strong>My Stats</strong> — your full record across all friendlies (see below).
            </Body>
            <Note>
              The tab and sub-filter you are on are remembered. If you open a game&apos;s details and
              then go back, you return to the same view rather than the default All Games → Open.
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
              Go to <strong>Friendlies</strong>. The default <strong>All Games → Open</strong> view
              shows the games currently open for entry.
            </Step>
            <Step n={2}>
              On the game you want, tap <strong>Enter this game</strong>. A confirmation box appears
              so you enter one game at a time.
            </Step>
            <Step n={3}>
              Tap <strong>Enter this game</strong> in the box to confirm. Your entry is saved
              immediately and the card changes to <strong>Entered — tap to remove</strong>.
            </Step>
            <Note>
              To remove yourself from an Open game, tap <strong>Entered — tap to remove</strong> on
              the card and confirm. You can only do this while the game is still Open.
            </Note>
          </HelpSection>

          <HelpSection title="Entering your buddy at the same time">
            <Body>
              If you have a <strong>buddy</strong> set up, you can enter them alongside yourself in
              one step. When your buddy is eligible for that game (the right Ladies/Men category) and
              not already entered, the confirmation box shows an{' '}
              <strong>Enter {'{buddy}'} too?</strong> tick.
            </Body>
            <Body>
              Tick it before confirming to enter both of you together. Leave it unticked to enter
              only yourself. The same applies when removing — if your buddy is entered, the remove
              box offers <strong>Remove {'{buddy}'} too?</strong>.
            </Body>
            <Note>
              If your buddy is already entered, the tick simply won&apos;t appear — there is nothing
              to do.
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
              When you enter an away game, the confirmation box shows a{' '}
              <strong>Making my own way</strong> option. Tick this if you are travelling to the venue
              yourself and are not part of the car share — the Captain can see this when arranging
              lifts.
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
              Use the <strong>My Games → Not played</strong> tab to quickly find your upcoming games.
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
              captains so they can rearrange the team. This is different from simply removing yourself
              from an Open game — withdrawing after selection always notifies the captains.
            </Body>
          </HelpSection>

          <HelpSection title="Confirming for your buddy too">
            <Body>
              If your <strong>buddy</strong> is also selected for the game, the confirm button lets
              you confirm both of you at once — it reads <strong>Confirm you and {'{buddy}'}</strong>.
              Tap it to confirm yourself and your buddy in a single step. If you have already
              confirmed but your buddy hasn&apos;t, the button reads simply{' '}
              <strong>Confirm {'{buddy}'}</strong>.
            </Body>
            <Note>
              Withdrawing is personal — you can only withdraw yourself. To withdraw your buddy, use
              <strong> Switch User</strong> (top-right menu) to act as them, then withdraw.
            </Note>
          </HelpSection>

          <HelpSection title="Re-joining after withdrawing">
            <Body>
              Changed your mind, or freed up again? While the game is still published (the team has
              been selected but not yet played), open the game details and you will see a green{' '}
              <strong>Re-join</strong> button in place of Confirm and Withdraw.
            </Body>
            <Body>
              Tap <strong>Re-join</strong> to put yourself back into the game. You return to the role
              you held before (Playing or Reserve), and the captains are notified that you are
              available again so they can update the team.
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
