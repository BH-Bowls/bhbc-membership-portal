# Unified Accounts — Committee Overview

*For the BHBC Committee. Plain English — no technical background needed.*
*Last updated: 26 August 2026.*
*This is a proposal, not yet built. A separate, more technical document — "Unified Accounts System — Design Spec" — exists for the developer to work from.*

---

## 1. What this is about

Today the Portal has three separate places money changes hands:

- **The bar.** A prototype bar system has been built that works like a modern electronic till. It lets a member hold an account they can top up, which can then be used to pay their bar bill instead of paying by cash.
- **Renewals**, where members pay their annual membership. This already has its own bank reconciliation screen — payments are matched against a bank export by the system, not manually ticked off by eye. Card and cash payments can be entered by hand.
- **Rowland Cup entries**, where visiting clubs pay £16 a team. This is currently just a manual "Paid"/"Unpaid" tick by the committee — the plan is to give it a proper bank reconciliation screen too, similar in spirit to the one Renewals already has, but adapted for matching a club's combined payment rather than an individual member's.

This proposal brings all three together into one system: **one account per member or club**, one place that records every payment in or out, and one bank-matching screen that works for all of them instead of just Renewals.

It also sets the Portal up to work with **Xero**, which the Club may be moving its accounts onto — any accounts system needs a detailed, categorised breakdown of what was paid for, not just a total.

---

## 2. What changes for members

- Members can still pay by card or cash at the bar.
- We want to move away from cash payments, as counting cash — particularly coins — is a long and arduous task for the treasurer, and currently we can find nobody who wants to do the treasurer's job if it involves the amount of cash handling currently needed.
- So, every member will have a Member Account that they can top up by bank transfer, card, or cash (notes only — no coins). The preferred method of paying your bar bill will be your Member Account balance, as it requires no cash or card handling by the bar staff.
- Your renewal, 200 Club entries, and comp entries all sit on the **same balance** as your bar account. If you're in credit, that balance can cover a round at the bar; if you owe a renewal fee, it shows up the same way a negative bar balance would.
- **A renewal posted in January but not due until the end of February won't show as a debt in the meantime.** The system knows the due date and doesn't count it against you until it actually falls due. Bar balances are not allowed to go negative.
- Two bar prices — a slightly cheaper one when you pay from your Member Account balance, a normal one for card or cash. This is an incentive to pay by Member Account balance (which also means less cash for the bar to handle), but it also lets us keep member prices low while charging visitors a slightly higher price — around 10p more for a bottled beer. A member paying cash pays the same as a visitor.
- You'll be able to see your balance and a full history of what you've paid for in a new "My Account" feature in the app.
- Members will get an extra prompt on their renewal form suggesting they top up their bar balance at the same time — say £20 or £50, depending on how much they think they'll use — which gets added to their renewal total. For example: membership fee £110, 200 Club £6, comp entries £12, bar top-up £20 — total £148. Once that's paid, it leaves £20 in credit ready to spend at the bar. A member can also top up their Member Account at any time during the year, separately from renewal.
- The preferred way to pay a membership fee or top-up remains bank transfer (no bank charges for the Club), but members can still pay or top up by card or cash — card is discouraged for the same reason as above. Top-ups made at the bar update the account immediately, including paying membership fees, which avoids having to manually enter card and cash payments into the bank reconciliation.

## 3. What changes for visiting clubs (Rowland Cup)

A visiting club's organiser gets an account for their club where the entry fee will be recorded — the same email-link access they already get today to check entry status, draws, and results will also let them see whether the balance has been paid. Payment for team entries moves from today's manual tick-box to a unified bank reconciliation screen.

## 4. What changes for the treasurer / committee

- **One bank reconciliation screen** instead of a Renewals-only one — matches statement lines against member accounts *and* Rowland club accounts.
- Where the same surname appears twice (two "S Smith" households), the system remembers which bank reference belongs to which account once it's been matched the first time, so future statements match automatically. If it's ever assigned to the wrong account, there'll be a way to move it to the right one.
- Payments taken in person — cash, card, or cheque, e.g. someone paying their renewal at the bar — go through the same system as a bar top-up, rather than being a separate manual process.
- When a renewal is reconciled, the member's record is automatically updated to show membership valid until the following year — no separate step to remember.
- **A batch export to Xero**, triggered by the treasurer when wanted (not automatic, not per-transaction), broken down by category — e.g. a £132 payment covering a renewal, two 200 Club entries, and eight comp entries exports as five separate categorised lines, not one lump sum. Bar takings can also be exported broken down by category.

## 5. Tea and raffle money

Before a friendly, each member currently drops £2 into a numbered jar — one jar per rink in use — to cover tea for themselves and their opponent, and needs £1 in cash during the break for the raffle. The team sheet shows which rink each pair is allocated to, so members know which jar to use. Before the game starts, the captain has to check each jar holds the right amount, and if one's short, work out who on that rink hasn't paid.

The raffle has to stay cash — there's no practical way around that. But the tea money can move to the bar instead, replacing the jars entirely.

Instead of dropping £2 into a rink jar before the game, the £2 gets marked against a member's name on the match card — either the member writes it themselves, or the bar volunteer does it when the member comes up after the game to buy themselves and their opponent a drink (rung up as a "Teas" item priced at £2, tracked separately in Xero). Once the bar's settled down after the game, the captain of the day checks the match card the same way they'd have checked the jars, to see who still owes.

This should be a welcome change for many, since it removes the need for four numbered jars and a stash of £1 coins before every game.

## 6. Bar pricing — a concrete example

The Club's bottled ale price (£2.60) hasn't moved since 2023, while the equivalent bottle at Tesco is now £2.45. Checking the Office for National Statistics' own beer price index (RPI: Beer), prices have risen by roughly 20% since 2023 — a straight catch-up would mean around £3.11 in one go. Agreed prices instead rise more gradually over two seasons, keeping a 10p gap between the two:

| Season | Paying from account balance | Paying by card/cash |
|---|---|---|
| 2026 | £2.90 | £3.00 |
| 2027 | £3.00 | £3.10 |

This uses bottled beer as the example category — whether other bar prices (wine, soft drinks, snacks) rise too is a separate decision for the Committee.

## 7. A new till for the bar

There's no digital system behind the bar at the moment. A volunteer either totals up prices from memory, or checks a printed price list and types the total into a manual till — nothing is linked to a member's account, and no record is kept of what was actually sold.

This is replaced with a tablet running the new bar system — a big-button screen for each product showing its price (e.g. "Fursty Ferret — £2.90"), linked to the Members list and their Member Accounts, so a sale can be charged straight to someone's balance instead of being worked out by hand. The tablet uses one shared login (same as the existing shared logins used elsewhere in the Portal), but whoever is behind the bar selects their own name from a row of big buttons before ringing up a sale or a top-up. Getting this right matters most for top-ups, since that's real money moving into or out of an account, but it applies to ordinary sales too.

## 8. What this does not include

- No new system for chasing unpaid members — a member isn't allowed to run up debt in the normal course of things, so there's no "write-off" feature being built.
- No live, instant connection to Xero — the treasurer decides when to send a batch across.
- No decisions yet on how the Renewals form itself might change — that needs more thought and isn't part of this proposal.

## 9. Suggested next step

This is a design only — nothing has been built yet. If the Committee is happy with the direction, the recommended approach is to build it in stages (bar first, since it's closest to this shape already, then Rowland, then Renewals last, as the biggest piece) rather than one large change all at once, with each stage checked against real data before moving to the next.
