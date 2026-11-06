'use client';

// src/components/BarHelp.tsx
// Help for bar staff using the till (app/bar/page.tsx). Each topic is a few short bullet
// points, with "More…" for the fuller explanation and links to related topics.
//
// Used twice, from the same text so they can't drift apart:
//  - BarHelpPanel: opened from the till's Help button and the "?" links in its dialogs.
//    It stays inside /bar (a Bar login can't open other pages, and the till may be
//    offline or in a kiosk app), so links move between topics within the panel.
//  - BarHelpPage: every topic on one page, at /help/bar, for the committee and whoever
//    trains bar staff.

import { createContext, useContext, useState } from 'react';

export type BarHelpTopicId =
  | 'start' | 'servers' | 'members' | 'baskets' | 'paying' | 'proof' | 'staffproof' | 'pins' | 'terminal'
  | 'topup' | 'membership' | 'mistakes' | 'cashmovement' | 'dayend' | 'products' | 'offline' | 'problems';

interface Topic {
  id: BarHelpTopicId;
  title: string;
  summary: string;               // one line, for the list of topics
  points: React.ReactNode[];
  more?: React.ReactNode;
  related?: BarHelpTopicId[];
}

// How a link to another topic behaves: switch topic in the panel, jump to it on the page
const GoTo = createContext<(id: BarHelpTopicId) => void>(() => {});

function TopicLink({ to, children }: { to: BarHelpTopicId; children: React.ReactNode }) {
  const go = useContext(GoTo);
  return (
    <button type="button" onClick={() => go(to)} className="text-blue-700 underline">
      {children}
    </button>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-700 leading-relaxed mb-2 last:mb-0">{children}</p>;
}

const TOPICS: Topic[] = [
  {
    id: 'start',
    title: 'Starting the till',
    summary: 'Logging in, and choosing who’s serving.',
    points: [
      'Enter the till PIN to log in. A new tablet has to be approved by an admin first — it shows a pairing code to give them.',
      'The till then asks who’s serving. Tap your name.',
      'Choosing who’s serving keeps your Cash/Card basket separate from everyone else’s, so a half-finished order is saved under your name.',
      'Choosing who’s serving also helps track certain actions like Day End or voiding sales.',
      'Your name shows at the top (“Serving: …”). Tap Change when someone else takes over.',
    ],
    more: (
      <>
        <P>
          The till remembers who has served during this session, so changing back to someone is one tap. See{' '}
          <TopicLink to="servers">Switching between servers</TopicLink>.
        </P>
        <P>
          Logout (on the Home screen) asks for confirmation, because it clears who’s serving and any held orders. The
          till also logs itself out after 4 hours with nothing happening, or after 24 hours.
        </P>
      </>
    ),
    related: ['servers', 'baskets'],
  },
  {
    id: 'servers',
    title: 'Switching between servers',
    summary: 'Two or more people serving, each keeping their own basket.',
    points: [
      'Tap “Serving: … Change” at the top and pick who’s serving now.',
      'People who have served this session are big buttons. “+ Someone else” shows everyone else.',
      'Switching while on a Cash/Card basket saves it under the person who was serving, and brings up the new person’s own basket.',
      'You can switch back and forth as often as you like — each person’s Cash/Card basket waits for them.',
      'An amber dot next to a name means that person has a Cash/Card order waiting.',
    ],
    more: (
      <>
        <P>
          Member baskets are saved under the member, not the server, so anyone serving can pick up a member’s order
          from the member list. See <TopicLink to="baskets">Baskets and held orders</TopicLink>.
        </P>
        <P>
          On Day End and Cash Movement, who’s serving is fixed once that person has confirmed with their card or PIN.
          To change it, go back to Home first.
        </P>
      </>
    ),
    related: ['start', 'baskets'],
  },
  {
    id: 'members',
    title: 'Finding a member',
    summary: 'Searching, scanning a membership card, and visitors.',
    points: [
      'Type part of the name in “Search members…”, or tap Scan and hold their membership card QR code up to the camera.',
      'With a plug-in scanner, just scan the card — no need to tap anything.',
      'The coloured edge shows the account: green has money on it, red is £2 or less, grey has no account yet.',
      'For visitors and anyone paying without a member account, tap Cash / Card.',
    ],
    more: (
      <>
        <P>
          Members find their card in the portal under My Account. They can show it on their phone, or use a printed
          one.
        </P>
        <P>
          Scanning the card also counts as their proof for paying from their account, so they won’t be asked again
          while their basket is open. See <TopicLink to="proof">Card or PIN</TopicLink>.
        </P>
        <P>
          A member with no account yet can still buy by card. Their account is opened by their first{' '}
          <TopicLink to="topup">Top Up</TopicLink>.
        </P>
      </>
    ),
    related: ['proof', 'baskets'],
  },
  {
    id: 'baskets',
    title: 'Baskets and held orders',
    summary: 'Adding items, and leaving an order to come back to.',
    points: [
      'Pick a category along the top, then tap items to add them. Use − and + to change the quantity.',
      'Members get their member price automatically — the discount is shown in the basket.',
      'To serve someone else in the middle of an order, tap ← Back. The order is held, and an amber dot shows on that member (or on Cash / Card).',
      'Open the same member or Cash / Card tab again to carry on where you left off.',
      'Held orders survive a refresh of the till, but are cleared when the till is logged out.',
    ],
    more: (
      <>
        <P>
          Cash / Card orders are held under whoever’s serving, so two people can each have one on the go. See{' '}
          <TopicLink to="servers">Switching between servers</TopicLink>.
        </P>
      </>
    ),
    related: ['servers', 'paying'],
  },
  {
    id: 'paying',
    title: 'Taking payment',
    summary: 'Pay by Account, card and cash.',
    points: [
      'Pay by Account (members): takes it from their bar account. The till shows the balance before and after — tap Pay to confirm.',
      'The member may need to scan their card or enter their PIN first. See Card or PIN.',
      'Pay by Card: the amount is sent to the Square Terminal for them to tap or insert their card.',
      'Pay by Cash (visitors): confirm the cash was taken. Tap the note they gave you to see the change.',
      'Pressed Cash by mistake? Tap “Cancel — not cash” and choose again.',
    ],
    more: (
      <>
        <P>
          Pay by Account is greyed out when the account doesn’t have enough on it. Do a{' '}
          <TopicLink to="topup">Top Up</TopicLink> first, then pay.
        </P>
        <P>
          The card or PIN step is explained in <TopicLink to="proof">Card or PIN</TopicLink>. Card payments are
          explained in <TopicLink to="terminal">Card payments on the Terminal</TopicLink>.
        </P>
        <P>After a sale the till goes back to the member list, ready for the next customer.</P>
      </>
    ),
    related: ['proof', 'terminal', 'topup'],
  },
  {
    id: 'proof',
    title: 'Card or PIN',
    summary: 'When a member — or you — is asked to prove it’s them.',
    points: [
      'Paying from or topping up an account can ask the member to scan their membership card or enter their bar PIN.',
      'Scan with the camera button, a plug-in scanner, or let them type their PIN on the keypad (4 to 6 digits, then OK).',
      'No card and no PIN? The person serving can approve it with their own card or PIN. It’s recorded against them and shown on the Sales list.',
      <>Day End, Cash Movement, Void and Refund ask the person serving for their own card or PIN — see <TopicLink to="staffproof">Your own card or PIN</TopicLink>.</>,
      'When the till is offline, only a card scan works — PINs need a connection.',
    ],
    more: (
      <>
        <P>
          Once a member has proved it’s them, it lasts while their basket is open. “✓ Card scanned” or “✓ PIN entered”
          shows in the basket.
        </P>
        <P>
          After 5 wrong PIN tries the PIN is locked. Scan their card instead, then set a new PIN. See{' '}
          <TopicLink to="pins">Setting a member’s PIN</TopicLink>.
        </P>
        <P>
          “That card has been replaced” means the member has reset their card. They need the new one from My Account,
          or their PIN. “Old-style card” means it’s a card from before PINs — it finds the member, but doesn’t count
          as proof.
        </P>
        <P>Whether these checks are switched on is a committee setting, so you may not always be asked.</P>
      </>
    ),
    related: ['staffproof', 'pins', 'problems'],
  },
  {
    id: 'staffproof',
    title: 'Your own card or PIN (bar staff)',
    summary: 'When the person serving has to scan their own card or enter their PIN.',
    points: [
      'You’re asked for your own card or PIN when you start a Day End, a Cash Movement, a Void or a cash Refund.',
      'You’re also asked when you approve Pay by Account or a Top Up for a member who has no card or PIN — tap “No card or PIN? … can approve it”.',
      'It must be the person shown as serving. If someone else is doing it, tap Cancel, change who’s serving, then start again.',
      'Once you’ve confirmed, who’s serving can’t be changed on that screen. Go back to Home to change it.',
      'Get ready before your first shift: set your PIN in My Account (Bar PIN), or have your membership card on your phone.',
    ],
    more: (
      <>
        <P>
          These are the things that move money without a customer paying, so each one is recorded against you.
          Approvals for members show on the Sales list as “approved by server (no card/PIN)”.
        </P>
        <P>
          You can also set your PIN at the till: find yourself on the member list, scan your own card, then tap Set
          PIN. See <TopicLink to="pins">Setting a member’s PIN</TopicLink>.
        </P>
        <P>
          Locked out after 5 wrong tries? Scan your card instead, then set a new PIN. When the till is offline only a
          card scan works, though Day End, Cash Movement, Void and Refund need a connection anyway.
        </P>
        <P>Whether you’re asked is a committee setting, so you may not be asked every time.</P>
      </>
    ),
    related: ['proof', 'pins', 'servers'],
  },
  {
    id: 'pins',
    title: 'Setting a member’s PIN',
    summary: 'Setting or changing a bar PIN, at the till or in My Account.',
    points: [
      'Scan the member’s card first. “Set PIN” (or “Change PIN”) then appears next to “✓ Card scanned” in their basket.',
      'Tap it and hand the tablet to the member. They enter a new PIN of 4 to 6 digits, then the same again.',
      'Members can also set or change their PIN themselves in the portal: My Account, then Bar PIN.',
      'Forgotten or locked PIN? Scan their card and set a new one.',
      'Setting a PIN needs a connection.',
    ],
    more: (
      <>
        <P>
          The card scan is what proves it’s really them, which is why “Set PIN” only appears after a scan — not after
          typing a PIN or a server approval.
        </P>
        <P>
          Lost card? The member can reset it in My Account (Lost card), which stops the old one working and gives them a new QR
          code. An admin can also reset a card, or clear a PIN, from the member’s record in Admin.
        </P>
        <P>
          With a plug-in number keypad facing the member, they can type their PIN on that, so you don’t see it.
        </P>
      </>
    ),
    related: ['proof', 'members'],
  },
  {
    id: 'terminal',
    title: 'Card payments on the Terminal',
    summary: 'Sending a payment to the Square Terminal, and what to do if it doesn’t work.',
    points: [
      'The till sends the amount to the Square Terminal and waits. The customer taps or inserts their card.',
      'When it’s paid, the till shows a green tick. Tap OK.',
      'Customer changed their mind? Tap Cancel — nothing is taken.',
      '“Hasn’t picked this up yet”: check the Terminal is on, awake and on the Wi-Fi, or press Cancel.',
      'Only use “Taken on the Terminal’s keypad instead…” if you really did key the amount into the Terminal yourself.',
    ],
    more: (
      <>
        <P>Square gives up on a payment by itself after 5 minutes if the Terminal doesn’t pick it up.</P>
        <P>
          If the till says the card was paid but there was a problem recording it, don’t take the payment again — it’s
          listed for the committee to sort out.
        </P>
        <P>
          When the till is offline it can’t reach the Terminal. Key the amount into the Terminal yourself, take the
          card, and only confirm on the till once the Terminal says approved. See{' '}
          <TopicLink to="offline">When the till is offline</TopicLink>.
        </P>
      </>
    ),
    related: ['paying', 'offline'],
  },
  {
    id: 'topup',
    title: 'Top Up and cash refunds',
    summary: 'Putting money on a member’s account, or giving it back.',
    points: [
      'Open the member, then tap Top Up. They may need their card or PIN.',
      'Type the amount, or tap +£10, +£20, +£50. Choose Cash or Card, then Add.',
      'Cash: put it in the till. Card: it’s sent to the Terminal.',
      'You go back to their basket with the new balance, ready to pay.',
      '“Refund cash…” in a member’s basket gives money from their account back in cash. You confirm with your card or PIN, and it needs a connection.',
    ],
    more: (
      <>
        <P>
          A member’s first Top Up opens their account. Members can see every top-up and purchase in My Account, under Bar Account.
        </P>
        <P>
          Top-ups made while offline are saved and sent when the connection is back. See{' '}
          <TopicLink to="offline">When the till is offline</TopicLink>.
        </P>
      </>
    ),
    related: ['paying', 'proof'],
  },
  {
    id: 'membership',
    title: 'Membership fees',
    summary: 'Taking a member’s renewal payment at the bar.',
    points: [
      'On Home, tap Membership Fees. It needs a connection.',
      'Search for the member. Only members who have submitted their renewal and still owe something are listed.',
      'The full amount due is shown. Part payments go through the Treasurer, not the till.',
      'Card: tap Send to Terminal. Cash: take it, tick “cash received and put in the till”, then Record payment.',
      'It shows as paid on their renewal straight away.',
    ],
    more: (
      <>
        <P>
          Member not listed? Their renewal may not be submitted yet, or it’s already paid. Ask them to check their
          renewal in the portal.
        </P>
        <P>
          Cash for membership fees goes in the till and is included in the Day End’s expected cash, shown on its own
          line. It goes into the renewals accounts, not the bar’s.
        </P>
        <P>
          If you took the card payment on the Terminal’s keypad yourself, use “Taken on the Terminal’s keypad
          instead…” and tick the box to confirm.
        </P>
      </>
    ),
    related: ['terminal', 'dayend'],
  },
  {
    id: 'mistakes',
    title: 'Mistakes: voiding a sale',
    summary: 'Cancelling a sale that was wrong.',
    points: [
      'On Home, tap Sales. Tap a sale to see what was in it.',
      'Tap Void and confirm with your card or PIN. The till tells you what happens to the money first.',
      'Paid from an account: the money goes back on it. Card through the Terminal: refunded to their card.',
      'Cash: hand the cash back. A cash movement: put the cash back as it was.',
      'Sales already in a Day End can’t be voided. Voiding needs a connection.',
    ],
    more: (
      <>
        <P>
          A card payment that wasn’t taken through the till (for example keyed into the Terminal while offline) isn’t
          refunded automatically. Refund it on the Terminal or in the Square Dashboard.
        </P>
        <P>
          To give a member money from their account back in cash, use “Refund cash…” instead. See{' '}
          <TopicLink to="topup">Top Up and cash refunds</TopicLink>.
        </P>
      </>
    ),
    related: ['staffproof', 'topup', 'dayend'],
  },
  {
    id: 'cashmovement',
    title: 'Cash Movements',
    summary: 'Cash put in or taken out of the till that isn’t a sale.',
    points: [
      'For things like paying a delivery driver from the till, or adding to the float. Use it only when you have to.',
      'On Home, tap Cash Movement and confirm with your card or PIN.',
      'Choose Cash In or Cash Out, the product group and product, the amount, and a reason.',
      'It’s included in the Day End’s expected cash. It needs a connection.',
    ],
    more: (
      <>
        <P>
          The products you can choose are set up on the Products screen with “Variable price”. See{' '}
          <TopicLink to="products">Products</TopicLink>.
        </P>
        <P>A cash movement entered by mistake can be voided from Sales, like a sale.</P>
      </>
    ),
    related: ['staffproof', 'dayend', 'products'],
  },
  {
    id: 'dayend',
    title: 'Day End (cashing up)',
    summary: 'Counting the till and recording what was removed.',
    points: [
      'On Home, tap Dayend and confirm with your card or PIN.',
      'The till shows what it expects to be in the till since the last cash-up: brought forward, cash top-ups, cash sales, cash movements, membership fees and refunds.',
      'Tap any underlined line to see the transactions in it.',
      'Enter the cash you’re removing. It starts at the expected amount.',
      'If it doesn’t match, either tick “Carry difference forward” or give a reason. Then Confirm Day End.',
    ],
    more: (
      <>
        <P>
          Carrying forward is for when you’re leaving cash in the till on purpose, for example not cashing up fully.
          The difference is added to the next Day End’s expected cash.
        </P>
        <P>
          “For completeness” lists the account and card sales and card top-ups. They don’t affect the cash, but they
          are part of the day’s takings.
        </P>
        <P>
          After a Day End, its sales can no longer be voided. Day End needs a connection.
        </P>
      </>
    ),
    related: ['staffproof', 'cashmovement', 'mistakes'],
  },
  {
    id: 'products',
    title: 'Products and categories',
    summary: 'Adding items and changing prices — for whoever looks after the bar stock.',
    points: [
      'On Home, tap Products.',
      'Add an item: name, category and price, then Add. Tap Edit to change one.',
      'Deactivate an item to take it off the till without losing its history. Activate brings it back.',
      'Categories are the coloured buttons along the top of the basket. Add, rename, recolour or deactivate them under Manage Categories.',
      'Only change products if it’s your job — changes show on the till straight away.',
    ],
    more: (
      <>
        <P>
          The price boxes depend on how the club prices members and visitors, which is set by the committee in Config
          (Bar). With split pricing you enter a member price and a visitor price. With a member discount you enter one
          price, and the discount is taken off for members (it can be different for an item if the discount is set per
          product).
        </P>
        <P>
          Nominal codes are for the accounts (Xero). Leave them blank unless the Treasurer has given you one — an item
          uses its category’s code when it has none.
        </P>
        <P>
          “Variable price” items aren’t sold — they’re the choices on the{' '}
          <TopicLink to="cashmovement">Cash Movement</TopicLink> screen, where the amount is typed each time.
        </P>
      </>
    ),
    related: ['cashmovement'],
  },
  {
    id: 'offline',
    title: 'When the till is offline',
    summary: 'What still works without a connection.',
    points: [
      'An amber banner says the till is running offline.',
      'Cash and card sales still work. They’re saved on the tablet and sent when it’s back online — tap “Sync now” if they don’t go by themselves.',
      'Pay by Account only works up to what’s been topped up while offline, because the till can’t see the real balance.',
      'Members must scan their card — PINs can’t be checked offline.',
      'Card payments: key the amount into the Terminal yourself, then confirm on the till once it’s approved.',
    ],
    more: (
      <>
        <P>
          These need a connection: voids, cash refunds, cash movements, membership fees, setting PINs and Day End.
        </P>
        <P>
          “Retry connection” checks again straight away. Don’t log out while sales are waiting to sync — they’re only
          on this tablet until they’ve gone.
        </P>
      </>
    ),
    related: ['terminal', 'proof'],
  },
  {
    id: 'problems',
    title: 'When something goes wrong',
    summary: 'Quick fixes for the usual problems.',
    points: [
      '“Card not recognised”: it isn’t a current membership card. Use their PIN, or find them in the list.',
      '“That card has been replaced”: they need their new card from My Account, or their PIN.',
      'PIN locked: scan their card, then set a new PIN.',
      'The Terminal isn’t responding: check it’s on, awake and on the Wi-Fi. Cancel, then try again.',
      'A payment refused with a message: read it, go back and try again — nothing was charged.',
    ],
    more: (
      <>
        <P>
          The wrong person is shown as serving? Tap “Serving: … Change”. See{' '}
          <TopicLink to="servers">Switching between servers</TopicLink>.
        </P>
        <P>
          The camera won’t scan? Try “Switch camera”, hold the code steady about a hand’s width away, and turn the
          phone’s brightness up. Or use their PIN.
        </P>
        <P>Anything else, note the time and what happened, and tell the committee.</P>
      </>
    ),
    related: ['proof', 'pins', 'terminal'],
  },
];

function topicById(id: BarHelpTopicId): Topic {
  return TOPICS.find((t) => t.id === id) ?? TOPICS[0];
}

function Points({ topic }: { topic: Topic }) {
  return (
    <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-800 leading-relaxed">
      {topic.points.map((p, i) => <li key={i}>{p}</li>)}
    </ul>
  );
}

function More({ topic, startOpen = false }: { topic: Topic; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  if (!topic.more) return null;
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} className="text-sm font-medium text-blue-700 underline">
        {open ? 'Less' : 'More…'}
      </button>
      {open && <div className="mt-2 rounded-lg bg-gray-50 border border-gray-200 p-3">{topic.more}</div>}
    </div>
  );
}

function Related({ topic }: { topic: Topic }) {
  if (!topic.related || topic.related.length === 0) return null;
  return (
    <div className="mt-3 text-sm text-gray-700">
      See also:{' '}
      {topic.related.map((id, i) => (
        <span key={id}>
          {i > 0 && ' · '}
          <TopicLink to={id}>{topicById(id).title}</TopicLink>
        </span>
      ))}
    </div>
  );
}

/** Provided by the till: opens the help panel at a topic. */
export const BarHelpContext = createContext<((topic: BarHelpTopicId) => void) | null>(null);

/** A small "?" that opens the help at a topic. Shows nothing outside the till. */
export function BarHelpLink({ topic, className = '' }: { topic: BarHelpTopicId; className?: string }) {
  const openHelp = useContext(BarHelpContext);
  if (!openHelp) return null;
  return (
    <button type="button" onClick={() => openHelp(topic)} title="Help" aria-label="Help"
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-blue-300 bg-blue-50 text-sm font-bold text-blue-800 hover:bg-blue-100 ${className}`}>
      ?
    </button>
  );
}

/** The help, over the till. topic = where it opens; null opens the list of topics. */
export function BarHelpPanel({ topic, onClose }: { topic: BarHelpTopicId | null; onClose: () => void }) {
  const [current, setCurrent] = useState<BarHelpTopicId | null>(topic);
  const shown = current ? topicById(current) : null;
  return (
    <GoTo.Provider value={setCurrent}>
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
            <h2 className="text-lg font-bold text-gray-900">{shown ? shown.title : 'Bar till help'}</h2>
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-sm rounded-md border border-gray-300 bg-white hover:bg-gray-50">Close</button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            {shown ? (
              <div key={shown.id}>
                <Points topic={shown} />
                <More topic={shown} />
                <Related topic={shown} />
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {TOPICS.map((t) => (
                  <button key={t.id} type="button" onClick={() => setCurrent(t.id)} className="w-full py-3 text-left hover:bg-gray-50">
                    <div className="text-sm font-semibold text-gray-900">{t.title}</div>
                    <div className="text-sm text-gray-600">{t.summary}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {shown && (
            <div className="border-t border-gray-200 px-5 py-3">
              <button type="button" onClick={() => setCurrent(null)} className="text-sm font-medium text-blue-700 underline">
                ← All help topics
              </button>
            </div>
          )}
        </div>
      </div>
    </GoTo.Provider>
  );
}

/** Every topic on one page (/help/bar). */
export function BarHelpPage() {
  function jump(id: BarHelpTopicId) {
    document.getElementById(`bar-help-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return (
    <GoTo.Provider value={jump}>
      <section className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">Contents</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {TOPICS.map((t) => (
            <li key={t.id}><TopicLink to={t.id}>{t.title}</TopicLink></li>
          ))}
        </ul>
      </section>
      {TOPICS.map((t) => (
        <section key={t.id} id={`bar-help-${t.id}`} className="bg-white rounded-xl border border-gray-200 p-6 scroll-mt-4">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">{t.title}</h2>
          <p className="text-sm text-gray-500 mb-3">{t.summary}</p>
          <Points topic={t} />
          <More topic={t} />
          <Related topic={t} />
        </section>
      ))}
    </GoTo.Provider>
  );
}
