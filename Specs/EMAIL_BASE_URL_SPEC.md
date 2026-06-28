# Spec: Centralise the email base URL (portable)

Portable change for any repo derived from this codebase. Makes every email link use
**one** base-URL helper that prefers the current request's host, with env fallbacks — so
links always match the domain the user is on, and there's a single place to reason about it.

## Problem this fixes
Emails built their base URL inconsistently:
- Some routes used the **request host** inline: `` `${request.nextUrl.protocol}//${request.nextUrl.host}` ``
- Some email modules used a **local `getAppUrl()` / `getPortalUrl()`** reading
  `NEXT_PUBLIC_APP_URL` → `NEXTAUTH_URL` → a (often stale) hardcoded default.

Result: when an env var pointed at the wrong domain (e.g. the `*.vercel.app` default instead
of the custom domain), some emails linked to a domain the member wasn't logged into — they'd
hit the login page and it looked broken. The request-host routes were fine; the env-based ones
were not. Inconsistent and a foot-gun.

## Solution: one shared helper

Create `src/lib/app-url.ts`:

```ts
// src/lib/app-url.ts
// Single source of truth for the app's base URL when building links (emails, etc.).
// Preference: 1) current request host  2) NEXT_PUBLIC_APP_URL  3) NEXTAUTH_URL  4) default.
import { headers } from 'next/headers';

export async function getAppUrl(): Promise<string> {
  try {
    const h = await headers();                                  // Next 15/16: headers() is async
    const host = h.get('x-forwarded-host') || h.get('host');
    if (host) {
      const proto = h.get('x-forwarded-proto') || 'https';
      return `${proto}://${host}`;
    }
  } catch {
    // Not in a request context (e.g. a cron job) — fall through to env config.
  }
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'https://YOUR-PRODUCTION-DOMAIN'        // <-- set each repo's real production domain
  );
}
```

- **Next 15/16:** `headers()` is **async** → `getAppUrl()` is async → callers use `await`. Email
  send functions are already async, so this is a drop-in.
- **Next 14:** `headers()` is **sync** — you may drop `async/await` here and make `getAppUrl()`
  return `string`. Then callers don't await. Pick whichever matches the repo's Next version.

## Replace every other base-URL derivation with it

Find them:
```
grep -rn "nextUrl.protocol}//\${request.nextUrl.host\|function getAppUrl\|function getPortalUrl\|NEXT_PUBLIC_APP_URL\|NEXTAUTH_URL" src/ app/ --include=*.ts | grep -v "src/lib/app-url.ts"
```

Then:
1. **Inline request-host** → replace the whole template literal with `await getAppUrl()`:
   ```ts
   const appUrl = `${request.nextUrl.protocol}//${request.nextUrl.host}`;  // before
   const appUrl = await getAppUrl();                                       // after
   ```
   Add `import { getAppUrl } from '@/lib/app-url';` to the file. (The handler is already async.)
2. **Local `getAppUrl()` / `getPortalUrl()`** env-based functions → delete them, import the
   shared one, and `await` it at the call sites.
3. Email functions that take an `appUrl` **param** (e.g. some friendlies-style senders) don't
   change — just have the *calling route* derive it with `await getAppUrl()` and pass it.

## Config (per deployment / per repo)
- Set **`NEXT_PUBLIC_APP_URL`** to the production custom domain (e.g. `https://portal.example.com`).
- Set **`NEXTAUTH_URL`** to the same (a `*.vercel.app` value here is a smell — it's the auth
  canonical URL).
- **`NEXT_PUBLIC_*` is inlined at build time** → changing it needs a **redeploy** to take effect.
- The hardcoded default in `app-url.ts` is the last-resort fallback; set it to the repo's own
  production domain.

## Gotchas
- `headers()` only works inside a request context (route handler / server component). Outside
  one it throws — the `try/catch` falls back to env. That's intended.
- This does **not** change email *send* mechanics — keep bulk sends sequential via the pooled
  transporter (separate rule), never `Promise.all`.
- Don't reintroduce inline `request.nextUrl.host` later; route everything through `getAppUrl()`.

## Verify
- `grep` above returns nothing outside `app-url.ts`.
- `npx tsc --noEmit` clean; `next build` clean.
- Trigger an email locally and confirm the link host matches the request domain (and, when
  sent from a non-request context, the `NEXT_PUBLIC_APP_URL` value).
```
