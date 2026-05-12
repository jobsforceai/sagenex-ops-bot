import { NextRequest, NextResponse } from 'next/server';
import { setAuthCookie, clearAuthCookie } from '../../../lib/auth';

export async function POST(req: NextRequest) {
  const { password } = await req.json().catch(() => ({}));
  const ok = await setAuthCookie(password);
  if (!ok) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
