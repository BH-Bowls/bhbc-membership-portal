'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpMemberSuggestionsAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Member Suggestions</h1>
          <p className="text-gray-500 text-sm mt-1">Reviewing and managing improvement suggestions</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="How it works">
            <Body>
              Suggestions for improving the club are recorded here. GMC members review them, decide whether
              to take them on, and can assign a coordinator to see them through. Members see their own
              suggestions plus any accepted projects.
            </Body>
            <Note>
              The members&apos; Suggestions menu is switched off at the moment, until the committee is ready
              to open it. GMC and Admin can still use <strong>Admin → Member Suggestions</strong>.
            </Note>
          </HelpSection>

          <HelpSection title="Reviewing suggestions">
            <Step n={1}>Go to <strong>Admin → Member Suggestions</strong>.</Step>
            <Step n={2}>
              Use the tabs to filter: <strong>All</strong>, <strong>New</strong> (not accepted yet),{' '}
              <strong>Ongoing</strong> (accepted and under way), <strong>Review</strong> (past its review
              date), <strong>Complete</strong>, <strong>Cancelled</strong> and <strong>On Hold</strong>.
            </Step>
            <Step n={3}>Tap a suggestion to open the full details.</Step>
          </HelpSection>

          <HelpSection title="Deciding on a suggestion">
            <Step n={1}>Open the suggestion.</Step>
            <Step n={2}>
              Tick <strong>Committee Accepted</strong> if the committee takes it on, and give the{' '}
              <strong>Committee Acceptance Reason</strong>.
            </Step>
            <Step n={3}>
              Set the category and priority, and record the <strong>Decision</strong> (Approved, Not
              Approved or Deferred) with the reason.
            </Step>
            <Step n={4}>Accepted suggestions become visible to members as ongoing projects.</Step>
          </HelpSection>

          <HelpSection title="Running a project">
            <Body>
              An accepted suggestion can have a <strong>Project Coordinator</strong> — the member
              responsible for seeing it through. The suggestion also records the estimated cost, funding
              source and cost quotes, a target completion date and review date, progress notes, and finally
              the outcome and date completed. The coordinator can update the progress from their own view
              of it.
            </Body>
          </HelpSection>

          <HelpSection title="Committee-only suggestions">
            <Body>
              When a GMC member submits a suggestion, it is automatically marked{' '}
              <strong>Committee Only</strong> and hidden from members until it is accepted. You can also
              change this on any suggestion.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
