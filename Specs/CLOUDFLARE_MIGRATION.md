# Migrating BHBC Membership Portal from Vercel to Cloudflare Workers

**Status (2026-09-30): audit and spikes complete. Nothing is implemented.**
No project source, `package.json` or config was changed. Every measurement
below comes from a throwaway copy of `HEAD` (`git archive`) in a scratch
directory, using `--no-save` installs of `@opennextjs/cloudflare@1.20.7` and
`wrangler@4.144.0`. The copy was deleted afterwards. Nothing was deployed.

This audit re-verifies the two sister-project docs rather than trusting them:
- TDC Portal: `C:\Users\liam\Documents\TDC-portal\Specs\CLOUDFLARE_MIGRATION.md`
- Spire Portal: `C:\Users\liam\Documents\Spire-portal\Specs\CLOUDFLARE_MIGRATION.md`

Several of their conclusions turned out not to hold (see §6).

Versions tested:
- `next` 16.3.7. The lockfile pins 16.1.1, but installing OpenNext bumps it,
  and Vercel would then build 16.3.7 too.
- `googleapis` 167, `google-auth-library` 10.x
- `@supabase/supabase-js` 2.111
- `next-auth` 4.24.13, `exceljs` 4.4.0

---

## 1. Verdict

**Plan tier: Workers Paid ($5/month) is effectively required. Trial it for a
month before committing.**

- The free plan's documented CPU limit is 10 ms per request. On the live Spire
  Worker, which is also on the free plan, almost every request exceeded it.
  Cloudflare analytics show a median of ~40 ms and ~350–480 ms for logins.
- Cloudflare usually lets these through, but not always. **8 of the first ~200
  requests were killed with Error 1102** ("Worker exceeded resource limits").
  The killed requests themselves were cheap (at most 10–38 ms of CPU). They came
  in the minute after two logins.
- A later repeat of the same sequence, with `wrangler tail` running, produced
  **0 kills in 211 requests**. The failure is real but intermittent.
- **The cause is unproven.** 1102 covers both the CPU limit and the 128 MB
  memory limit, and memory is the same on Free and Paid. One request killed at
  exactly 10 ms points to CPU, but memory can't be ruled out.
- So: trial Paid for one month with Workers Logs enabled
  (`"observability": { "enabled": true }`), which records `exceededCpu` or
  `exceededMemory` per request. Run golden-path testing on the preview URL. If
  any `exceededMemory` shows up, Paid won't fix it; investigate in-memory
  caches (e.g. the 24h Members cache) first.
- User decision (2026-09-30): TDC and Spire stay on Vercel, since they run fine
  there. BHBC at $60/year is cheaper than Vercel Pro for 6 months, so BHBC is
  still a candidate.

**Real blockers, all confirmed on `wrangler dev`, all with a verified fix:**

1. **`proxy.ts` goes through OpenNext's experimental Node-middleware path.** The
   build log shows `Bundling Node.js middleware...`, the same signature TDC and
   Spire hit.
   - **Fix (verified):** rename to `middleware.ts` and add
     `export const runtime = 'experimental-edge'`.
   - **No internal maintenance-status route is needed here**, unlike TDC and
     Spire. `isMaintenanceModeOn()` uses Supabase-JS, which is fetch-based. It
     was instrumented and confirmed running inline in edge middleware.
   - Next 16.3.7 warns that both `middleware.ts` and the edge runtime are
     deprecated. This is a long-term risk.
2. **`Handlebars.compile()` fails on Workers:** `EvalError: Code generation from
   strings disallowed` (it uses `new Function`). This is new; neither sister doc
   caught it.
   - There are 5 call sites, covering every templated email:
     - `src/lib/email/mailer.ts` (`loadTemplate`)
     - `app/api/apply/route.ts`
     - `app/api/rowland/enter/route.ts`
     - `src/lib/email/availability.ts` (×2)
   - **Fix (verified):** precompile templates at build time with
     `Handlebars.precompile` and render with `handlebars/runtime` using
     `Handlebars.template(spec)`. This rendered correctly on Workers, while
     `compile()` still failed in the same Worker.
   - **Spire's and TDC's `mailer.ts` also call `Handlebars.compile`**, so their
     Workers deploys likely can't send templated email. TDC has since
     confirmed this live, using `wrangler tail` during a real send.
   - **Use precompilation, not TDC's regex substitution.** BHBC's templates use
     block helpers (35 `{{#if}}`, plus `{{#each}}` and `{{#unless}}`), so a
     plain `{{var}}` regex replacement would be wrong here.
   - **Blanket code-generation scan (2026-10-01):**
     - App code: the 5 `Handlebars.compile` sites are the only runtime code
       generation. No `eval`, `new Function`, `vm`, or EJS/Pug/Mustache.
       `new RegExp(...)` (in `banking-match.ts`, `template-processor.ts` and
       `template-reader.ts`) is not code generation and is allowed on Workers.
     - Dependencies: hits exist only in browser `dist/` bundles that the server
       never loads (`exceljs/dist`, `pizzip/dist`), and in Handlebars' UMD
       runtime build. The one hit there is a `Function('return this')` global
       fallback that is unreachable on Workers, because `self` exists.
     - `handlebars/runtime` resolves to `dist/cjs/handlebars.runtime`, which
       has no code generation.
     - The compiled `.next/server` output had no `eval` or `new Function`.
   - **Exercise every email-sending path in testing.** This bug only appears
     when the code path actually runs; a clean build or page-load smoke tests
     prove nothing. The spike reproduced it under `wrangler dev` because the
     probe called `compile()` directly. During preview testing, trigger every
     email type (password reset/changed, application ×3, renewal ×2,
     availability ×4, duty swaps ×2, Rowland entry, admin bulk send) with
     `wrangler tail` running.
3. **Email templates are read from disk at request time.** The 15 files in
   `src/lib/email/templates/*.html` aren't in the Worker bundle: `ENOENT
   /bundle/src/lib/email/templates/...`.
   - `template-reader.ts` (the admin bulk-email page) is worse: its
     `readdirSync` **silently returns 0 templates**.
   - **Fix:** the same generated module as item 2. Inlining all 15 precompiled
     templates adds about 15 KiB gzipped.

**Verified working on `wrangler dev` with the dev environment (no change
needed):**
- **Supabase-JS:** config read, and all 197 members read. A module-level
  singleton client is fine.
- **Google Sheets:** service-account RS256 signing, via both the Friendlies
  Games read and `/api/friendlies/games`. Tested on the slim-package build (§2).
- **Google Drive, both auth paths:** the OAuth refresh-token path and the
  service-account JWT path. A real PDF streamed through `/api/guides/tea-duty`,
  and `/api/documents` worked.
- **Libraries:** `exceljs` `writeBuffer` (valid xlsx), `bcryptjs`,
  `crypto.randomBytes`, and `AsyncLocalStorage` (the mailer's log context).
- **Pages:** server rendering of `/bar` (jsqr), `/account` and `/labels`
  (qrcode), with a locally minted NextAuth session cookie. It was accepted,
  which Spire's audit couldn't achieve.
- **PWA:** `sw.js`, `workbox-*.js` and `swe-worker-*.js` are generated by the
  `--webpack` build, and `/sw.js` and `/manifest.json` both return 200.
  **Install and offline behaviour are not tested.** That needs an HTTPS preview
  deploy, and the bar till's IndexedDB offline queue depends on it.

**Needs a decision:**
- **Email transport.** Nodemailer SMTP `verify()` succeeded (connect, STARTTLS
  and AUTH to Gmail on port 587). That contradicts TDC §4.2, which says it
  "does not work, full stop". workerd did log `startTls called with unsupported
  expectedServerHostname option`, and no real email was sent. Options: keep
  SMTP (test a real send first), or move to Resend (proven on Spire; needs a
  verified sending subdomain, see TDC §4.2's Reply-To pattern). Moving to
  Resend also brings delivery tracking (delivered/bounced/complained). See §7.
- **Admin → Send Member Emails → Attachments.** `src/lib/email/pdf-generator.ts`
  fills DOCX files with `docxtemplater`/`pizzip`, then runs **LibreOffice via
  `execSync` at a hardcoded `C:\Program Files\...` path**. `execSync` isn't
  implemented on Workers (confirmed). **It is already broken on Vercel too:**
  each attachment fails inside a try/catch, so emails go out without it.
  Recommendation: remove the attachment step.
- **`@vercel/analytics`.** `/_vercel/insights/script.js` returns 404 on Workers
  (confirmed on the live Spire Worker). Either load it only on Vercel, or
  switch to Cloudflare Web Analytics.

**Non-issues:**
- **Printing** is all browser-side `window.print()` (11 sites).
- **Unused dependencies:** `puppeteer`, `sharp`, `mammoth` and `docx-templates`
  have zero imports, `scripts/` included. `zod`, `date-fns` and `dotenv` are
  unused too; the scripts use `dotenv-cli`.
- **`vercel.json` headers.** Only `/_next/static/*` needs a `public/_headers`
  entry; there's no `public/static` directory. Worker responses aren't
  CDN-cached by default.

---

## 2. Bundle size (`wrangler deploy --dry-run`, gzipped)

Free cap: 3 MiB (3,072 KiB). Paid cap: 10 MiB.

| Build | gzip |
|---|---|
| Baseline, code as committed (`proxy.ts`) | **4,597.82 KiB** |
| + edge `middleware.ts` (drops the duplicate Node-middleware bundle) | 4,206.08 |
| + `googleapis` → `@googleapis/drive@26` + `@googleapis/sheets@18` + `google-auth-library@11` | 3,655.24 |
| + webpack server aliases for gaxios's `node-fetch`/`https-proxy-agent` (Spire's shim) | 3,588.89 |
| + exceljs, docx stack, nodemailer, jsqr, qrcode all aliased out of the server bundle | **2,971.07** (101 KiB headroom) |
| No Google at all (Sheets and Drive gone), Cloudinary via `fetch` | ~3,499 |
| No Google, Cloudinary via its official SDK (+~70 KiB) | 3,568 |
| No Google + all the cuts above | 2,876 (196 KiB headroom) |

**Where the weight comes from:**
- **`googleapis` is a ~506 KiB gz chunk,** all generated code that compresses
  very well. **The slim-package swap is justified by Drive, not Sheets.**
  `src/lib/drive.ts` (attachments, documents, guides, website photos) is a
  permanent dependency. `sheets.ts` and `friendlies-sheets.ts` only need a
  one-line import change, because as long as any file imports the full
  package, all of it stays in the bundle.
- **exceljs + archiver + jszip ≈ 410 KiB gz.** It's live server-side:
  `src/lib/data-export.ts` and `src/lib/bracket-excel-export.ts`. Both are pure
  "rows → workbook" code, so they could move to the browser.
- **The irreducible part is the app itself:** 132 pages + 266 routes ≈ 1.4 MiB
  gz, plus the Next runtime. It grows with every feature, so free-tier headroom
  wouldn't last.
- **QR libraries:**
  - `jsqr` 1.4.0 is pure JS: no WASM, no native code. It decodes camera frames
    in the browser in `app/bar/page.tsx`. Its top-level import in a
    server-rendered `'use client'` page still puts ~50 KiB gz in the Worker.
  - `qrcode` 1.5.4 is pure JS. Its server entry pulls in `pngjs` (~18 KiB gz).
  - Both can be removed from the server bundle with a server-only webpack alias
    (tested).
- **Moving Drive to Cloudinary gains only ~90 KiB** beyond the slim Google
  packages. **Not recommended.** The project left Cloudinary for Drive in July
  2026; the February commit mentions its CDN returning 401 on raw files.

**On Workers Paid, all the free-tier cuts are optional.** Even the untouched
build (4.49 MiB) fits the 10 MiB cap.

---

## 3. bcrypt / login CPU

- **bcrypt only runs when someone types a password or PIN:** member login, bar
  till and kiosk PINs (they are passwords on the shared `bar`/`clubhouse`
  accounts), change password, admin creating a member or setting a temp
  password, and saving a new password after a reset.
- **Existing sessions never run it.** NextAuth runs in JWT mode, so each request
  only decrypts the session cookie with `jose` (8 ms CPU measured on Spire).
- **Emailed-link tokens never run it either.** Friendlies, availability guest,
  Rowland and the reset link itself are all random 32-byte tokens matched by
  equality, and the public PIN gate is a plain cookie comparison.
- **Stored hashes are cost 12** (`bcryptjs` 3, `$2b$`): ~237 ms in Node,
  ~350–480 ms CPU on Workers. That's fine on Paid.
- **Alternative, tested read-only on the dev database:** verify the password
  inside Postgres with `pgcrypto` (installed in the `extensions` schema).
  `crypt()` **rejects `$2b$` but works after swapping the prefix to `$2a$`**
  (correct password → true, wrong → false, at cost 12). This makes login cost
  the Worker only a few ms. Not recommended now; keep it in reserve. It isn't
  available to Spire, which has no Postgres.
- Lowering the cost to 10 (4× cheaper) is the simple option if it's ever needed.

---

## 4. File-by-file implementation plan (not started)

0. **Workers Paid trial** + `"observability": { "enabled": true }`.
1. **`proxy.ts` → `middleware.ts`:** rename the file and the function, add
   `runtime = 'experimental-edge'`, keep the maintenance import inline, leave
   the matcher unchanged.
2. **`src/lib/drive.ts`, `src/lib/sheets.ts`, `src/lib/friendlies-sheets.ts`:**
   switch to the slim packages. Pin `google-auth-library@^11` so it's shared
   with the new packages rather than duplicated. Keep `googleapis` as a
   devDependency (2 scripts use it) until Sheets is removed.
3. **New build script** (e.g. `scripts/build-email-templates.*`) that generates
   a precompiled templates module. Then change `mailer.ts`,
   `app/api/apply/route.ts`, `app/api/rowland/enter/route.ts`,
   `availability.ts` (×2) and `template-reader.ts` to one shared
   `renderTemplate()` using `handlebars/runtime`. Wire the script into
   `prebuild`, or commit its output.
4. **If attachments go:** delete `pdf-generator.ts`, the attachment branch of
   `member-mailer.ts`, `getAttachmentTemplates`, and Step 3 of
   `app/admin/emails/page.tsx`. Also delete the committed Word junk in
   `templates/Member Emails/Attachment Templates/` (`~$…docx`,
   `~WRL0087.tmp`, `temp_comp/`).
5. **`package.json`:**
   - Remove `puppeteer`, `sharp`, `@types/sharp`, `docx-templates`, `mammoth`,
     `zod`, `date-fns` and `dotenv`.
   - Remove `docxtemplater` and `pizzip` too if step 4 happens.
   - Add `@opennextjs/cloudflare` and `wrangler` as devDependencies, plus
     `cf:build`/`cf:preview` scripts.
   - `build` already uses `--webpack`, which next-pwa requires.
6. **New `wrangler.jsonc`:** `nodejs_compat`, a current `compatibility_date`,
   `assets.directory: ".open-next/assets"`, `workers_dev: true` (TDC gotcha),
   and observability.
7. **New `open-next.config.ts`:** `defineCloudflareConfig()`.
8. **New `public/_headers`:** `/_next/static/*` →
   `Cache-Control: public, max-age=31536000, immutable`.
9. **`.gitignore`:** add `.open-next/`, `.wrangler/` and `.dev.vars`.
10. **`app/layout.tsx`:** decide what to do about `@vercel/analytics`.
11. **Email transport decision** (SMTP vs Resend). If Resend, also build the
    delivery tracking in §7.
12. **Secrets:** copy every Vercel env var into `wrangler secret`, including
    `WEBSITE_SITE_URL`/`WEBSITE_REVALIDATE_SECRET` if they're set in Vercel.
    The multiline `GOOGLE_PRIVATE_KEY` worked through `.dev.vars` (dotenv
    format, `\n` escapes).
13. **HTTPS preview deploy:** PWA install/offline, the bar till offline queue,
    a real email send, golden paths, and a check of Workers Logs for
    `exceededMemory`. Only then DNS.

Free-tier-only items (optional on Paid): the gaxios shims, moving exceljs to
the browser, server aliases for `jsqr`/`qrcode`, and dropping nodemailer.

---

## 5. Gotchas found during the spikes

- **Windows:** a `workerd.exe` process can outlive a stopped `wrangler dev`
  and lock `.open-next/`. Kill it before rebuilding. OpenNext also warns that
  Windows isn't fully supported; prefer WSL or CI for real builds.
- **Direct Postgres connections from this machine:** port 5432 on the Supabase
  pooler gave `ECONNRESET`; port 6543 worked.
- **`wrangler tail --format json`** includes `cpuTime`, `wallTime` and
  `outcome` for each request. It's the tool for diagnosing 1102s live.
- **Cloudflare GraphQL analytics** (`workersInvocationsAdaptive`) report CPU
  percentiles and an `exceededResources` count, but don't distinguish CPU from
  memory.
- **Minor, unrelated bug:** esbuild warns about a duplicate `includeHandicap`
  key in an object literal in the competitions bracket export code.

## 6. Corrections to the sister docs

- **TDC §4.2 ("Nodemailer does not work on Workers, full stop"):** SMTP
  `verify()` worked here (see §1).
- **TDC and Spire don't flag `Handlebars.compile`,** which fails on Workers.
  Both use it in `mailer.ts`.
- **Both treat the free plan as viable based on bundle size alone.** It isn't,
  because of the CPU limit and intermittent 1102s (see §1).
- **TDC §4.7's internal maintenance route** is only needed when the check's
  data layer isn't edge-compatible. It isn't needed with Supabase-JS.

---

## 7. If moving to Resend: delivery tracking (from Spire)

Spire built this, and TDC is getting the same design. Resend's free tier only
keeps its own delivery log for a short time. So each send is logged in our own
database, and a Resend webhook updates the log entry with the real outcome. Any
bounce or spam complaint also sends an alert to an admin. Not started.

**BHBC already has half of this.** `member_emails` (0046) logs every send
centrally: `mailer.ts` wraps every transporter's `sendMail` (`withSendLogging`
→ `logSend` → `email-log-supabase.ts`), and Admin → Logs → Member Emails shows
it. So **extend `member_emails` instead of adding a separate table** like
Spire's:

1. **Migration (next free number).** Add to `member_emails`:
   - `email_id text`: Resend's message id, used to match webhooks back to the
     row. Unique where not null; it's null for SMTP-era rows.
   - `delivery_status text`: `sent` / `delivered` / `bounced` / `complained`.
     Null for old rows and failed sends. Existing `success`/`error_message`
     still mean "did Resend accept it".
   - `status_updated_at timestamptz` (nullable).
   - `delivery_detail text` (nullable): the bounce reason or "marked as spam".

   `template_name`, `subject` and `email_address` already exist.

2. **Logging sends.** Once the transport is Resend's `emails.send()`, the
   central wrapper stays the only place logging happens. Capture the id that
   Resend returns, and write it with `delivery_status = 'sent'` in the same
   `logSend` insert. Don't add logging calls at individual call sites. Bulk
   loops (Friendlies, tea rota, admin bulk send, Availability) already go
   through the wrapper.

3. **Webhook: `app/api/webhooks/resend/route.ts`.**
   - **Verify the signature first.** Resend signs the Svix way. The headers
     are `svix-id`, `svix-timestamp` and `svix-signature`; the last holds
     space-separated `v1,<base64>` pairs. The signature is HMAC-SHA256 over
     `${svixId}.${svixTimestamp}.${rawBody}`, keyed with the base64-decoded
     secret after stripping its `whsec_` prefix. Compare with
     `crypto.timingSafeEqual`, and read the body with `await req.text()`
     before parsing it. Spire hand-rolled this with Node `crypto` rather than
     the `svix` package because of Workers bundle size. That limit applies
     here too if BHBC moves to Workers (see §2), so do the same.
   - **`email.delivered`:** set the matching row to `delivered`.
   - **`email.bounced` / `email.complained`:** set `bounced` or `complained`
     and `delivery_detail`. Then email an alert to a BHBC admin address with
     the original recipient, subject and reason. **The address is still to be
     decided; don't copy TDC's.**
   - **Real payload fields** (checked against Resend's docs): `data.email_id`,
     `data.to` (an array) and `data.subject`. For bounces only:
     `data.bounce.type`, `data.bounce.subType` and `data.bounce.message`.
     Complaints have no `bounce` object.
   - **No member flagging.** Spire sets a "check email" flag on the learner
     when their email bounces. BHBC doesn't need that: the webhook only updates
     the log row and sends the alert. A per-member bounce marker could be added
     later; 0046 retired the old `member_email_sent_status` flag.

4. **The gotcha that cost Spire days: auth middleware.** Spire's middleware
   matcher didn't exclude the webhook path. Every Resend call (server to
   server, no session cookie) was answered with a 307 redirect to `/login`
   before it reached the handler, and nothing logged an error. **BHBC's
   `proxy.ts` has the same problem.** Its matcher only excludes `api/auth`,
   `api/apply`, `api/unlock` and a few others, so add `api/webhooks` to the
   negative lookahead (or `isPublicRoute`) **before** testing anything. Also
   make sure the maintenance-mode and PIN-gate branches can't intercept it.
   Under Workers, `proxy.ts` becomes `middleware.ts` (§4 step 1) with the same
   matcher, so the exclusion carries over.

5. **Viewing the log.** No new page needed. Add Status (a colour-coded badge)
   and Detail columns to the existing Member Emails view in
   `app/admin/logs/page.tsx` / `app/api/admin/logs/route.ts`, which is already
   Admin-only.

6. **Before calling it done:**
   - Register the webhook in the Resend dashboard for `email.delivered`,
     `email.bounced` and `email.complained`, pointing at the deployed URL.
   - Set `RESEND_WEBHOOK_SECRET` (and `RESEND_API_KEY`) on the host: Vercel,
     or `wrangler secret` after the move.
   - Do a real send and a real bounce (to a known-bad address). Confirm the row
     appears on send, flips to `bounced` via the webhook, and the admin alert
     arrives. A clean build alone isn't enough.
