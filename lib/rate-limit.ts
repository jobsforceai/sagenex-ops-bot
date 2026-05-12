/**
 * In-memory IP-based rate limiter. Lost on process restart (acceptable for an
 * internal tool — Render's free-tier sleeps reset it anyway, and abuse spikes
 * generally don't survive 15-minute idle gaps).
 *
 * Each `limit({ key, max, windowMs })` call is a sliding-window check.
 */
interface Bucket { timestamps: number[]; }
const buckets = new Map<string, Bucket>();

export interface LimitConfig { key: string; max: number; windowMs: number; }

export function check(cfg: LimitConfig): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - cfg.windowMs;
  const b = buckets.get(cfg.key) || { timestamps: [] };
  // Drop timestamps outside the window
  b.timestamps = b.timestamps.filter(t => t > cutoff);
  if (b.timestamps.length >= cfg.max) {
    const oldest = b.timestamps[0];
    const retryAfterSec = Math.ceil((oldest + cfg.windowMs - now) / 1000);
    return { ok: false, retryAfterSec };
  }
  b.timestamps.push(now);
  buckets.set(cfg.key, b);
  return { ok: true };
}

/** For failed logins — increments only on failure. */
const failures = new Map<string, { count: number; lastAt: number; lockUntil: number }>();
export function recordLoginFailure(ip: string, maxAttempts: number, lockMs: number) {
  const now = Date.now();
  const f = failures.get(ip) || { count: 0, lastAt: 0, lockUntil: 0 };
  if (now - f.lastAt > lockMs) f.count = 0; // reset window
  f.count += 1; f.lastAt = now;
  if (f.count >= maxAttempts) f.lockUntil = now + lockMs;
  failures.set(ip, f);
}
export function isLoginLocked(ip: string): { locked: false } | { locked: true; until: Date } {
  const f = failures.get(ip);
  if (!f) return { locked: false };
  if (Date.now() < f.lockUntil) return { locked: true, until: new Date(f.lockUntil) };
  return { locked: false };
}
export function clearLoginFailures(ip: string) { failures.delete(ip); }

/** Extract a stable IP key from the request. Renders behind Render's edge. */
export function getIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}
