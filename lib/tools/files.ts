/**
 * File-read / scratch-write tools.
 *
 *   read_file  — any path INSIDE the cloned repo roots.
 *   write_file — only into /scratch/ inside REPO_ROOT (NEVER inside the
 *                 mirrored code). The model uses this to scaffold its own
 *                 throwaway scripts and then `bash` them.
 */
import fs from 'fs/promises';
import path from 'path';

const repoRoot = () => path.resolve(process.env.REPO_ROOT || './repos');
const scratchRoot = () => path.resolve(repoRoot(), 'scratch');

const insideRoot = (root: string, p: string) => {
  const abs = path.resolve(root, p);
  return abs.startsWith(root + path.sep) || abs === root ? abs : null;
};

export async function readFile(relPath: string): Promise<{ path: string; bytes: number; content: string }> {
  const abs = insideRoot(repoRoot(), relPath);
  if (!abs) throw new Error(`Path escapes REPO_ROOT: ${relPath}`);
  const buf = await fs.readFile(abs);
  const max = 200_000;
  if (buf.byteLength > max) {
    return { path: relPath, bytes: buf.byteLength, content: buf.subarray(0, max).toString('utf8') + `\n\n[...truncated at ${max} bytes, file is ${buf.byteLength}]` };
  }
  return { path: relPath, bytes: buf.byteLength, content: buf.toString('utf8') };
}

export async function writeScratch(relPath: string, content: string): Promise<{ path: string; bytes: number }> {
  await fs.mkdir(scratchRoot(), { recursive: true });
  const safeName = relPath.replace(/^[/\\]+/, '').replace(/\.\./g, '_');
  const abs = insideRoot(scratchRoot(), safeName);
  if (!abs) throw new Error(`Scratch path escapes scratch root: ${relPath}`);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
  return { path: path.relative(repoRoot(), abs), bytes: Buffer.byteLength(content, 'utf8') };
}

export async function listFiles(glob?: string): Promise<{ files: string[] }> {
  // Minimal listing — just a recursive ls scoped to the repo root. Real
  // search/glob happens via the bash tool (`rg`, `find`).
  const root = repoRoot();
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > 4) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(root, full);
      if (e.isDirectory()) { out.push(rel + '/'); await walk(full, depth + 1); }
      else out.push(rel);
    }
  }
  await walk(root, 0);
  const filtered = glob ? out.filter(f => f.includes(glob)) : out;
  return { files: filtered.slice(0, 500) };
}
