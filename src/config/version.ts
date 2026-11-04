// src/config/version.ts
// Application version information
// Update this file before deploying using: npm run update-version

export const version = {
  number: '2.9.2',
  buildDate: '2026-11-04', // This gets auto-updated by the update-version script
} as const;

// Set on Vercel preview builds only (next.config.ts) — the package.json previewVersion.
const previewVersion = process.env.NEXT_PUBLIC_PREVIEW_VERSION || '';

export function getVersionString(): string {
  return previewVersion ? `v${version.number} · preview ${previewVersion}` : `v${version.number}`;
}

export function getFullVersionString(): string {
  return `${getVersionString()} (${version.buildDate})`;
}
