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
  // at runtime instead, which handles require.extensions natively.
  serverExternalPackages: ["handlebars"],
};

export default withPWA(nextConfig);
