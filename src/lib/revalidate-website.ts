// src/lib/revalidate-website.ts
// Notifies the public bhbc-website to flush its ISR cache for a given page,
// right after an Admin > Website save — so editors never have to remember to
// do this manually (previously a documented manual curl in bhbc-website's
// CLAUDE.md, fine for a once-a-season edit but not for an everyday Admin UI).
//
// Never throws: a revalidation failure must not fail the save itself — the
// page just catches up on its next natural revalidate window instead.
//
// Requires WEBSITE_SITE_URL (the deployment to notify — use the actual
// preview URL for a staging deployment, since ISR cache is per-deployment)
// and WEBSITE_REVALIDATE_SECRET (same value as bhbc-website's
// REVALIDATE_SECRET) — silently skipped (with a warning) if either is unset.
//
// A staging/preview bhbc-website deployment also needs
// WEBSITE_VERCEL_PROTECTION_BYPASS set to that deployment's "Protection
// Bypass for Automation" secret (Vercel dashboard: bhbc-website project ->
// Settings -> Deployment Protection). Without it, Vercel's own Deployment
// Protection (Vercel Authentication) intercepts this request with a 401
// before it ever reaches bhbc-website's /api/revalidate code — that 401
// carries a `protection` field in its JSON body, distinct from a genuine
// REVALIDATE_SECRET mismatch. Production typically isn't protected this way,
// so this var is normally only needed for the Preview environment.

export async function revalidateWebsitePath(path: string): Promise<void> {
  const siteUrl = process.env.WEBSITE_SITE_URL;
  const secret = process.env.WEBSITE_REVALIDATE_SECRET;
  const bypassSecret = process.env.WEBSITE_VERCEL_PROTECTION_BYPASS;

  if (!siteUrl || !secret) {
    console.warn(`[revalidateWebsite] Skipped revalidating ${path} — WEBSITE_SITE_URL/WEBSITE_REVALIDATE_SECRET not set`);
    return;
  }

  try {
    const res = await fetch(`${siteUrl.replace(/\/$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {}),
      },
      body: JSON.stringify({ secret, path }),
    });
    if (!res.ok) {
      const body = await res.text();
      const isDeploymentProtection = res.status === 401 && body.includes('"protection"');
      if (isDeploymentProtection) {
        console.error(
          `[revalidateWebsite] Blocked by Vercel Deployment Protection on ${siteUrl} — set WEBSITE_VERCEL_PROTECTION_BYPASS ` +
          `to that deployment's Protection Bypass for Automation secret (bhbc-website Vercel project -> Settings -> Deployment Protection).`
        );
      } else {
        console.error(`[revalidateWebsite] Failed to revalidate ${path}: ${res.status} ${body}`);
      }
    }
  } catch (err) {
    console.error(`[revalidateWebsite] Failed to revalidate ${path}:`, err);
  }
}
