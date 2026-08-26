import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
  // next-pwa's default runtimeCaching caches every same-origin /api/* GET with
  // NetworkFirst (cacheName "apis", up to 24h, falling back to the stale cached
  // response whenever the network is slow >10s or briefly interrupted — exactly
  // the kind of hiccup a fresh deploy causes). That's silently at odds with
  // vercel.json, which already tells the CDN never to cache /api/* responses.
  // Money-affecting data (bar wallet balances, product prices, sales) must never
  // be served stale, so override just the "apis" cache entry to NetworkOnly —
  // extendDefaultRuntimeCaching keeps every other default (fonts/images/JS/CSS)
  // intact; only entries sharing a cacheName with a default entry replace it.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ sameOrigin, url: { pathname } }) => sameOrigin && pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        method: "GET",
        options: {
          cacheName: "apis",
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  // handlebars registers require.extensions internally (used for email templating,
  // server-only) — webpack doesn't support that pattern and warns on every recompile.
  // Excluding it from bundling avoids the warning entirely: Node resolves it directly
  // at runtime instead, which handles require.extensions natively. serverExternalPackages
  // is honoured by both Turbopack (dev) and webpack (build).
  serverExternalPackages: ["handlebars"],

  // Next 16 runs `next dev` on Turbopack by default. next-pwa injects a webpack config
  // (only needed for the production `next build --webpack`; PWA is disabled in dev), so
  // acknowledge Turbopack explicitly here to silence the "webpack config, no turbopack
  // config" warning. Nothing is lost in dev.
  turbopack: {},
};

export default withPWA(nextConfig);
