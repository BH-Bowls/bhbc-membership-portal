'use client';
import { LastUpdated, HelpSection, Step, Body, BackLink } from '../_components';

export default function HelpInviteGamesPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Invite Games</h1>
          <p className="text-gray-500 text-sm mt-1">Open competitions at neighbouring clubs that members can enter</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="What are invite games?">
            <Body>
              Invite games are invitations the club has received from neighbouring clubs to a competition
              they are running, which any of our members is welcome to enter — put a team together and
              enter it with the other club directly. Each one has a title, a description, the date of the
              competition and the closing date for entries, plus any documents such as the invitation or
              entry form.
            </Body>
            <Body>
              Only open competitions are listed here. Invitations for the club to enter one team are
              handled by the committee and aren&apos;t published.
            </Body>
            <Body>
              Every member can see them under <strong>Invite Games</strong> in the menu. Committee members
              add and manage them.
            </Body>
          </HelpSection>

          <HelpSection title="Adding an invite game">
            <Step n={1}>Go to <strong>Invite Games</strong> and tap <strong>Add Game</strong>.</Step>
            <Step n={2}>Enter the title (required), a description (how to enter, who to contact, format, cost), the date of the competition and the closing date for entries. Only add open competitions that any member can enter.</Step>
            <Step n={3}>Tap <strong>Create Game</strong>.</Step>
          </HelpSection>

          <HelpSection title="Attaching documents">
            <Step n={1}>Open the invite game.</Step>
            <Step n={2}>Upload files in the <strong>Attachments</strong> section — for example the invitation or an entry form.</Step>
            <Step n={3}>Members can open or download them from the game&apos;s page.</Step>
          </HelpSection>

          <HelpSection title="Editing or deleting">
            <Body>
              Open an invite game to change its details, then <strong>Save</strong>. Use{' '}
              <strong>Delete</strong> to remove one that is no longer needed — the game and its attachments
              are removed permanently.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
