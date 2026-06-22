// src/config/version.ts
// Application version information
// Update this file before deploying using: npm run update-version

export const version = {
  number: '1.15.0',
  buildDate: '2026-06-22', // This gets auto-updated by the update-version script
} as const;

export function getVersionString(): string {
  return `v${version.number}`;
}

export function getFullVersionString(): string {
  return `v${version.number} (${version.buildDate})`;
}
