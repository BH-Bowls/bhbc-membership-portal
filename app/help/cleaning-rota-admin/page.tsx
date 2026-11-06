'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpCleaningRotaAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Cleaning Rota Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Managing the clubhouse cleaning schedule</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="The cleaning rota">
            <Body>
              The cleaning rota lists who cleans the clubhouse on Saturday mornings (before 10:00). Each
              Saturday has up to four people: Lead, Second, Third and Fourth. All members can see it from
              Lookups → Cleaning Rota, and their own duties are highlighted.
            </Body>
            <Body>
              Committee members (Captain, Treasurer, GMC and Admin) can change who is on each Saturday.
            </Body>
          </HelpSection>

          <HelpSection title="Changing who is on a Saturday">
            <Step n={1}>Go to Lookups → Cleaning Rota.</Step>
            <Step n={2}>Tap <strong>Edit</strong>. Each name becomes a box you can search in.</Step>
            <Step n={3}>Pick a different member for any position, or clear a position to leave it empty.</Step>
            <Step n={4}>Tap <strong>Save</strong> at the top.</Step>
            <Note>
              The rota doesn&apos;t email anyone about changes, so let the members concerned know.
            </Note>
          </HelpSection>

          <HelpSection title="Members swapping their own duties">
            <Body>
              Members don&apos;t need the committee to swap. Next to their own name they can tap{' '}
              <strong>Swap</strong> and choose another member. If that member has a duty of their own,
              the two are exchanged (when they have more than one, the member picks which). If they
              have none, they simply take over the duty.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
