/**
 * Sandboxed bash execution for the ops agent.
 *
 * Hard restrictions (string-match denylist + execution policy):
 *   - working dir is REPO_ROOT (the cloned read-only mirrors)
 *   - command runs in `sh -c` with a 30-second timeout
 *   - stdout/stderr capped at 100 KB
 *   - denylist matches block obvious write attempts: rm/mv/cp -i, redirection
 *     into the repo dirs, sed -i, mongoimport/mongorestore, npm install/run dev/run start,
 *     git push/commit/checkout/reset, curl|wget into files, package managers, sudo, etc.
 *
 * NOTE: The deeper safety guarantee is OS-level — the repo dirs are intended
 * to be `chmod -R a-w` so writes fail regardless of what the model tries.
 * The denylist is defence-in-depth, not the only barrier.
 */
import { spawn } from 'child_process';
import path from 'path';

const DENY_PATTERNS: RegExp[] = [
  /\brm\b\s+-/, /\bmv\b/, /\bcp\b.*-r/, /\bln\b\s+-s/,
  /\bsed\b[^|]*-i/, /\bawk\b[^|]*-i\b/, /\btee\b/, />\s*\S/, />>\s*\S/,
  /\bmongoimport\b/, /\bmongorestore\b/, /\bmongo(?:sh)?\b/,
  /\bnpm\b\s+(?:install|i\b|run\s+dev|start|publish)/, /\bpnpm\b\s+(?:install|add|dev|start)/,
  /\bgit\b\s+(?:push|commit|reset|checkout|clean|rebase)/,
  /\bcurl\b[^|]*-o\b/, /\bwget\b[^|]*-O\b/,
  /\bsudo\b/, /\bsu\b\s+-/, /\bdocker\b/, /\bkill\b/, /\bchmod\b/, /\bchown\b/,
  /\b(?:apt|brew|yum|apk)\b/,
];

const MAX_OUTPUT = 100_000;
const TIMEOUT_MS = 30_000;

export interface BashResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  blocked?: string;
  durationMs: number;
}

export async function runBash(command: string): Promise<BashResult> {
  for (const re of DENY_PATTERNS) {
    if (re.test(command)) {
      return { stdout: '', stderr: '', exitCode: -1, truncated: false, blocked: `Command blocked by denylist pattern: ${re}`, durationMs: 0 };
    }
  }
  const cwd = path.resolve(process.env.REPO_ROOT || './repos');
  const started = Date.now();
  return new Promise<BashResult>((resolve) => {
    const child = spawn('/bin/sh', ['-c', command], {
      cwd, env: { ...process.env, PATH: '/usr/local/bin:/usr/bin:/bin' }, timeout: TIMEOUT_MS,
    });
    let stdout = '', stderr = '', truncated = false;
    child.stdout.on('data', (b: Buffer) => {
      if (stdout.length >= MAX_OUTPUT) { truncated = true; return; }
      stdout += b.toString('utf8'); if (stdout.length > MAX_OUTPUT) { stdout = stdout.slice(0, MAX_OUTPUT); truncated = true; }
    });
    child.stderr.on('data', (b: Buffer) => {
      if (stderr.length >= MAX_OUTPUT) { truncated = true; return; }
      stderr += b.toString('utf8'); if (stderr.length > MAX_OUTPUT) { stderr = stderr.slice(0, MAX_OUTPUT); truncated = true; }
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? -1, truncated, durationMs: Date.now() - started });
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: String(err), exitCode: -1, truncated, durationMs: Date.now() - started });
    });
  });
}
