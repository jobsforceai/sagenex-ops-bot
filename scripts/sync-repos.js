#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPOS = [
  { name: 'sagenex-backend',  src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-backend',  withNodeModules: true  },
  { name: 'sagenex-frontend', src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-frontend', withNodeModules: false },
  { name: 'sagenex-user',     src: '/Users/abhinayreddy/Desktop/sagenex-all/sgx/sagenex-user',     withNodeModules: false },
];

const root = path.resolve(process.env.REPO_ROOT || path.join(__dirname, '..', 'repos'));
const repoRoot = path.basename(root) === 'sagenex-ops-bot' ? path.join(root, 'repos') : root;
fs.mkdirSync(repoRoot, { recursive: true });
fs.mkdirSync(path.join(path.dirname(repoRoot), 'scratch'), { recursive: true });

for (const r of REPOS) {
  const dst = path.join(repoRoot, r.name);
  console.log('Syncing ' + r.name + ' (node_modules: ' + r.withNodeModules + ')...');
  try {
    execSync('chmod -R u+w "' + dst + '" 2>/dev/null || true');
    // 1. Source-only sync (always, read-only after).
    execSync('rsync -a --delete --exclude node_modules --exclude .next --exclude dist "' + r.src + '/" "' + dst + '/"', { stdio: 'inherit' });
    // 2. For backend, also pull node_modules with -L so pnpm symlinks become real files. Keep writable for ts-node cache.
    if (r.withNodeModules) {
      execSync('rsync -aL --delete "' + r.src + '/node_modules/" "' + path.join(dst, 'node_modules') + '/"', { stdio: 'inherit' });
    }
    console.log('  -> ' + dst);
  } catch (e) {
    console.error('  failed: ' + e.message);
  }
}
console.log('Done.');
