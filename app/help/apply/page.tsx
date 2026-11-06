'use client';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpApplyPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Applying for Membership</h1>
          <p className="text-gray-500 text-sm mt-1">How someone new joins the club, and what happens to their application</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="The application form">
            <Body>
              Anyone can apply online, without logging in, using the membership application form at{' '}
              <strong>/apply</strong> on the portal. If
              someone asks you how to join, point them to it.
            </Body>
            <Body>The form asks for:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>Personal details</strong> — first and last name, the name they like to be known
                by, and gender.
              </li>
              <li><strong>Contact details</strong> — email and mobile (both required), landline, and address.</li>
              <li>
                <strong>Membership details</strong> — their age group, and whether they want to be a{' '}
                <strong>Playing</strong> or <strong>Social</strong> member. Under 18s also give their date
                of birth, and 18–24s say whether they are in full-time education (both affect the fee).
              </li>
              <li>
                <strong>Additional information</strong> (optional) — previous bowling experience, any
                disabilities or accessibility needs, their proposer and seconder (existing members), and
                anything else they would like to say.
              </li>
            </ul>
            <Body>
              When they submit, they see &quot;Application Submitted&quot; and are sent a confirmation
              email.
            </Body>
          </HelpSection>

          <HelpSection title="What happens next">
            <Step n={1}>The committee receives the application.</Step>
            <Step n={2}>
              The applicant&apos;s name is put up for members to see, and there is a{' '}
              <strong>14-day objection period</strong>.
            </Step>
            <Step n={3}>Once that has passed, the committee approves (or declines) the application.</Step>
            <Step n={4}>
              On approval the applicant is emailed the fee to pay. Once it is paid, they are made a member and emailed
              their login details for the portal.
            </Step>
            <Note>
              Applications are handled by the Admin in <strong>Admin → Members → Applications</strong>,
              which lists them by stage: waiting for action, in the objection period, awaiting payment,
              ready to make a member, made a member, and declined.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
