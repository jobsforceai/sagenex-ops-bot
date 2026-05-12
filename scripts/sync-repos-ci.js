#!/usr/bin/env node
/**
 * CI-friendly variant of sync-repos.js. Used at build time on Render.
 *
 * Instead of rsync from local Mac paths, this clones the three Sagenex repos
 * from GitHub using GH_TOKEN. Skips silently if GH_TOKEN is absent (local dev
 * uses scripts/sync-repos.js instead).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.log('[sync-repos-ci] GH_TOKEN not set; skipping. Use scripts/sync-repos.js for local dev.');
  process.exit(0);
}

const REPOS = [
  { name: 'sagenex-backend',  ghPath: 'jobsforceai/sagenex-backend',  installDeps: true  },
  { name: 'sagenex-frontend', ghPath: 'jobsforceai/sagenex-frontend', installDeps: false },
  { name: 'sagenex-user',     ghPath: 'jobsforceai/sagenex-user',     installDeps: false },
];

const root = path.resolve(__dirname, '..', 'repos');
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(path.resolve(__dirname, '..', 'repos', 'sagenex-backend', 'scratch'), { recursive: true });

for (const r of REPOS) {
  const dst = path.join(root, r.name);
  console.log(`[sync-repos-ci] Cloning ${r.ghPath}...`);
  try {
    if (fs.existsSync(dst)) execSync(`rm -rf "${dst}"`);
    execSync(`git clone --depth 1 https://${TOKEN}@github.com/${r.ghPath}.git "${dst}"`, { stdio: 'inherit' });
    if (r.installDeps) {
      console.log(`[sync-repos-ci] Installing deps for ${r.name}...`);
      execSync('pnpm install --ignore-scripts --prod=false', { cwd: dst, stdio: 'inherit' });
    }
    console.log(`[sync-repos-ci]  -> ${dst}`);
  } catch (e) {
    console.error(`[sync-repos-ci] FAILED ${r.name}: ${e.message}`);
  }
}
console.log('[sync-repos-ci] Done.');
