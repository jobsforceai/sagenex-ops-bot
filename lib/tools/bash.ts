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
      cwd, env: { ...process.env, PATH: process.env.PATH || '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }, detached: true,
    });
    let killedByTimeout = false;
    const timer = setTimeout(() => {
      killedByTimeout = true;
      // Kill the whole process group so ts-node / child processes also die.
      try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
      try { child.kill('SIGKILL'); } catch {}
    }, TIMEOUT_MS);
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
      clearTimeout(timer);
      const lines = stderr.split('\n').filter(l => !/^npm warn/i.test(l));
      // Extract TSError / "Cannot find module" / specific error markers and float to top.
      const errorLines = lines.filter(l =>
        /TSError|error TS\d+|Cannot find module|MODULE_NOT_FOUND|ReferenceError|SyntaxError|Error:|Unhandled|Unable to compile/i.test(l)
      );
      const cleanStderr = errorLines.length
        ? ['===== ERROR SUMMARY =====', ...errorLines.slice(0, 10), '', '===== FULL STDERR =====', ...lines].join('\n').trim()
        : lines.join('\n').trim();
      const finalStderr = killedByTimeout
        ? `[KILLED after ${TIMEOUT_MS / 1000}s timeout — the command exceeded the bash sandbox limit. If your script is N+1 over users, rewrite it as a SINGLE aggregation pipeline instead of a per-user loop.]\n${cleanStderr}`
        : cleanStderr;
      resolve({ stdout, stderr: finalStderr, exitCode: killedByTimeout ? 124 : (code ?? -1), truncated, durationMs: Date.now() - started });
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: String(err), exitCode: -1, truncated, durationMs: Date.now() - started });
    });
  });
}
