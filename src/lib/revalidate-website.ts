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

export async function revalidateWebsitePath(path: string): Promise<void> {
  const siteUrl = process.env.WEBSITE_SITE_URL;
  const secret = process.env.WEBSITE_REVALIDATE_SECRET;

  if (!siteUrl || !secret) {
    console.warn(`[revalidateWebsite] Skipped revalidating ${path} — WEBSITE_SITE_URL/WEBSITE_REVALIDATE_SECRET not set`);
    return;
  }

  try {
    const res = await fetch(`${siteUrl.replace(/\/$/, '')}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, path }),
    });
    if (!res.ok) {
      console.error(`[revalidateWebsite] Failed to revalidate ${path}: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error(`[revalidateWebsite] Failed to revalidate ${path}:`, err);
  }
}
