# Sagenex Ops Bot

A standalone, read-only AI agent for the Sagenex operations team. Built
on Next.js + Gemini 2.5 Pro with function-calling.

## Why

Ops team has recurring questions like _"U072 fresh business in 60 days?"_
or _"how many users qualified for 30L Mid?"_. Instead of pinging eng for
each one, they ask the bot. The bot writes its own Mongo queries / shell
commands / scratch Node scripts and answers from live data.

## Architecture

```
 ┌─────────────────┐    ┌─────────────────────────────────────────┐
 │  Admin browser  │ ── │  Next.js (this app)                     │
 └─────────────────┘    │   ├── /api/chat — agent loop (streaming)│
                        │   ├── /api/auth — single-password gate  │
                        │   └── lib/agent.ts — Gemini + tool exec │
                        └───────────────┬─────────────────────────┘
                                        ▼
                ┌───────────────────────────────────────────────┐
                │ Tools (all read-only):                        │
                │  • mongo_find / aggregate / count / distinct  │
                │  • read_file / list_files / write_scratch     │
                │  • bash (sandboxed, denylist + timeout)       │
                └───────────────────────────────────────────────┘
                       │                       │
                       ▼                       ▼
                ┌─────────────┐       ┌──────────────────────────┐
                │  Mongo      │       │ REPO_ROOT (read-only)    │
                │ (live DB)   │       │  repos/sagenex-backend/  │
                │             │       │  repos/sagenex-frontend/ │
                │             │       │  repos/sagenex-user/     │
                └─────────────┘       │  scratch/  ← writable    │
                                      └──────────────────────────┘
```

## Setup

1. `cp .env.example .env` and fill `GEMINI_API_KEY`, `MONGO_URI`, `OPS_BOT_PASSWORD`.
2. `pnpm install`
3. `node scripts/sync-repos.js` — pulls master of all three Sagenex repos
   into `./repos/`, chmod-ed read-only. Re-run any time master updates.
4. `pnpm dev` — opens at <http://localhost:3030>.

## Safety

- **Mongo tool layer never exposes write ops.** Even if creds are full
  read/write, the agent only sees `find / aggregate / count / distinct`.
- **`bash` denylist** blocks `rm/mv/sed -i/git push/npm install/sudo/...`.
- **Repo mirrors are chmod-ed read-only** at sync time, so even if a
  denylist pattern is bypassed, fs writes fail at the OS layer.
- **Single shared admin password.** Rotate after deploys.

## Deploy

Push to GitHub, connect to Vercel. Add env vars in the Vercel dashboard.
For the `bash`+`read_file` tools to work in production, the deploy needs
the repo mirrors on disk — either:
  (a) bundle them in via `vercel.json` includes, or
  (b) run on a long-lived host (Render / Railway) with a cron syncing
      `scripts/sync-repos.js`.

For v1 a Render web service or self-hosted small VM is the simplest path.
