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
2. **Money** — a net-worth trend and a ring for progress toward the goal. The committed card is an example percent, not a figure. A single point also says “More points coming.”
3. **Next 7 days** — Family and Work calendars, read only. Overlapping events are marked as conflicts.
4. **Health** — weight trend, upcoming visits as calendar items, and habit streaks such as sauna. No lab values, medication names, doses, or diagnoses.
5. **Kids** — application tracker for Cary Academy, Durham Academy, Ravenscroft, and Duke School, plus lessons and activities.
6. **Home** — open issues (Town of Cary setback / survey, sunroom permit), deliveries and returns, and renewal names with dates.
7. **Business** — pipeline status.
8. **Requests & outputs** — one card per ask (queued, working, waiting on Naresh, done). Filter by travel, school, home, golf, business, or research, and search. Tap a card for the deliverable.
9. **Trips** — Puerto Rico, Orlando 2027, London, St. Louis, Pinehurst, Bermuda, Mexico City, ski, and the RDU nonstop golf and park list. Each card opens a plan. The maps list has a URL field; it stays empty until a Google Maps link is known.
10. **Fleet** — Sylvia, Timmy, Nomad, Rick, DeNiro, Ledger, Dr. Moore, Liv, Dr. Qualy, Inspector Gadget, Sage, Reed, Porter, and Scout. Each card has the role, the current task, the last activity, and working / idle / blocked. **Stale** means no post in 24 hours. A routine is **Failed** when its last result failed, and **Stalled** when it has no successful run in more than twice its interval. Sample timeline rows and sample routines are marked **Example**.

The health, calendar, kids, home, business, and money blocks in git are **Example** data so the page has a shape. Real records for those sections are not committed. Dollar amounts, street addresses, parcel ids, secrets, and clinical detail are rejected by the privacy check. A figure is allowed only on `POST /api/status` with `section` set to `money`, and it is stored at `sections/money.json` in Blob. `.github/workflows/privacy.yml` fails the check on a pull request if a dollar amount or a money figure is committed.

Theme follows the phone, and the **Theme** control cycles Auto, Light, and Dark. Type is system fonts only. Chart.js and marked are stored in `vendor/` so the build does not download a font.

## How status is loaded

`GET /api/status` builds the board in this order:

1. Vercel Blob, when `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID` is set. One JSON file per bot at `agents/<id>.json`, and one file per live section at `sections/<section>.json`. This is the live path and it does not create a git commit. A live section replaces that section’s example rows.
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

A `needsYou`, `requests`, home issue, or pipeline entry with status `done` or `delivered` is a completion. It is removed from the open list and added to the timeline when that id is not already there. `delivered` is shown as Done.

### Section posts

Health, calendar, kids, home, and business use the same endpoint with `"section"` set. They are stored only in Blob, at `sections/<section>.json`. Do not commit the live payload. If Blob is not configured the post returns `storage_unconfigured`.

Health posts are stricter. They reject drug names, lab names, diagnoses, doses, and fields such as `diagnosis`, `medication`, `dose`, or `notes`. A habit name like Sauna is allowed. Weight is a date plus a number of pounds. Visits are a title and a start time only.

```bash
curl -sS -X POST "https://tanna-team-dashboard.vercel.app/api/status" \
  -H "content-type: application/json" \
  -H "x-bot-secret: $BOT_STATUS_SECRET" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -d '{
    "section": "health",
    "habits": [{ "id": "sauna", "name": "Sauna", "streak": 4, "cadence": "week" }],
    "weight": [{ "date": "2026-10-16", "lb": 186 }],
    "appointments": [{ "id": "visit", "title": "Annual visit", "start": "2026-11-02T09:00:00-05:00", "end": "2026-11-02T09:30:00-05:00" }]
  }'
```

`section` is `health`, `calendar`, `kids`, `home`, `business`, or `money`.

Money uses schema `mission-control-money-card/v1` and is stored only at `sections/money.json`. Allowed keys are `section`, `schema`, `owner`, `updated`, `goal` (`target_usd` or `amount`, `by`, `target_date`), `net_worth_trend` (`as_of` or `date`, `net_worth_usd` or `value`, `source`), `progress_pct`, and `notes`. The server converts each point to a percent of the goal and stores only dates, percents, and `progress_pct`; dollar figures and `source` are never written to Blob or returned by `GET /api/status`. The goal date is fixed to Jan 2036. The card shows only the percent and an unlabeled trend line. Any other key is rejected, including account numbers, account names, per-account balances, transactions, and holdings. A dollar sign in a note is still rejected. The committed example keeps the percent and the goal date, and leaves the figures out.

```bash
curl -sS -X POST "https://tanna-team-dashboard.vercel.app/api/status" \
  -H "content-type: application/json" \
  -H "x-bot-secret: $BOT_STATUS_SECRET" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -d '{
    "section": "money",
    "schema": "mission-control-money-card/v1",
    "owner": "Ledger",
    "updated": "2026-10-16T12:00:00-04:00",
    "goal": { "amount": 0, "target_date": "2036-01-01" },
    "net_worth_trend": [{ "date": "2026-10-16", "value": 0 }],
    "progress_pct": 12,
    "notes": ""
  }'
```

Replace the zero placeholders with the live numbers before sending. Zero is not a valid amount.

- `calendar.events[]`: `id`, `title`, `start`, `end`, `calendar` (`family` or `work`).
- `kids.applications[]`: `id`, `school` (Cary Academy, Durham Academy, Ravenscroft, Duke School), `stage`, `dates[{label,date}]`. `kids.activities[]`: `id`, `name`, `when`.
- `home.issues[]`: `id`, `title`, `status` (`open`, `waiting`, `done`), `detail`. `deliveries[]`: `id`, `name`, `kind` (`delivery` or `return`), `date`. `renewals[]`: `id`, `name`, `date`. No prices.
- `business.pipeline[]`: `id`, `name`, `stage` (`research`, `direction`, `building`, `parked`), `detail`.

The committed examples are labeled `"example": true`. The privacy check fails if a committed health, calendar, kids, home, business, or money row is missing that flag, if a money figure is committed, or if clinical wording is in the repo.

If Blob is not configured the post returns `503` with `storage_unconfigured`. Commit `agents/<id>.json` instead. Pushing that path runs the merge action below. Do not commit a status file every minute.

## Tasks

The **Tasks** tab (first in the nav, `#tasks`) is a to-do list in the spirit of Things: Inbox and Today, with a This Evening section. Tap the round checkbox to complete a task; it moves to the Logbook. The floating **+** opens quick add: title, notes, when (Inbox, Today, This Evening, or a date), an optional deadline, tags, and a category or Private switch. Each list has a one-tap date sort (oldest or newest first), saved per list on the phone. Upcoming, Anytime, Someday, and Logbook are listed as coming soon.

Tasks are one JSON document in the private Blob store, never in git: `tasks/tasks.json` on production and `tasks/preview/tasks.json` on every other deployment (override with `TASKS_BLOB_KEY`), so a preview never touches the real list.

- `GET /api/tasks` returns `areas`, `projects`, `tasks`, and `meta.counts`. `?view=inbox|today|upcoming|anytime|someday|logbook&sort=asc|desc` returns one list sorted by date (start date, else deadline, else created; the Logbook sorts by completion). Today also returns `sections.day` and `sections.evening`. `?shared=1` leaves out private tasks.
- `POST /api/tasks` creates a task, or takes a batch `{ areas, projects, tasks }` from an importer. A record whose `externalId` is already stored is updated, not duplicated.
- `PATCH /api/tasks?id=<id>` changes fields; `{ "complete": true }` completes, `{ "complete": false }` reopens.

The page writes without a secret: the request has to come from the page itself (`Sec-Fetch-Site: same-origin`), behind Vercel SSO. A bot sends `x-bot-secret` and the bypass header, like `/api/status`. A wrong secret is always 401.

```bash
curl -sS -X POST "https://tanna-team-dashboard.vercel.app/api/tasks" \
  -H "content-type: application/json" \
  -H "x-bot-secret: $BOT_STATUS_SECRET" \
  -H "x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET" \
  -d '{ "title": "Pick a weekend for the example trip", "when": "today", "tags": ["family"], "createdBy": "Sylvia" }'
```

Fields: `title` (required), `notes`, `when` (`inbox`, `today`, `evening`, `anytime`, `someday`, or `YYYY-MM-DD`), `deadline`, `tags`, `checklist`, `category`, `private`, `externalId`, `createdBy`. `source` is `bot` for a secret post (`things-import` when the body says so) and `manual` from the page.

**Private tasks.** `category` of `health` or `money` always sets `private: true`, and any task can set `private` itself. Naresh's own views show them, with a lock. Anything shown to someone else must use `?shared=1`. Private tasks may hold health or money wording because they live only in Blob; secrets are still rejected. The privacy check fails if a task document, or a task list not marked `"example": true`, is committed.

Things import: see [docs/tasks-import-plan.md](docs/tasks-import-plan.md) and `scripts/import-things.mjs` (dry run by default).

`npm start` without a Blob token serves `/api/tasks` from memory, seeded with the fake tasks in `fixtures/tasks.example.json`.

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
