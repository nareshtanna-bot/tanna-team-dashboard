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
