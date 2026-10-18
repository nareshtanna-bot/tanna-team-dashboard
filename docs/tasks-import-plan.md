# Things import plan

This is how Naresh's Things 3 lists move into the Mission Control Tasks tab. It describes the plan and the importer skeleton only. **No real data has been read or imported yet**, and nothing below depends on the real export. All fixtures are fake.

## Where the export comes from

Sylvia drops one export from Naresh's MacBook Air onto the box at:

```
/workspace/mission-control/things-import/
```

Accepted formats:

1. **JSON export** (preferred). An AppleScript or `things.py` dump with `areas`, `projects`, and `todos` arrays. The shape the importer reads is in `fixtures/things-export.example.json`. It also accepts `things.py` field names (`start_date`, `stop_date`, `created`, `heading`, and so on).
2. **The Things SQLite database** (`main.sqlite`, a copy of `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite`). The importer opens it read only with `node:sqlite` (Node 22.5+) or the `sqlite3` CLI.

That folder is never committed and never served. Health and money items in it are private. Nothing in it is printed by default: the dry run reports counts only.

## Where it lands

`POST /api/tasks` with `x-bot-secret` (plus the Vercel automation bypass header). The API writes one JSON document to the private Blob store:

- production: `tasks/tasks.json`
- every preview or dev deployment: `tasks/preview/tasks.json` (or `TASKS_BLOB_KEY`)

Run the first import against a **preview URL**, look at it, then run it again against production. The import is idempotent, so the second run produces the same records.

## The data model

One document, schema `mission-control-tasks/v1`:

```json
{
  "schema": "mission-control-tasks/v1",
  "updated": "ISO time",
  "areas":    [{ "id", "title", "tags", "category", "private", "source", "externalId" }],
  "projects": [{ "id", "title", "notes", "areaId", "start", "startDate", "deadline", "tags",
                 "headings": [{ "id", "title", "externalId" }],
                 "status", "category", "private", "source", "externalId", "createdAt", "completedAt" }],
  "tasks":    [{ "id", "title", "notes",
                 "start": "inbox | anytime | someday", "startDate": "YYYY-MM-DD | null", "evening": false,
                 "deadline": "YYYY-MM-DD | null", "tags": [],
                 "checklist": [{ "id", "title", "done", "externalId" }],
                 "status": "open | completed | canceled",
                 "areaId", "projectId", "headingId",
                 "category": "health | money | family | home | work | personal | null", "private": false,
                 "source": "manual | bot | things-import", "externalId", "createdBy",
                 "createdAt", "updatedAt", "completedAt" }]
}
```

Lists are derived, the same way Things files a to-do:

| View | Rule |
| --- | --- |
| Inbox | open, `start = inbox`, no start date |
| Today | open, `startDate <= today` (America/New_York); `evening = true` goes under **This Evening** |
| Upcoming | open, `startDate > today` |
| Anytime | open, `start = anytime` (includes Today items, like Things) |
| Someday | open, `start = someday`, no start date |
| Logbook | `status` completed or canceled, sorted by `completedAt` |

## Mapping Things to the model

| Things | Model |
| --- | --- |
| Area | `areas[]`, id `things_<uuid>`, externalId `things:<uuid>` |
| Project | `projects[]` with `areaId`; its headings become `projects[].headings[]` |
| Heading (type 2 row in `TMTask`) | `headings[]` on its project; a to-do under it gets `headingId` and its project's `projectId` |
| To-do in Inbox (`start` 0 / "Inbox") | `start: inbox` |
| To-do in Anytime (`start` 1) | `start: anytime` |
| To-do in Someday (`start` 2) with no date | `start: someday` |
| Today (start date today or earlier) | `startDate` = that date; shows in Today |
| This Evening (`startBucket` 1) | `evening: true` |
| Upcoming (a future start date; Things stores these as Someday + date) | `start: anytime`, `startDate` = the date; shows in Upcoming until the day comes |
| Deadline | `deadline` |
| Tags (`TMTag` via `TMTaskTag`) | `tags[]` by name |
| Notes (plain or Things' `<note>` XML) | `notes`, XML stripped |
| Checklist items (`TMChecklistItem`) | `checklist[]`, `done` from status |
| Logbook: completed (`status` 3) / canceled (`status` 2) | `status` completed / canceled, `completedAt` from `stopDate` |
| `creationDate` | `createdAt` |
| Trashed rows | skipped |
| Repeating to-do templates | not in slice 1. Instances that already exist import as plain to-dos; the repeat rule itself is not carried over yet |

Things packs dates as an integer, `year << 16 | month << 12 | day << 7`. `decodeThingsDate()` in the importer turns that into `YYYY-MM-DD`. `creationDate` and `stopDate` are Unix seconds.

## Privacy

- `category` of `health` or `money` always forces `private: true`. Any task can also be marked `private: true` by hand.
- The importer maps names to a category: an area, project, or tag called Health, Wellness, Medical → `health`; Money, Finance, Finances, Taxes → `money`. Records inherit their project's or area's category. Override with `--private-map "Doctor=health,Bills=money"`.
- Naresh's own views show private tasks. A shared view (anything shown to someone else, a screenshot for review, a family board) must call `GET /api/tasks?shared=1`, which leaves private tasks out of the list and the counts.
- Private tasks may contain health or money wording. That is why they live only in Blob. The API still rejects secrets (tokens, passwords, long account-like numbers) in any task.
- The repo privacy check fails if a task document (`schema: mission-control-tasks/v1`) or any JSON with a `tasks` / `todos` list not marked `"example": true` is committed.

## The importer

`scripts/import-things.mjs`. Dry run is the default.

```bash
# Dry run against the fake fixture: prints counts only, sends nothing
node scripts/import-things.mjs --source fixtures/things-export.example.json

# Later, against the real drop (not yet; wait for the go-ahead)
node scripts/import-things.mjs --source /workspace/mission-control/things-import/
node scripts/import-things.mjs --source /workspace/mission-control/things-import/ \
  --apply --url https://<preview-deployment>.vercel.app
```

Options:

- `--source <file|dir>` required. A directory uses its first `.json`, else its first `.sqlite`.
- `--apply` sends. Without it the run is a dry run (`--dry-run` is also accepted).
- `--url` the deployment to post to. Required with `--apply`; there is no default, so production is never hit by accident.
- `--secret-file` (default `/workspace/mission-control/.bot-status-secret`) and `--bypass-file` (default `/workspace/mission-control/.vercel-bypass-secret`). Read from disk, never printed or logged.
- `--batch <n>` tasks per POST (default 250). Areas and projects go in the first POST, so task references always resolve.
- `--no-logbook` skips completed and canceled to-dos.
- `--private-map` extra name → category pairs.

How it stays idempotent:

1. Every record gets a stable id, `things_<uuid>`, and `externalId: things:<uuid>`.
2. `POST /api/tasks` with `{ source: "things-import", areas, projects, tasks }` upserts by `externalId`: a record it already has is updated in place, never duplicated.
3. The response reports `created`, `updated`, and `rejected` (per row, with the reason code). A second run of the same export reports `created: 0`.

A re-import overwrites the fields Things owns (title, notes, dates, status). Completing a task in Mission Control and then re-importing an export where it is still open would reopen it, so the plan is one import, then Mission Control is the place tasks are kept. Re-running is for recovery, not sync.

## Steps when the real export arrives

1. Sylvia confirms the export is in `/workspace/mission-control/things-import/` and Naresh says go.
2. Dry run against it. Check the counts by list, the number of private records, and the number of rejected rows. Do not paste titles anywhere.
3. `--apply` against a preview deployment (writes `tasks/preview/tasks.json`). Naresh looks at it on his phone.
4. `--apply` against production. Run it twice and confirm the second run says `created: 0`.
5. Leave the export on the box; do not commit it.

## Not in this slice

Upcoming, Anytime, Someday, and Logbook views (the API already serves them via `?view=`), editing and moving tasks in the UI, projects and areas in the UI, repeating to-dos, and two-way sync with Things.
