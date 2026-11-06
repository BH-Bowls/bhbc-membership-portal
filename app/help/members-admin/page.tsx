'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, BackLink } from '../_components';

export default function HelpMembersAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Members Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Applications, member records, and leavers</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              <strong>Admin → Members → Members</strong> (Admin only) opens Member Management, with three
              cards — <strong>Applications</strong>, <strong>Members</strong> and <strong>Leavers</strong> —
              each showing how many need attention.
            </Body>
          </HelpSection>

          <HelpSection title="Applications">
            <Body>
              New applications come from the online form (see{' '}
              <Link href="/help/apply" className="text-blue-600 hover:text-blue-800">Applying for membership</Link>).
              They are listed by stage, and each stage has its own action:
            </Body>
            <Step n={1}>
              <strong>Action Required</strong> — a new application: tap <strong>Set Listed Date</strong> once
              the name has been put up for members. The <strong>14-day objection period</strong> runs from
              that date.
            </Step>
            <Step n={2}>
              <strong>Pending</strong> — the application waits here until the objection deadline passes, then
              comes back to Action Required.
            </Step>
            <Step n={3}>
              <strong>Approve</strong> it — check the fee (adjust it for any part-season reduction) and add any
              notes; the applicant is emailed the fee to pay. Or <strong>Decline</strong> it, with a reason.
            </Step>
            <Step n={4}>
              <strong>Approved</strong> — waiting for payment. When the fee arrives, tap{' '}
              <strong>Mark as Paid</strong> and enter the amount, method (bank transfer, card, cash or
              cheque) and date. If the payment email didn&apos;t arrive, use{' '}
              <strong>Resend Payment Email</strong>.
            </Step>
            <Step n={5}>
              <strong>Paid</strong> — tap <strong>Convert to Member</strong>. They become a member, with a
              username and password, and are emailed a welcome with their login details.
            </Step>
            <Note>Converted and declined applications stay listed at the bottom for reference.</Note>
          </HelpSection>

          <HelpSection title="Members">
            <Body>
              The <strong>Members</strong> card lists every active member. Search by name, then:
            </Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>Edit</strong> — change any of their details (not their username), including their
                roles and <strong>Include in Mailings</strong>. Their record also has their bar card: reset
                it, clear their PIN, or restore a card they have found.
              </li>
              <li>
                <strong>Add Member</strong> — create a member by hand, without an application. You are
                shown their new username and temporary password, and told whether the welcome email was
                sent.
              </li>
              <li>
                <strong>Include in Mailings</strong> — set who is included in member emails and the
                &quot;Include in Mailings only&quot; labels, for many members at once. Filter the list (e.g.
                Playing Lady), tick or untick, then save.
              </li>
              <li><strong>Archive</strong> — when a member leaves (see below).</li>
            </ul>
          </HelpSection>

          <HelpSection title="Archiving a member who has left">
            <Step n={1}>Find them in Members and tap <strong>Archive</strong>.</Step>
            <Step n={2}>Choose the reason — Lapsed, Resigned or Deceased — the date they left, and any notes.</Step>
            <Step n={3}>Confirm.</Step>
            <Body>
              They move to <strong>Leavers</strong>. They can no longer log in, they drop off member lists,
              and their roles (Captain, GMC and so on) are removed. Nothing is deleted, and no email is
              sent.
            </Body>
            <Note>
              Before archiving, check whether they still have money on their bar account (refund it at the
              bar) or a locker (their locker stays in the Locker Register marked &quot;Leaver&quot; until you
              change it).
            </Note>
          </HelpSection>

          <HelpSection title="Leavers">
            <Body>
              The <strong>Leavers</strong> card lists past members. <strong>View</strong> shows their details
              read-only. <strong>Reinstate</strong> brings them back as an active member — as a plain
              member, so add back any roles they need by editing their record.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
