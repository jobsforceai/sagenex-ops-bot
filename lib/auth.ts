import { cookies } from 'next/headers';

const COOKIE_NAME = 'ops_bot_session';

export async function isAuthed(): Promise<boolean> {
  const c = await cookies();
  return c.get(COOKIE_NAME)?.value === process.env.OPS_BOT_PASSWORD;
}

export async function setAuthCookie(password: string): Promise<boolean> {
  if (!process.env.OPS_BOT_PASSWORD || password !== process.env.OPS_BOT_PASSWORD) return false;
  const c = await cookies();
  c.set(COOKIE_NAME, password, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 7,
    path: '/',
  });
  return true;
}

export async function clearAuthCookie() {
  const c = await cookies();
  c.delete(COOKIE_NAME);
}
