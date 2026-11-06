'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Note, Body, BackLink } from '../_components';

export default function HelpBankingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Banking &amp; the Treasurer&apos;s tools</h1>
          <p className="text-gray-500 text-sm mt-1">Matching renewal payments, the bar&apos;s cash, member accounts and Xero</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Overview">
            <Body>
              These tools are in the <strong>Admin</strong> menu, under <strong>Club</strong>, for the
              Treasurer and Admin:
            </Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Banking</strong> — matching bank payments to members&apos; renewals.</li>
              <li><strong>Bar Reconciliation</strong> — confirming the bar&apos;s Day Ends and banking the cash.</li>
              <li><strong>Renewals → Xero</strong> — exporting the renewals journals, and checks and adjustments.</li>
              <li><strong>Member Accounts</strong> — the members&apos; bar account balances and transactions.</li>
              <li><strong>Data Checks</strong> — cross-checks that the figures agree.</li>
            </ul>
            <Note>
              Renewals paid online or at the bar are recorded on the renewal straight away. Only bank
              transfers, cheques and other payments need matching in Banking.
            </Note>
          </HelpSection>

          <HelpSection title="Getting payments into Banking">
            <Body>Either import them from the bank, or type them in:</Body>
            <Step n={1}>
              <strong>Import CSV</strong> — export a CSV from online banking with the columns Date,
              Type, Description and Amount. Tap <strong>Import CSV</strong> to see the exact layout,
              then choose the file. Types are TRF (bank transfer), CDM (card machine), CHQ (cheque) and
              CSH (cash).
            </Step>
            <Step n={2}>
              <strong>+ Add Payments</strong> — enter several payments by hand, for example cheques or
              cash paid in.
            </Step>
          </HelpSection>

          <HelpSection title="Matching payments to renewals">
            <Body>
              The Banking page shows <strong>Renewals (Outstanding)</strong> on one side and{' '}
              <strong>Payments (Unmatched)</strong> on the other. Banking matches what it can on its own
              when the amounts agree.
            </Body>
            <Step n={1}>Tick the payment, then tick the renewal (or renewals) it pays for.</Step>
            <Step n={2}>
              When the totals agree, they are matched straight away. If the payment is more than the
              renewals ticked so far, keep ticking. If it is short, the <strong>Manual Match</strong>{' '}
              dialog opens: record any donation or difference, and a note. You can also tap a ticked
              renewal to open Manual Match yourself.
            </Step>
            <Step n={3}>Tap <strong>Update</strong> to save the matches.</Step>
            <Body>
              A payment for several members at once (e.g. &quot;A &amp; B SMITH SUBS&quot;) can be matched
              to several renewals. Tap a payment to amend or delete it.
            </Body>
            <Note>
              The member&apos;s payment reference (shown on their renewal and in My Account) makes
              payments much easier to match — encourage members to use it.
            </Note>
          </HelpSection>

          <HelpSection title="Banking report">
            <Body>
              <strong>Report</strong> (on the Banking page) shows which subscriptions are paid and
              unpaid, and which payments are allocated and unallocated.
            </Body>
          </HelpSection>

          <HelpSection title="Bar Reconciliation">
            <Step n={1}>
              Each bar Day End waits here for you to <strong>confirm</strong> it — check it, and correct
              it if needed.
            </Step>
            <Step n={2}>
              Once confirmed, a Day End can be exported to Xero on its own, and added to a{' '}
              <strong>Banking</strong> — several Day Ends&apos; cash paid in together, matching the
              paying-in slip.
            </Step>
            <Step n={3}>
              <strong>+ Non-Till Cash</strong> records money that never went through the till, such as
              a raffle or teas, so it can be banked with the rest.
            </Step>
          </HelpSection>

          <HelpSection title="Renewals → Xero">
            <Body>Four tabs:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>Export</strong> — everything about renewals not yet in Xero, as one journal per
                day (totals by account, no names). Export downloads the CSV for Xero and marks it
                exported. Earlier exports can be downloaded again.
              </li>
              <li>
                <strong>Checks</strong> — what Membership debtors and the transfers clearing account
                should be at a date, to compare with Xero.
              </li>
              <li>
                <strong>Adjustments</strong> — a member&apos;s renewal account, and extra charges,
                credits and refunds.
              </li>
              <li><strong>Settings</strong> — the Xero account codes, tax rate and first season.</li>
            </ul>
          </HelpSection>

          <HelpSection title="Member Accounts">
            <Body>
              Every member&apos;s bar account for a date range: opening balance, top-ups, spending,
              refunds, adjustments and closing balance, plus the balance now. Tap a member to see
              their transactions. Both can be exported to CSV.
            </Body>
          </HelpSection>

          <HelpSection title="Data Checks">
            <Body>
              Runs read-only checks that figures which should always agree do agree — bar account
              balances against their transactions, Day End totals against the sales, renewal fees and
              payments, card payments, Xero exports and the 200 Club. Problems are listed as errors,
              warnings or information, with a link to each. Running it changes nothing.
            </Body>
            <Body>
              For how the bar till itself works, see the{' '}
              <Link href="/help/bar" className="text-blue-600 hover:text-blue-800">Bar till</Link> help.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
