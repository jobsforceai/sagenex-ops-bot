'use client';
import { useEffect, useRef, useState } from 'react';
import { MarkdownView, CopyTextButton } from './markdown';

type Turn = { role: 'user' | 'model'; content: string };
type Event =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: any; isError?: boolean }
  | { type: 'done' };

type StreamItem =
  | { kind: 'user'; text: string }
  | { kind: 'model'; text: string }
  | { kind: 'tool'; name: string; args: any; result?: any; isError?: boolean; startedAt: number; endedAt?: number };

const previewArg = (args: any) => {
  if (!args) return '';
  // pick a short, useful one-line summary depending on tool
  if (args.command) return args.command.slice(0, 120);
  if (args.collection && args.filter)  return `${args.collection}  filter=${String(args.filter).slice(0, 90)}`;
  if (args.collection && args.pipeline) return `${args.collection}  pipeline=${String(args.pipeline).slice(0, 90)}`;
  if (args.collection) return args.collection;
  if (args.path) return args.path;
  if (args.glob) return `glob=${args.glob}`;
  try { return JSON.stringify(args).slice(0, 120); } catch { return ''; }
};

const summarizeResult = (result: any) => {
  if (!result) return '';
  if (typeof result === 'object') {
    if ('count' in result) return `${result.count} row${result.count === 1 ? '' : 's'}`;
    if ('files' in result) return `${result.files.length} files`;
    if ('exitCode' in result) {
      const dur = result.durationMs ? ` · ${result.durationMs}ms` : '';
      if (result.blocked) return `blocked${dur}`;
      return `exit ${result.exitCode}${dur}`;
    }
    if ('bytes' in result) return `${result.bytes} bytes`;
    if ('error' in result) return `error: ${String(result.error).slice(0, 80)}`;
  }
  return '';
};

function Spinner() {
  return (
    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-rose-400 border-t-transparent align-middle"></span>
  );
}

export default function ChatShell() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [nowTick, setNowTick] = useState(0); // re-renders for running timers
  const tailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { tailRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items, busy]);
  // Tick every 200ms while a tool is running so the "1.4s" counter updates live.
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNowTick(t => t + 1), 200);
    return () => clearInterval(id);
  }, [busy]);

  const activeTool = [...items].reverse().find((it) => it.kind === 'tool' && (it as any).result === undefined) as any;

  const send = async () => {
    const text = input.trim(); if (!text || busy) return;
    setInput(''); setBusy(true);
    setItems((x) => [...x, { kind: 'user', text }]);

    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, message: text }),
    });
    if (!res.ok || !res.body) {
      setItems((x) => [...x, { kind: 'model', text: `[error: HTTP ${res.status}]` }]); setBusy(false); return;
    }

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''; let finalText = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: Event; try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'tool_call') {
          setItems((x) => [...x, { kind: 'tool', name: evt.name, args: evt.args, startedAt: Date.now() }]);
        } else if (evt.type === 'tool_result') {
          setItems((x) => {
            const copy = [...x];
            for (let i = copy.length - 1; i >= 0; i--) {
              const cur = copy[i] as any;
              if (cur.kind === 'tool' && cur.name === evt.name && cur.result === undefined) {
                copy[i] = { ...cur, result: evt.result, isError: evt.isError, endedAt: Date.now() };
                return copy;
              }
            }
            return copy;
          });
        } else if (evt.type === 'text') {
          finalText += evt.text;
          setItems((x) => {
            const copy = [...x];
            const last = copy[copy.length - 1];
            if (last && last.kind === 'model') {
              copy[copy.length - 1] = { kind: 'model', text: last.text + evt.text };
            } else {
              copy.push({ kind: 'model', text: evt.text });
            }
            return copy;
          });
        }
      }
    }
    setHistory((h) => [...h, { role: 'user', content: text }, { role: 'model', content: finalText || '(no reply)' }]);
    setBusy(false);
  };

  const logout = async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.reload(); };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      <header className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <div>
          <h1 className="text-lg font-bold">Sagenex Ops Bot</h1>
          <p className="text-xs text-neutral-500">Read-only · Nova Pro (Bedrock)</p>
        </div>
        <button onClick={logout} className="text-xs text-neutral-400 hover:text-neutral-200">Sign out</button>
      </header>

      {/* Sticky live status bar — shows exactly what's running right now */}
      {busy && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-rose-700/40 bg-rose-950/30 px-3 py-2 text-xs">
          <Spinner />
          {activeTool ? (
            <div className="flex-1 truncate">
              <span className="font-mono font-bold text-rose-300">{activeTool.name}</span>{' '}
              <span className="text-neutral-400">{previewArg(activeTool.args)}</span>
            </div>
          ) : (
            <div className="flex-1 text-neutral-400">Thinking…</div>
          )}
          <span className="font-mono text-neutral-500">
            {activeTool?.startedAt ? `${((Date.now() - activeTool.startedAt) / 1000).toFixed(1)}s` : ''}
          </span>
        </div>
      )}

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-32">
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
            Ask anything about users, deposits, bonuses, sponsor trees, ledger, rewards, etc.
            Examples: <em>"U072 fresh business last 60 days"</em>, <em>"how many users qualified for 30L Mid?"</em>, <em>"show me U155 sponsor history"</em>.
            <br /><br />
            Every Mongo query and shell command the bot runs shows up below in real time — click any
            tool card to expand the args and full result.
          </div>
        )}

        {items.map((it, i) => {
          if (it.kind === 'user') {
            return <div key={i} className="ml-auto max-w-[85%] rounded-2xl bg-rose-600 px-4 py-2 text-sm text-white">{it.text}</div>;
          }
          if (it.kind === 'model') {
            return (
              <div key={i} className="group max-w-[95%] rounded-2xl bg-neutral-900 px-4 py-3 text-sm">
                <div className="prose prose-invert max-w-none text-sm">
                  <MarkdownView source={it.text} />
                </div>
                <div className="mt-2 flex justify-end opacity-0 transition group-hover:opacity-100">
                  <CopyTextButton text={it.text} />
                </div>
              </div>
            );
          }
          // tool card — animated when running
          const running = it.result === undefined;
          const dur = (it.endedAt ?? Date.now()) - it.startedAt;
          const ok = !running && !it.isError;
          const symbol = running ? '⋯' : it.isError ? '✗' : '✓';
          const color = running ? 'text-rose-300' : it.isError ? 'text-red-400' : 'text-emerald-400';
          return (
            <details key={i} className={`max-w-[90%] rounded-xl border ${running ? 'animate-pulse border-rose-700/40 bg-rose-950/20' : 'border-neutral-800 bg-neutral-950'} px-3 py-2 text-xs`} open={running}>
              <summary className={`flex cursor-pointer items-center gap-2 ${color}`}>
                {running ? <Spinner /> : <span>{symbol}</span>}
                <span className="font-mono font-bold">{it.name}</span>
                <span className="truncate text-neutral-400">{previewArg(it.args)}</span>
                <span className="ml-auto whitespace-nowrap font-mono text-neutral-500">
                  {running ? `${(dur / 1000).toFixed(1)}s · running` : `${dur}ms · ${summarizeResult(it.result)}`}
                </span>
              </summary>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="font-bold text-neutral-500">args</p>
                  <pre className="max-h-48 overflow-auto rounded bg-neutral-900 p-2 text-neutral-400">{JSON.stringify(it.args, null, 2)}</pre>
                </div>
                {!running && (
                  <div>
                    <p className="font-bold text-neutral-500">result</p>
                    <pre className="max-h-72 overflow-auto rounded bg-neutral-900 p-2 text-neutral-300">{JSON.stringify(it.result, null, 2).slice(0, 8000)}</pre>
                  </div>
                )}
              </div>
            </details>
          );
        })}
        <div ref={tailRef} />
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800 bg-neutral-950/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={busy ? 'Bot is working…' : 'Ask a question…  (Enter to send, Shift+Enter for newline)'}
                    disabled={busy}
                    rows={Math.min(12, Math.max(1, input.split('\n').length))}
                    className="max-h-[280px] min-h-[42px] flex-1 resize-y rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"/>
          <button onClick={send} disabled={!input.trim() || busy}
                  className="rounded-lg bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50">
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}
