# Tanna Team Dashboard

Mobile-first status page for Naresh Tanna (iPhone Safari / Add to Home Screen).

## Live

**https://tanna-team-dashboard.vercel.app/**

Repo: https://github.com/nareshtanna-bot/tanna-team-dashboard

## Pin on iPhone

1. Open the live URL in Safari
2. Tap Share → **Add to Home Screen**
3. Name: **Tanna Team**

## Update status (Sylvia)

1. Edit `status.json` (priorities + bots + `updated` / `updatedLabel`)
2. Commit & push to `main` — Vercel auto-redeploys from GitHub
3. Or overwrite `status.json` via GitHub Contents / MCP `push_files` / `create_or_update_file`

Keep `updatedLabel` in America/New_York (e.g. `Sep 23, 2026 · 8:32 PM ET`).

## Local preview

```bash
cd /workspace/tanna-team-dashboard
python3 -m http.server 8765
```

Open http://localhost:8765
