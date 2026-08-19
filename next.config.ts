import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  cacheOnFrontEndNav: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
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
