'use client';
import Link from 'next/link';
import { LastUpdated, HelpSection, Step, Body, Note, Tip, BackLink } from '../_components';

export default function HelpAccountPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <BackLink href="/help" label="Help" />
          <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
          <p className="text-gray-500 text-sm mt-1">Your membership card, bar account, bar PIN and membership fees</p>
          <LastUpdated date="2026-11-05" />
        </div>
        <div className="space-y-4">

          <HelpSection title="Where to find it">
            <Body>
              Tap the blue <strong>My Account</strong> button on the home page, or choose{' '}
              <strong>My Account</strong> from the account menu (your initials at the top right, or the
              bottom of the ☰ menu on a phone).
            </Body>
            <Body>
              It opens on your <strong>membership card</strong>. Underneath are four buttons, each with a
              short note of where things stand:
            </Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Bar Account</strong> — your balance and transactions.</li>
              <li><strong>Bar PIN</strong> — set or change the PIN you use at the bar.</li>
              <li><strong>Lost card</strong> — stop your old card working.</li>
              <li><strong>Membership fees</strong> — this season&apos;s fees, and paying them.</li>
            </ul>
            <Body>
              Tap a button to open it, and <strong>← My card</strong> (or your phone&apos;s back button)
              to return to the card. A button turns amber when it needs your attention — for example
              when you have membership fees to pay, or your PIN is locked.
            </Body>
          </HelpSection>

          <HelpSection title="Your membership card">
            <Body>
              The card shows your name and the date your membership is valid until. If your renewal is due, it
              says so, with a link to Renewals.
            </Body>
            <Body>
              <strong>Tap the card</strong> to turn it over and show your <strong>QR code</strong>. Show
              this at the bar to pay from or top up your bar account. Tap it again to turn it back.
            </Body>
            <Tip>
              Add the portal to your phone&apos;s home screen so your card is one tap away — see{' '}
              <Link href="/help/install" className="text-green-900 underline">Add to your home screen</Link>.
              Some members also have a printed card with the same QR code.
            </Tip>
          </HelpSection>

          <HelpSection title="Bar Account">
            <Body>
              Your bar account is money you have put on at the bar, to spend at the bar. It shows your{' '}
              <strong>current balance</strong> and every transaction — top-ups, purchases and refunds —
              with the balance after each one.
            </Body>
            <Body>
              Top up at the bar, by cash or card. Your account is opened by your first top-up, so until
              then it says you don&apos;t have one yet.
            </Body>
          </HelpSection>

          <HelpSection title="Paying at the bar">
            <Step n={1}>Tell the bar person you&apos;d like to pay from your account (or top it up).</Step>
            <Step n={2}>
              If asked, show your QR code or type your bar PIN on the till. Either proves it is really you, so
              nobody else can spend your money.
            </Step>
            <Step n={3}>Check the amount the till shows, and it&apos;s taken from your balance.</Step>
            <Note>
              If the till is offline it can&apos;t check a PIN — show your QR code instead.
            </Note>
          </HelpSection>

          <HelpSection title="Bar PIN">
            <Step n={1}>Tap <strong>Bar PIN</strong>.</Step>
            <Step n={2}>Type a new PIN of 4 to 6 digits, and the same again.</Step>
            <Step n={3}>Tap <strong>Set PIN</strong> (or <strong>Change PIN</strong>).</Step>
            <Body>
              Choose a PIN nobody could guess — not 1234, or your birthday. After 5 wrong tries at the
              bar your PIN is locked; set a new one here, or ask the bar person to scan your card and
              set a new one at the till.
            </Body>
          </HelpSection>

          <HelpSection title="Lost card">
            <Body>
              Lost your printed card, or the phone with your QR code on it? Tap <strong>Lost card</strong>,
              then <strong>Reset my card</strong> and confirm.
            </Body>
            <Body>
              Your old QR code and any printed cards stop working straight away, and your new QR code
              shows on your card. A printed card needs reprinting — ask the committee. Your PIN and your
              balance are not affected.
            </Body>
          </HelpSection>

          <HelpSection title="Membership fees">
            <Body>
              Shows this season&apos;s membership fees: whether your renewal is still a draft, the
              amount outstanding with your <strong>payment reference</strong> (tap <strong>Copy</strong>{' '}
              to copy it), or that it is paid.
            </Body>
            <Body>When you have something to pay, it shows how:</Body>
            <ul className="list-disc pl-5 space-y-1 text-sm text-gray-700 mb-3">
              <li><strong>Online by card</strong>, when the club has it switched on — tap <strong>Pay … online</strong>.</li>
              <li><strong>By bank transfer</strong>, to the account shown, using your payment reference.</li>
              <li><strong>At the bar</strong>, by card or cash.</li>
            </ul>
            <Body>
              After paying online you come back here, and it confirms once the payment is recorded.
              There&apos;s no need to pay again if it takes a minute.
            </Body>
            <Note>
              If you are someone&apos;s buddy, their fees are listed here too. Tick the members you are
              paying for to pay for them together in one online payment. See also the{' '}
              <Link href="/help/renewals" className="text-blue-900 underline">Renewals</Link> help.
            </Note>
          </HelpSection>

        </div>
      </div>
    </div>
  );
}
