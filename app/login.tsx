'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
    if (!res.ok) { setErr('Wrong password.'); setBusy(false); return; }
    window.location.reload();
  };
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6 space-y-4">
        <h1 className="text-xl font-bold">Sagenex Ops Bot</h1>
        <p className="text-sm text-neutral-400">Internal · read-only</p>
        <input type="password" autoFocus placeholder="Admin password" value={pw} onChange={(e) => setPw(e.target.value)}
               className="w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-500"/>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button type="submit" disabled={busy || !pw}
                className="w-full rounded-md bg-rose-600 px-3 py-2 text-sm font-bold text-white hover:bg-rose-500 disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
