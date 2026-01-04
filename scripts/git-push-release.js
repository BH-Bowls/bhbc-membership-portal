// scripts/git-push-release.js
// Pushes the release commit and tags to the remote repository
// This script is called by the release:* npm scripts after creating a version commit

const { execSync } = require('child_process');
const { readFileSync } = require('fs');
const { join } = require('path');

// Read the current version from package.json
const packagePath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const version = packageJson.version;

console.log(`📦 Pushing release v${version}...`);

try {
  // Force update the tag to point to the current commit
  console.log(`🏷️  Tagging commit as v${version}...`);
  execSync(`git tag -f ${version}`, { stdio: 'inherit' });

  // Push the commit to the remote
  console.log('⬆️  Pushing commit to remote...');
  execSync('git push --force-with-lease', { stdio: 'inherit' });

  // Push the tags to the remote
  console.log('🏷️  Pushing tags to remote...');
  execSync('git push --tags --force', { stdio: 'inherit' });

  console.log(`✅ Successfully released v${version}`);
} catch (error) {
  console.error('❌ Failed to push release:', error.message);
  process.exit(1);
}
