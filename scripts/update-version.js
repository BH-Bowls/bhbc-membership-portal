// scripts/update-version.js
// Syncs version from package.json to src/config/version.ts

const fs = require('fs');
const path = require('path');

// Read package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const version = packageJson.version;
const buildDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

// Generate version.ts content
const versionFileContent = `// src/config/version.ts
// Application version information
// Update this file before deploying using: npm run update-version

export const version = {
  number: '${version}',
  buildDate: '${buildDate}', // This gets auto-updated by the update-version script
} as const;

export function getVersionString(): string {
  return \`v\${version.number}\`;
}

export function getFullVersionString(): string {
  return \`v\${version.number} (\${version.buildDate})\`;
}
`;

// Write to src/config/version.ts
const versionFilePath = path.join(__dirname, '..', 'src', 'config', 'version.ts');
fs.writeFileSync(versionFilePath, versionFileContent, 'utf8');

console.log(`✓ Version updated to ${version} (build date: ${buildDate})`);
