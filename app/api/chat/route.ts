/**
 * Streaming chat endpoint. Receives the full conversation history + the new
 * user message, drives the agent loop, streams JSON events back to the UI.
 *
 * Wire format (one JSON object per line):
 *   { "type": "tool_call",   "name": "...", "args": {...} }
 *   { "type": "tool_result", "name": "...", "result": {...} }
 *   { "type": "text",        "text": "..." }
 *   { "type": "done" }
 */
import { NextRequest } from 'next/server';
import { runAgent, ChatTurn } from '../../../lib/agent';
import { isAuthed } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return new Response('Unauthorized', { status: 401 });
  const { history = [], message } = (await req.json()) as { history?: ChatTurn[]; message: string };
  if (!message || typeof message !== 'string') return new Response('message required', { status: 400 });

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
