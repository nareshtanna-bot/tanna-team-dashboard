# Posting to Mission Control

All posts go to `POST /api/status` with the `x-bot-secret` header (and, on protected deployments, the `x-vercel-protection-bypass` header). Never commit either value.

## Headlines section (Rick)

Rick posts the morning market headlines as a section. Each post replaces the whole headlines card, so send the full list every time.

```json
{
  "section": "headlines",
  "fetched_at": "2026-10-21T06:30:00-04:00",
  "items": [
    {
      "title": "Fed holds rates steady and signals patience",
      "source": "Reuters",
      "url": "https://www.reuters.com/markets/...",
      "fetched_at": "2026-10-21T06:30:00-04:00"
    }
  ]
}
```

- `title` (required, up to 160 characters), `url` (required, `https://` only), `source` (optional), `fetched_at` (optional ISO time; falls back to the top-level `fetched_at`).
- Up to 15 items are kept.
- **Headlines only.** An item is dropped if its title or source carries a price or figure: `$`, `¢`, `€`, `£`, `¥`, `USD`, "dollars", comma-grouped numbers (`70,000`), decimal prices (`187.42`), amounts like `2.5bn`/`40k`, or words like position, holdings, balance, cost basis. Plain percentages ("slip 1%") are allowed. The response lists how many were dropped (`dropped`). A post where nothing survives returns `400 invalid_body`.
- The kept items also pass the general privacy scan, stored files are re-checked when the board reads them, and `npm run check` fails if a committed file has a headline with a figure.
- The card shows a compact list of linked titles with the source. It stays hidden when there are no headlines.

Turn Rick's `quotes/headlines-latest.json` (`{as_of, headlines: [{title, source, url}]}`) into a post and send it:

```bash
jq '{section: "headlines", fetched_at: .as_of, items: [.headlines[] | {title, source, url, fetched_at: .as_of}]}' \
  /workspace/markets-briefs/quotes/headlines-latest.json > /tmp/headlines-post.json

curl -sS -w '\nHTTP %{http_code}\n' -X POST "https://tanna-team-dashboard.vercel.app/api/status" \
  -H 'content-type: application/json' \
  -H "x-bot-secret: $BOT_STATUS_SECRET" \
  -H "x-vercel-protection-bypass: $VERCEL_BYPASS_SECRET" \
  --data-binary @/tmp/headlines-post.json
```

Expect `{"ok":true,"section":"headlines","stored":"blob"}` and `HTTP 200`. `curl` exits 0 even on a 400 or 401, so check for `HTTP 200`. On the box, `/workspace/mission-control/post-status /tmp/headlines-post.json` sends the same request with the stored secrets.

# Closing a committed item from a bot post

Items in the committed `status.json` (`needsYou`, `requests`, `queue`) can be closed by a bot post without a repo edit.

How it works (`lib/status.js`, `mergeStatus`): each bot file's `needsYou`, `requests` and `queue` entries are merged **by `id`**, and a posted entry replaces the committed one. `openNeedsYou` then drops any `needsYou` entry whose status is `done` or `delivered`, or whose id matches a closed request, and moves it to the timeline as `done:<id>`.

To close one:

1. POST the bot's full status JSON to `/api/status` (the whole file is replaced, so keep every other field and open item).
2. Include an entry with the **same id** as the committed item and `"status": "done"`, for example:

```json
{ "id": "merge-pr-1", "title": "Merge PR #1 (Mission Control)", "status": "done" }
```

3. For a committed request, post it under `requests` with the same id and `"status": "done"`; that also closes a `needsYou` entry with that id.

Limits: `queue` entries have no status, so a post can replace a queue entry but not remove it. Remove those in `status.json`. The override lasts only as long as the bot's stored file keeps that entry.

Checked locally on 2026-10-20 by running `mergeStatus` on the committed `status.json` with a post containing `merge-pr-1` set to `done`: the item left Needs you and appeared on the timeline.
