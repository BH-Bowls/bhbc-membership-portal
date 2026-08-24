// scripts/release.js
// Full release flow: bump version, sync src/config/version.ts, commit, tag, and push.
//
// Replaces the old shell chain (npm version && npm run update-version && git commit
// --amend && node scripts/git-push-release.js). That chain had a real bug, confirmed
// on three separate releases (v2.0.3, v2.1.0, v2.2.0): `npm version` creates the tag
// pointing at the commit it just made, but the following --amend (needed to fold in
// version.ts, which can only be generated *after* npm version has bumped
// package.json) changes the commit hash — orphaning the tag at a dangling,
// unreachable pre-amend commit every single time. Fixed here by never amending at
// all: bump package.json first with --no-git-tag-version (no commit/tag yet),
// regenerate version.ts from that, then make one commit and one tag together once
// everything is in its final state.
//
// Usage: node scripts/release.js <patch|minor|major>

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

const bumpType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/release.js <patch|minor|major>');
  process.exit(1);
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function readVersion() {
  const packagePath = join(__dirname, '..', 'package.json');
  return JSON.parse(readFileSync(packagePath, 'utf8')).version;
}

try {
  // 1. Bump package.json + package-lock.json only — no commit, no tag yet.
  run(`npm version ${bumpType} --no-git-tag-version`);

  // 2. Regenerate src/config/version.ts from the now-bumped package.json.
  run('npm run update-version');

  const version = readVersion();
  const tag = `v${version}`;

  // 3. One commit with everything the bump touched — nothing left to amend later.
  run('git add package.json package-lock.json src/config/version.ts');
  run(`git commit -m "${version}"`);

  // 4. Tag the commit that actually has everything in it.
  run(`git tag -f ${tag}`);

  // 5. Push branch, then just this tag (not --tags, which would force-push every
  // tag in the repo regardless of whether it's related to this release).
  console.log(`📦 Pushing release ${tag}...`);
  run('git push --force-with-lease');
  run(`git push origin ${tag} --force`);

  console.log(`✅ Successfully released ${tag}`);
} catch (error) {
  console.error('❌ Release failed:', error.message);
  process.exit(1);
}
