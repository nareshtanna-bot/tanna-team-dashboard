# Heartbeat

A routine can stamp its fleet card without posting a full status file. The card shows the one-line status, a state chip, and `Last run <time ET>`. `failed` uses the failed chip; `ok` uses the ok chip. When that run time is the same moment as the card's last activity, the activity line is left off. The server sets `lastActivity` to its own clock, so a heartbeat within 24 hours clears the Stale chip.

The write merges into the private Blob record at `agents/<id>.json`. Every other field on that record stays. The id has to be a bot that already has a card: a Blob record at `agents/<id>.json`, or a bot in the seed roster (`status.json`, the list `mergeStatus` starts from). Anything else is rejected and no file is created. A roster bot with no Blob file yet is stamped onto that existing card.

`status` in this body is the one line on the card. It does not change the working / idle / blocked chip. That chip stays whatever the last full status post set.

## Request

`POST https://tanna-team-dashboard.vercel.app/api/status`

Headers:

- `content-type: application/json`
- `x-bot-secret` — `BOT_STATUS_SECRET`, read from a file
- `x-vercel-protection-bypass` — the deployment-protection bypass, read from a file

The live site is behind Vercel SSO. The bypass header only gets the request to the function. The function still checks `x-bot-secret` with a timing-safe compare.

Do not print either file. Do not echo them, and do not run curl with `-v` or `-i`, because those print the headers.

Body:

```json
{
  "heartbeat": true,
  "id": "nomad",
  "status": "Routine finished. Board is current.",
  "state": "ok"
}
```

- `heartbeat` is the boolean `true`.
- `id` is 2–32 characters: lowercase letters, digits, and hyphens. Same rule as a full status post.
- `status` is one line, at most 140 characters.
- `state` is optional: `ok`, `failed`, `working`, `idle`, or `blocked`.

The server writes `lastActivity`, `lastRun`, and `heartbeat` (`at`, `line`, `state`). `at` is the server time. Fields on the request other than `id`, `status`, and `state` are ignored, so a heartbeat cannot replace `task`, `needsYou`, or the rest of the record.

A money figure, health term, secret, street address, or parcel id in the line is rejected by the same privacy check as a full post.

## Example

```bash
BOT_STATUS_SECRET_FILE="${BOT_STATUS_SECRET_FILE:-$HOME/.config/mission-control/bot-status-secret}"
VERCEL_BYPASS_FILE="${VERCEL_BYPASS_FILE:-$HOME/.config/mission-control/vercel-automation-bypass}"

curl -sS -X POST "https://tanna-team-dashboard.vercel.app/api/status" \
  -H "content-type: application/json" \
  -H "x-bot-secret: $(cat "$BOT_STATUS_SECRET_FILE")" \
  -H "x-vercel-protection-bypass: $(cat "$VERCEL_BYPASS_FILE")" \
  -d '{"heartbeat":true,"id":"nomad","status":"Routine finished. Board is current.","state":"ok"}'
```

The two `$(cat ...)` substitutions are the header values. The command does not print them.

## Responses

- **200** — merged. `{ "ok": true, "id": "nomad", "stored": "blob", "at": "<server time>" }`.
- **400** — the id is invalid, the line is missing or longer than 140 characters, `state` is not one of the five values, the body is not JSON, or the line fails the privacy check. Privacy looks like `{ "ok": false, "error": "privacy", "rules": ["dollar_amount"], "message": "Post rejected by the privacy check." }`. `rules` names the rule. The matched text is not returned.
- **401** — `x-bot-secret` is missing or wrong. `{ "ok": false, "error": "unauthorized" }`.
- **404** — the id is not a Blob record and not on the seed roster. `{ "ok": false, "error": "unknown_bot" }`. No card is created.

If `BOT_STATUS_SECRET` or the Blob token is not set, the response is **503**. If the record changes while the merge is saving, the response is **409**. Send the same heartbeat again.

## Local preview

`HEARTBEAT_FIXTURE=1 npm start`, then open `http://127.0.0.1:8765/?theme=dark#fleet`. The dev server overlays `fixtures/heartbeat.example.json` on the board and stamps that card as just run. The switch is local only. Bots still post to the URL above.
