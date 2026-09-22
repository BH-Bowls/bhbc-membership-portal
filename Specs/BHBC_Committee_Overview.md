# Burgess Hill Bowls Club — Digital Systems Overview

*For the BHBC Committee. Plain English — no technical background needed.*
*Last updated: 25 August 2026*

---

## 1. Purpose of this document

This explains, in plain English, what digital systems Burgess Hill Bowls Club relies on, who looks after them, what they cost, and what to do if the current developer becomes unavailable.

A separate, more technical companion document — **"BHBC Developer Technical Runbook"** — exists to hand to a developer picking this up. This document is the one for the Committee to read and keep.

---

## 2. What we have

**Membership Portal / App** — the members-only system. Members log in to manage their profile, fixtures, friendlies, competitions, availability, and more. Built and maintained by Liam Dasey.

**Public Website** (burgesshillbowlsclub.com) — the Club's public-facing site: information for visitors, the contact form, public fixture listings, news.

Both are built the same way and hosted on the same platform (Vercel — see Section 4), and share some behind-the-scenes Google account resources for storing data and sending email. Otherwise they are separate systems that can be worked on independently.

---

## 3. Who to contact

**Liam Dasey** built and maintains both systems. The Committee has his contact details on file.

There is currently **no backup developer**. If Liam is unavailable, see Section 6 ("Known risks") and hand the Developer Technical Runbook to whoever picks this up next.

---

## 4. Accounts at a glance

| Service | What it's for | Login | Password |
|---|---|---|---|
| GitHub | Where the website/app source code is stored | burgesshillbc@gmail.com (org: BH-Bowls) | *[to be added]* |
| Vercel | Hosts both the Portal and the Website | burgesshillbc@gmail.com | *[to be added]* |
| Supabase | Database for the Membership Portal only (Website has no database) | burgesshillbc@gmail.com | *[to be added]* |
| Google Cloud Console / Gmail | Behind-the-scenes data storage and email sending for both systems | burgesshillbc@gmail.com | *[to be added]* |
| Domain & DNS — Wix | Owns burgesshillbowlsclub.com and controls where it points online | anneprice57@hotmail.com | *[to be added]* |

> **Note:** the Wix login belongs to Anne Barnes (Committee), not the Club's shared Google account. Both Anne and Liam currently hold the login details. Worth recording the password here too, so it isn't dependent on either one individually.

---

## 5. Costs & billing

| Service | Plan | Cost |
|---|---|---|
| GitHub | Free | £0 |
| Vercel | Pro (covers both Portal and Website) | $24 USD/month ($20 + VAT). Downgrades to the Free plan during the closed season (roughly October–March) each year to save cost. |
| Supabase | Hobby (free) — two projects | £0. **Does not include automatic backups** — see Section 6. |
| Google Cloud / Gmail | Free, within Google's normal usage limits | £0 |
| Domain — Wix | Renewed every 3 years. Currently registered until May 2029. | £61.56 (last renewed April 2026). Cost has risen sharply each renewal: £21.60 (2020) → £32.40 (2023) → £61.56 (2026). Plan is to transfer to Cloudflare at the 2029 renewal, at roughly £10/year. |

> **Why we moved off Wix hosting:** the Club used to pay Wix separately to host the website itself (on top of the domain registration above). That hosting cost roughly tripled with each renewal — £150 (2020) → £300 (2023) → £520 (2026, refunded when cancelled) — which is what prompted the move to today's self-built site. A WordPress rebuild was considered and ruled out, since it would still mean its own separate hosting cost for more work. Building the new site the same way as the Membership Portal meant it could share the Portal's existing Vercel hosting at effectively no extra cost, rather than paying for two hosting plans.

---

## 6. Known risks

- **No backup developer.** If Liam is unavailable long-term, the Committee will need to find a developer familiar with Next.js and Supabase/Postgres, or brief someone new using the Developer Technical Runbook.
- **No database backups.** The Membership Portal's database (Supabase) is on the free "Hobby" plan, which does not include automatic backups. If the database were lost or corrupted, there is currently no built-in way to restore it. Worth discussing whether to upgrade to a paid plan (which includes backups) or set up a manual backup routine.
- **Single shared login.** Nearly every account uses the same Club Google login (burgesshillbc@gmail.com). If that account were ever lost or locked out, most of the Club's digital systems would be affected at once.
- **Domain ownership.** The domain is still registered with Wix under a Committee member's personal email address (anneprice57@hotmail.com), not the Club's shared account — though both Anne Barnes and Liam currently hold the login. Renewal cost has nearly tripled since 2020, which is why the plan is to move to Cloudflare (a much cheaper registrar) at the May 2029 renewal.

---

## 7. If something breaks

1. Contact Liam Dasey first.
2. If he's unavailable, hand the **Developer Technical Runbook** to a web developer — it has the technical detail needed to get oriented quickly (repositories, hosting, accounts, and how the systems fit together).
