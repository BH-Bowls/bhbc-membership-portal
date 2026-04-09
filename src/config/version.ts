// src/config/version.ts
// Application version information
// Update this file before deploying using: npm run update-version

export const version = {
  number: '1.6.9',
  buildDate: '2026-04-09', // This gets auto-updated by the update-version script
} as const;

export function getVersionString(): string {
  return `v${version.number}`;
}

export function getFullVersionString(): string {
  return `v${version.number} (${version.buildDate})`;
}
