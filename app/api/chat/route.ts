/**
 * Streaming chat endpoint with three abuse safeguards layered in:
 *
 *   1. Cookie auth gate (existing).
 *   2. Bot-shape check on user-agent — curl / wget / unknown UAs rejected.
 *   3. Sliding-window rate limit per IP:
 *        - 20 messages / hour
 *        - 100 messages / day
 *   4. Audit log: every request (success or block) → opsbot_audit collection.
 *
 * The limits assume a few real admins; if you onboard more people, tune the
 * numbers in this file.
 */
import { NextRequest } from 'next/server';
import { runAgent, ChatTurn } from '../../../lib/agent';
import { isAuthed } from '../../../lib/auth';
import { check, getIp } from '../../../lib/rate-limit';
import { looksLikeBot } from '../../../lib/bot-detect';
import { logChat } from '../../../lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const PER_HOUR = 20;
const PER_DAY = 100;

export async function POST(req: NextRequest) {
  const ip = getIp(req);
  const ua = req.headers.get('user-agent') || '';

  // 1. Auth
  if (!(await isAuthed())) {
    void logChat({ at: new Date(), ip, userAgent: ua, messagePreview: '', historyLength: 0, outcome: 'unauthorized' });
    return new Response('Unauthorized', { status: 401 });
  }

  // 2. Bot heuristic
  const botCheck = looksLikeBot(req);
  if (botCheck.bot) {
    void logChat({ at: new Date(), ip, userAgent: ua, messagePreview: botCheck.reason || '', historyLength: 0, outcome: 'bot_detected' });
    return new Response('Bot-like request rejected.', { status: 403 });
  }

  // 3. Rate limit
  const hour = check({ key: `chat:${ip}:hour`, max: PER_HOUR, windowMs: 60 * 60 * 1000 });
  if (!hour.ok) {
    void logChat({ at: new Date(), ip, userAgent: ua, messagePreview: '', historyLength: 0, outcome: 'rate_limited' });
    return new Response(`Rate limit: ${PER_HOUR}/hour. Retry in ${hour.retryAfterSec}s.`,
      { status: 429, headers: { 'Retry-After': String(hour.retryAfterSec) } });
  }
  const day = check({ key: `chat:${ip}:day`, max: PER_DAY, windowMs: 24 * 60 * 60 * 1000 });
  if (!day.ok) {
    void logChat({ at: new Date(), ip, userAgent: ua, messagePreview: '', historyLength: 0, outcome: 'rate_limited' });
    return new Response(`Daily rate limit: ${PER_DAY}/day. Retry in ${day.retryAfterSec}s.`,
      { status: 429, headers: { 'Retry-After': String(day.retryAfterSec) } });
  }

  const { history = [], message } = (await req.json()) as { history?: ChatTurn[]; message: string };
  if (!message || typeof message !== 'string') return new Response('message required', { status: 400 });

  void logChat({ at: new Date(), ip, userAgent: ua, messagePreview: message.slice(0, 200), historyLength: history.length, outcome: 'ok' });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runAgent(history, message)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        }
      } catch (e: any) {
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', text: `ERROR: ${e?.message || e}` }) + '\n'));
        controller.enqueue(encoder.encode(JSON.stringify({ type: 'done' }) + '\n'));
      } finally { controller.close(); }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' } });
}
