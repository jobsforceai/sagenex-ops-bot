'use client';
import { useEffect, useRef, useState } from 'react';

type Turn = { role: 'user' | 'model'; content: string };
type Event =
  | { type: 'text'; text: string }
  | { type: 'tool_call'; name: string; args: any }
  | { type: 'tool_result'; name: string; result: any; isError?: boolean }
  | { type: 'done' };

type StreamItem =
  | { kind: 'user'; text: string }
  | { kind: 'model'; text: string }
  | { kind: 'tool'; name: string; args: any; result?: any; isError?: boolean };

export default function ChatShell() {
  const [items, setItems] = useState<StreamItem[]>([]);
  const [history, setHistory] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);

  useEffect(() => { tailRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [items, busy]);

  const send = async () => {
    const text = input.trim(); if (!text || busy) return;
    setInput(''); setBusy(true);
    setItems((x) => [...x, { kind: 'user', text }]);

    const res = await fetch('/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ history, message: text }),
    });
    if (!res.ok || !res.body) { setItems((x) => [...x, { kind: 'model', text: `[error: HTTP ${res.status}]` }]); setBusy(false); return; }

    const reader = res.body.getReader(); const decoder = new TextDecoder(); let buf = ''; let finalText = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n'); buf = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let evt: Event; try { evt = JSON.parse(line); } catch { continue; }
        if (evt.type === 'tool_call') setItems((x) => [...x, { kind: 'tool', name: evt.name, args: evt.args }]);
        else if (evt.type === 'tool_result') setItems((x) => {
          const copy = [...x];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i].kind === 'tool' && (copy[i] as any).name === evt.name && (copy[i] as any).result === undefined) {
              copy[i] = { ...(copy[i] as any), result: evt.result, isError: evt.isError }; return copy;
            }
          }
          return copy;
        });
        else if (evt.type === 'text') { finalText += evt.text; setItems((x) => [...x, { kind: 'model', text: evt.text }]); }
      }
    }
    setHistory((h) => [...h, { role: 'user', content: text }, { role: 'model', content: finalText || '(no reply)' }]);
    setBusy(false);
  };

  const logout = async () => { await fetch('/api/auth', { method: 'DELETE' }); window.location.reload(); };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col p-4">
      <header className="flex items-center justify-between border-b border-neutral-800 pb-3">
        <h1 className="text-lg font-bold">Sagenex Ops Bot</h1>
        <button onClick={logout} className="text-xs text-neutral-400 hover:text-neutral-200">Sign out</button>
      </header>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto pb-32">
        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-neutral-800 p-6 text-sm text-neutral-400">
            Ask anything about users, deposits, bonuses, sponsor trees, ledger, rewards, etc.
            Examples: <em>"U072 fresh business last 60 days"</em>, <em>"how many users qualified for 30L Mid?"</em>, <em>"show me U155 sponsor history"</em>.
          </div>
        )}
        {items.map((it, i) => (
          <div key={i}>
            {it.kind === 'user' && (
              <div className="ml-auto max-w-[85%] rounded-2xl bg-rose-600 px-4 py-2 text-sm text-white">{it.text}</div>
            )}
            {it.kind === 'model' && (
              <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl bg-neutral-900 px-4 py-3 text-sm">{it.text}</div>
            )}
            {it.kind === 'tool' && (
              <details className="max-w-[90%] rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs">
                <summary className={`cursor-pointer ${it.isError ? 'text-red-400' : 'text-emerald-400'}`}>
                  {it.isError ? '✗' : '⚙'} {it.name}{it.result === undefined ? '  (running…)' : ''}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto text-neutral-400">{JSON.stringify(it.args, null, 2)}</pre>
                {it.result !== undefined && (
                  <pre className="mt-2 max-h-64 overflow-auto text-neutral-300">{JSON.stringify(it.result, null, 2).slice(0, 8000)}</pre>
                )}
              </details>
            )}
          </div>
        ))}
        <div ref={tailRef} />
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-neutral-800 bg-neutral-950/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={busy ? 'Bot is working…' : 'Ask a question…'} disabled={busy} rows={1}
                    className="min-h-[42px] flex-1 resize-none rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-500"/>
          <button onClick={send} disabled={!input.trim() || busy}
                  className="rounded-lg bg-rose-600 px-4 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50">
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>
    </main>
  );
}
