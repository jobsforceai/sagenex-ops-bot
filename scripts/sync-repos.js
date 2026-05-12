#!/usr/bin/env node
/**
 * Pulls master of all three Sagenex repos into REPO_ROOT/repos/*, refreshes
 * them to be read-only (chmod -R a-w), and ensures REPO_ROOT/scratch/ exists
 * and is writable. Idempotent.
 *
 * Run by hand or hook to a cron: `node scripts/sync-repos.js`.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOS = [
  { name: 'sagenex-backend',  src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-backend' },
  { name: 'sagenex-frontend', src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-frontend' },
  { name: 'sagenex-user',     src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-user' },
];

const root = path.resolve(process.env.REPO_ROOT || path.join(__dirname, '..', 'repos'));
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(path.join(root, '..', 'scratch'), { recursive: true });

for (const r of REPOS) {
  const dst = path.join(root, r.name);
  console.log(`Syncing ${r.name}…`);
  // Use rsync to mirror (excluding node_modules, .next, .git is small enough to include).
  try {
    // ensure writable before re-sync
    execSync(`chmod -R u+w "${dst}" 2>/dev/null || true`);
    execSync(`rsync -a --delete --exclude node_modules --exclude .next --exclude dist "${r.src}/" "${dst}/"`, { stdio: 'inherit' });
    execSync(`chmod -R a-w "${dst}"`);
    console.log(`  → ${dst} (read-only)`);
  } catch (e) {
    console.error(`  failed: ${e.message}`);
  }
}
console.log('Done.');
