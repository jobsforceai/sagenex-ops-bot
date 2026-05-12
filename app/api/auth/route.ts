/**
 * Auth endpoint with failed-login lockout to prevent brute-force.
 *   - 5 failed attempts per IP per hour → 1-hour lockout
 *   - Successful login clears the counter
 */
import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookie, clearAuthCookie } from '../../../lib/auth';
import { recordLoginFailure, isLoginLocked, clearLoginFailures, getIp } from '../../../lib/rate-limit';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60 * 60 * 1000; // 1 hour

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const locked = isLoginLocked(ip);
  if (locked.locked) {
    return NextResponse.json(
      { ok: false, error: `Too many failed attempts. Try again after ${locked.until.toISOString()}.` },
      { status: 429 },
    );
  }
  const { password } = await req.json().catch(() => ({}));
  const ok = await setAuthCookie(password);
  if (!ok) {
    recordLoginFailure(ip, MAX_ATTEMPTS, LOCK_MS);
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  clearLoginFailures(ip);
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
