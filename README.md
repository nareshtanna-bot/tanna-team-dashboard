# Mission Control

Personal board for Naresh Tanna and the bot fleet. It is a phone-first page: what needs a decision, the asks and the pages the bots filed, the trips, and who in the fleet is working.

Live site: **https://tanna-team-dashboard.vercel.app/** (Vercel SSO, same as before).

Repo: https://github.com/nareshtanna-bot/tanna-team-dashboard

## Install on an iPhone

1. Open the live URL in Safari and sign in with Vercel.
2. Share → **Add to Home Screen**.
3. Name: **Mission**. It opens full screen, without the Safari chrome.

The manifest, apple touch icon, and service worker are what make that install work. Data refreshes about every 60 seconds, when the app is opened or comes back to the foreground, and when you pull down from the top. The header shows when the status was updated and when this phone last checked.

## What the page is

1. **Needs you** — open decisions only. An item whose status is `done` or `delivered`, or whose ask is already done, is left off this strip and filed on the timeline.
2. **Requests & outputs** — one card per ask (queued, working, waiting on Naresh, done). Filter by travel, school, home, golf, business, or research, and search. Tap a card for the deliverable.
3. **Trips** — Puerto Rico, Orlando 2027, London, St. Louis, Pinehurst, Bermuda, Mexico City, ski, and the RDU nonstop golf and park list. Each card opens a plan. The maps list has a URL field; it stays empty until a Google Maps link is known.
4. **Fleet** — Sylvia, Timmy, Nomad, Rick, DeNiro, Ledger, Dr. Moore, Liv, Dr. Qualy, Inspector Gadget, Sage, Reed, Porter, and Scout. Each card has the role, the current task, the last activity, and working / idle / blocked. **Stale** means no activity time in the last 24 hours. Below that: routines for today and upcoming, the what’s-next queue, and a timeline of everything the fleet has done. Sample timeline rows and sample routines are marked **Example**.

Health and finance stay title-only. Dollar amounts, street addresses, parcel ids, and secrets are rejected by the privacy check.

Theme follows the phone, and the **Theme** control cycles Auto, Light, and Dark. Type is system fonts only. Chart.js and marked are stored in `vendor/` so the build does not download a font.

## How status is loaded

`GET /api/status` builds the board in this order:

1. Vercel Blob, when `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` is set. One JSON file per bot at `agents/<id>.json`. This is the live path and it does not create a git commit.
2. The GitHub contents API for this repo, when that read works. A newer `status.json` on the default branch replaces the copy baked into the deployment. Files in `agents/` are merged on top.
3. The committed `status.json` in this deployment. That file is the seed and the fallback.

The response includes `meta.source`: `blob`, `github`, or `seed`. The header shows Live, GitHub, or Seed. If the API itself is down, the page fetches `status.json` directly.

Blob on the Hobby plan includes a free allowance (storage and operations, with no charge inside those limits, and no way to buy extra). This change does **not** create a store and does not turn on a paid plan. Connect a store only if the team is on Hobby, or you have confirmed it will not bill. Set `BLOB_ACCESS=private` (the default) or `public` to match the store.

Optional `GITHUB_TOKEN` (read-only contents) lets the function read a private repo. Without it, a private repo falls through to the committed seed.

## How a bot posts

`POST /api/status` with one agent object and the header `x-bot-secret`. The value is the `BOT_STATUS_SECRET` environment variable on the Vercel project. Do not commit that value.

The live site is behind Vercel SSO. A bot cannot complete the browser login, so it also sends Vercel’s automation bypass header (Project → Deployment Protection → Protection Bypass for Automation). The bypass only gets the request to the function. The function still requires `x-bot-secret`.

```bash
curl -sS -X POST "https://tanna-team-dashboard.vercel.app/api/status" \
  -H "content-type: application/json" \
  -H "x-bot-secret: $BOT_STATUS_SECRET" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -d '{
    "id": "nomad",
    "name": "Nomad",
    "role": "Travel",
    "does": "Plans family trips and holds bookings until Naresh decides.",
    "status": "working",
    "task": "Holding the NYC weekend until the Saturday flight is chosen.",
    "next": "Wait for that choice.",
    "lastActivity": "2026-10-15T19:30:00-04:00",
    "needsYou": [
      {
        "id": "nyc-flight",
        "title": "Pick the Saturday NYC outbound",
        "detail": "Morning award or the afternoon flight.",
        "bot": "Nomad"
      }
    ],
    "activity": [
      {
        "id": "nomad-2026-10-15-nyc",
        "at": "2026-10-15T19:30:00-04:00",
        "title": "Updated the NYC hold",
        "detail": "Still waiting on a choice.",
        "example": false
      }
    ]
  }'
```

`id` is 2–32 characters, lowercase letters, numbers, and hyphens. One file per bot. A later post from the same id replaces that bot and merges `needsYou`, `requests`, `routines`, `queue`, `trips`, and `activity` by id. `status` is `working`, `idle`, or `blocked` (`active` and `pending_goals` from older posts are still accepted). `task` may also be sent as `working_on`.

The body is rejected when it contains a dollar amount, a health term (medication, diagnosis, and similar), a secret or long account-like number, a street address, or a parcel PIN / REID / plat book number. The error lists the rule names, not the matched text.

A `needsYou` or `requests` entry with status `done` or `delivered` is a completion. It is removed from Needs you and added to the timeline when that id is not already there. `delivered` is shown as Done.

If Blob is not configured the post returns `503` with `storage_unconfigured`. Commit `agents/<id>.json` instead. Pushing that path runs the merge action below. Do not commit a status file every minute.

## Outputs

Filed pages live at `outputs/<date>-<slug>.md`, indexed by `outputs/manifest.json`. A request’s `output` field is that path. Tap the card to read it.

## GitHub Action

`.github/workflows/merge-status.yml` runs when `agents/**` changes on `main`. It refuses the merge if the privacy check fails, then folds every `agents/*.json` into `status.json` and commits that file. Sample entries should keep `"example": true`.

Check locally:

```bash
npm test
npm run check
```

## Local preview

```bash
npm install
npm start
```

Open http://127.0.0.1:8765 — add `?theme=dark` or `?theme=light` to pin the theme. `npm start` serves the API too. A static server also works; the page falls back to `status.json`.

## Verify

1. `npm test` and `npm run check` pass.
2. Open the preview. Needs you is first, then requests (filter and search), then trips, then the fleet. A stale bot shows the Stale chip. Example rows say Example.
3. Tap a done card, for example the RDU shortlist. The markdown page has links you can tap. Back returns to the board.
4. Pull down on a phone, or tap Refresh. The “Checked” time updates. Leave the tab and come back; it checks again.
5. Toggle Theme. Auto follows the system. Add to Home Screen on an iPhone and confirm it opens standalone.
6. `POST /api/status` with a wrong secret returns 401. With the right secret and no Blob token, the body is `storage_unconfigured`. A body that contains a price returns 400 and `privacy`.
7. Add a clean `agents/nomad.json` on a branch and run `node scripts/merge-status.mjs`. `status.json` gains that bot. Put a dollar amount in the file and `node scripts/privacy-check.mjs` exits 1.
