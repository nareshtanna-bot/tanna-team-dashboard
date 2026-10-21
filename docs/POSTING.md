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
