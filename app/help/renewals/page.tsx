'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, Tip, BackLink } from '../_components';

export default function HelpRenewalsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">Renewals</h1>
          <p className="text-gray-500 text-sm mt-1">Renewing your membership, and paying for it</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              Open the account menu (your initials at the top right, or the bottom of the ☰ menu on a
              phone) and choose <strong>Renewals</strong>. The page is for the coming season once the
              committee has opened renewals.
            </Body>
          </HelpSection>

          <HelpSection title="Filling in your renewal">
            <Step n={1}>Tap <strong>Start Renewal</strong> (or <strong>Continue Renewal</strong> if you have saved a draft).</Step>
            <Step n={2}>
              Say whether you are renewing. If you are, check your age group and membership type —
              they set your membership fee.
            </Step>
            <Step n={3}>
              Answer whether you want a printed membership book (you must — see below), then choose
              any 200 Club entries and the club competitions you want to enter (there is a small fee
              for each).
            </Step>
            <Step n={4}>The fee summary shows what you will pay as you go.</Step>
          </HelpSection>

          <HelpSection title="Printed membership book — you must answer">
            <Body>
              Every renewing member must say whether they want a printed membership book (it contains
              contact names and the fixtures). Choose Yes or No — you can&apos;t submit your renewal
              until you have.
            </Body>
            <Body>
              Your answer is remembered, so next year it is already filled in. Just check it is still
              right.
            </Body>
          </HelpSection>

          <HelpSection title="Save Draft, then Submit">
            <Body>
              <strong>Save Draft</strong> keeps your choices without sending them. You can come back
              and change a draft as often as you like.
            </Body>
            <Body>
              When you are happy, tap <strong>Submit Renewal</strong>. Once submitted your renewal is
              locked — it can&apos;t be changed, by you or anyone else. If something is wrong after
              submitting, contact the Treasurer.
            </Body>
            <Note>Please don&apos;t pay until you have submitted.</Note>
          </HelpSection>

          <HelpSection title="Not renewing">
            <Body>
              If you are not renewing, choose No and tap <strong>Save</strong>. That tells the club
              straight away. If you change your mind, open Renewals again and tap{' '}
              <strong>Reopen renewal</strong>.
            </Body>
          </HelpSection>

          <HelpSection title="200 Club numbers">
            <Body>
              When you add 200 Club entries you can pick your numbers from a grid — numbers already
              taken are crossed out. Tap a number to pick it, and tap again to change your mind. Any
              entries you don&apos;t pick a number for are given one by the 200 Club organiser.
            </Body>
            <Note>Numbers are only yours once the renewal is submitted, so submit soon after choosing.</Note>
          </HelpSection>

          <HelpSection title="How to pay">
            <Body>After you submit, your renewal shows the amount due and your own payment reference. You can pay:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li>
                <strong>Online by card</strong>, when the club has it switched on — tap <strong>Pay online by card</strong>. You can also
                choose <strong>Submit and pay online</strong> to submit and pay in one go.
              </li>
              <li>
                <strong>By bank transfer</strong> — to the account shown, using <strong>your payment
                reference</strong> so the Treasurer can match it to you.
              </li>
              <li><strong>At the bar</strong>, by card or cash — the full amount.</li>
            </ul>
            <Body>
              Online and bar payments show as paid straight away. A bank transfer shows once the
              Treasurer has matched it, which can take a few days. You get a confirmation email when
              you submit, and Stripe emails a receipt for online payments.
            </Body>
            <Tip>
              Your fees, reference and payment options are also in{' '}
              <Link href="/account?section=fees" className="text-green-900 underline">My Account → Membership fees</Link>.
            </Tip>
          </HelpSection>

          <HelpSection title="If an online payment is left unfinished">
            <Body>
              If you chose <strong>Submit and pay online</strong> but left the payment page without
              paying, your renewal is held while the payment is open. Open Renewals and tap{' '}
              <strong>Cancel the online payment</strong> to carry on. Nothing is taken unless the
              payment is completed.
            </Body>
          </HelpSection>

          <HelpSection title="Renewing for someone else (buddies)">
            <Body>
              If you are someone&apos;s buddy, use <strong>Switch User</strong> in the account menu to
              open their Renewals and fill it in for them. In <strong>My Account → Membership
              fees</strong> you see the fees for everyone you look after, and can pay online for
              several of them in one payment — tick the members you are paying for. For a bank
              transfer, use each member&apos;s own reference.
            </Body>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
