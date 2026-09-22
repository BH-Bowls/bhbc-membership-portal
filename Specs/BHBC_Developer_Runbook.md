# BHBC Developer Technical Runbook

*Quick reference for a developer picking up these projects. Companion to the "BHBC Committee Overview" document.*
*Last updated: 25 August 2026*

---

## 1. System overview

Two independent Next.js applications, hosted the same way, sharing some Google-account-based resources:

- **Membership Portal** (repo: `bhbc-membership-portal`) — members-only app: login, fixtures, friendlies, competitions, availability, leagues, banking, 200 Club, etc. Postgres/Supabase-backed; migrated off Google Sheets incrementally through 2026, so a few legacy Sheets-based features may still remain — check `src/lib/sheets.ts` and don't assume a given feature is fully on Postgres without checking.
- **Public Website** (repo: `BHBC-Website`) — marketing site: club info, contact form, public fixture listings. No database of its own — reads/writes Google Sheets/Drive directly.

Both are hosted on **Vercel**, under the same Vercel account. Both use the **same Google Cloud Console project** (one shared service account) for Sheets/Drive access and Gmail SMTP for email. **Supabase is used only by the Portal** — the Website has no database.

**Cross-app dependency to know about:** the Website reads the Portal's `FRIENDLIES_SPREADSHEET_ID` Google Sheet directly and read-only (see `lib/env.ts`'s `getFriendliesSheetId()`) to show public fixtures. If the Portal's Friendlies data model changes structurally, the Website's fixture display needs updating too — they are not as independent as the separate repos suggest.

---

## 2. Repositories (GitHub)

- **Org:** `BH-Bowls`
- **Portal:** `github.com/BH-Bowls/bhbc-membership-portal` — main branch `main`, auto-deploys to production on push
- **Website:** `github.com/BH-Bowls/BHBC-Website` — main branch `main`, auto-deploys to production on push
- **Account:** burgesshillbc@gmail.com (see Committee Overview's credentials table)
- **Visibility:** *[confirm public/private in GitHub settings]*

---

## 3. Hosting & deployment (Vercel)

- Single Vercel account (burgesshillbc@gmail.com), Pro plan — downgrades to Free each closed season (~Oct–March)
- Two Vercel projects, one per repo
- **Portal:** pushing to `main` auto-deploys to production, but the build is deliberately gated — `vercel.json`'s `ignoreCommand` skips the build unless `package.json` changed in that commit, to conserve build minutes. To force a Preview deploy on a feature branch without a real dependency change, bump the harmless `previewVersion` field in `package.json`.
- **Website:** no such gating — every push to `main` deploys normally.
- Environment variables live in each Vercel project's dashboard (Settings → Environment Variables), set separately per Production / Preview / Development environment.

---

## 4. Membership Portal — stack & specifics

- Next.js (App Router) + TypeScript + Tailwind
- Auth: NextAuth, session-based, custom multi-role system (`src/lib/role-utils.ts`)
- Database: Supabase/Postgres, two projects:
  - **Production:** `ovmaeycnlubjxsyrswoz`
  - **Dev:** `ofqepimyooesuckyrane` — used for local development *and* Vercel Preview deployments
  - Both on Supabase's free "Hobby" plan — **no automatic backups**. `scripts/db-dump.ts` / `scripts/db-restore.ts` (and the `db-*` npm scripts) are the closest thing to a manual backup process currently in place.
  - Migrations: `supabase/migrations/`
- File attachments: Google Drive. `src/lib/drive.ts` prefers an OAuth-authenticated user (`GOOGLE_OAUTH_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN`) if configured, falling back to the plain service account otherwise — the OAuth path exists because a bare service account has no Drive storage quota of its own on a non-Workspace Google account.
- Email: Gmail SMTP via `nodemailer` (`SMTP_USER`/`SMTP_PASSWORD` — an app password, not the account's main password)
- Local dev: `npm run dev` (port 3001)

---

## 5. Website — stack & specifics

- Next.js 14 (App Router) + TypeScript + Tailwind — no database
- Content: its own Google Sheet ("Website Content") + Drive folder ("Website Documents"), separate from the Portal's own Sheets
- Contact form (`app/api/contact/route.ts`): server-side validation + IP rate-limiting, sends via Gmail SMTP (same pattern as the Portal)
- Public fixtures: reads the Portal's Friendlies Google Sheet directly (see the cross-app dependency note in Section 1)
- On-demand revalidation: `/api/revalidate`, protected by `REVALIDATE_SECRET`
- Local dev: `npm run dev` (port 3010)

---

## 6. Domain & DNS

- **Domain:** burgesshillbowlsclub.com
- **Registrar/DNS:** Wix, under account **anneprice57@hotmail.com** — belongs to Committee member Anne Barnes; both Anne and Liam currently hold the login (see Committee Overview)
- **Renewal:** every 3 years. Registered until May 2029. Cost has risen sharply each cycle — £21.60 (2020) → £32.40 (2023) → £61.56 (2026) — hence the plan to transfer to **Cloudflare** (~£10/year) at or before the May 2029 renewal.
- **History:** the Club used to host the actual website on Wix's own builder too (a separate cost from the domain registration above). That hosting plan's price roughly tripled each renewal — £150 (2020) → £300 (2023) → £520 (2026, refunded when cancelled) — which is what drove the move to this self-built Next.js site. A WordPress rebuild was considered and ruled out (more work, still its own separate hosting cost); building on Next.js/Vercel instead meant the Website could share hosting with the Portal at effectively no extra cost, rather than paying for two hosting plans. The domain *registration* itself was left with Wix rather than migrated at the same time — see the renewal-cost note above for that separate, still-open cost.
- **DNS records** (looked up 25 Aug 2026 — reconfirm before relying on this, DNS can change):
  - Nameservers: `ns10.wixdns.net`, `ns11.wixdns.net` — Wix manages DNS even though hosting is on Vercel
  - `burgesshillbowlsclub.com` → **A record** → `216.150.1.1` (Vercel's shared apex IP)
  - `www.burgesshillbowlsclub.com` → **CNAME** → `5b342378d453759a.vercel-dns-016.com` (Vercel-assigned target)
  - No MX or TXT records on the domain — confirms there's no domain-based email; both apps send via Gmail SMTP on `burgesshillbc@gmail.com` (see Section 7), not `@burgesshillbowlsclub.com` addresses

---

## 7. Google Cloud Console project

- One project, shared by both apps
- **APIs in use:** Google Sheets API, Google Drive API, Google Maps Embed API (Website only)
- **Credentials:**
  - A **service account** (`GOOGLE_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_PRIVATE_KEY`) — used for Sheets access in both apps, and as the Drive fallback in the Portal
  - An **OAuth client** (`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` / `GOOGLE_OAUTH_REFRESH_TOKEN`) — Portal only, the preferred path for Drive attachment storage
- **Email:** not a separate provider — both apps send mail via Gmail SMTP using an app password (`SMTP_USER` / `SMTP_PASSWORD`), tied to the shared burgesshillbc@gmail.com account
- **Console access:** console.cloud.google.com, sign in with burgesshillbc@gmail.com

---

## 8. Environment variables reference

Names only — actual values live in each Vercel project's dashboard, and locally in `.env.local` / `.env.prod.local` (never committed).

**Portal:**
`NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`, `GOOGLE_DRIVE_ATTACHMENTS_FOLDER_ID`, `FRIENDLIES_SPREADSHEET_ID`, `PORTAL_DOCUMENTS_FOLDER_ID`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `PUBLIC_ACCESS_PIN`, `ICS_UPDATE_EMAILS`

> Most of the Portal's Sheets migrated to Supabase/Postgres through 2026 (see Section 1) — `MEMBERS_SPREADSHEET_ID`, `COMPETITIONS_SPREADSHEET_ID`, `LEAGUES_SPREADSHEET_ID`, `ROWLAND_SPREADSHEET_ID`, `MATCH_DAY_CONTACTS_SPREADSHEET_ID`, and `PORTAL_CONFIG_SPREADSHEET_ID` are now commented out in `.env.local`/`.env.prod.local` and removed from Vercel — no longer used. `FRIENDLIES_SPREADSHEET_ID` is the only spreadsheet ID still live, since Friendlies hasn't fully migrated off Sheets yet.

**Website:**
`GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `WEBSITE_CONTENT_SHEET_ID`, `WEBSITE_DOCUMENTS_FOLDER_ID`, `FRIENDLIES_SPREADSHEET_ID` (copied from the Portal), `SMTP_USER`, `SMTP_PASSWORD`, `CONTACT_FORM_TO`, `GOOGLE_MAPS_EMBED_KEY`, `REVALIDATE_SECRET`

---

## 9. Accounts & credentials

| Service | URL | Login | Password | 2FA | Notes |
|---|---|---|---|---|---|
| GitHub | github.com/BH-Bowls | burgesshillbc@gmail.com | *[to be added]* | *[confirm]* | Org owns both repos |
| Vercel | vercel.com | burgesshillbc@gmail.com | *[to be added]* | *[confirm]* | Pro plan, 2 projects |
| Supabase | supabase.com | burgesshillbc@gmail.com | *[to be added]* | *[confirm]* | 2 projects, Hobby plan, no backups |
| Google Cloud Console | console.cloud.google.com | burgesshillbc@gmail.com | *[to be added]* | *[confirm]* | Same login used for Gmail SMTP |
| Wix (domain/DNS) | wix.com | anneprice57@hotmail.com | *[to be added]* | *[confirm]* | Belongs to Anne Barnes (Committee); Anne and Liam both hold the login. Renews every 3 years, until May 2029. Plan: transfer to Cloudflare at that renewal. |

---

## 10. Key pointers

- Release process (Portal): `npm run release:patch` / `:minor` / `:major` → `scripts/release.js` (bumps version, commits, tags, pushes)
- DB migrations (Portal): `supabase/migrations/`
- DB dump/restore scripts (Portal): `scripts/db-dump.ts`, `scripts/db-restore.ts`
- Website spec doc: `specs/BHBC_WEBSITE_SPEC.md`
