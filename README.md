# Pinch

One place to approve every social post, for every brand and page. Nath swipes a post once to approve the content, then once more on the day it goes out. Nothing reaches Postiz without both.

This is **phase 1 (foundation)**: the data model, a read-only importer for the Andar and Nest post queues, and a Calendar of every imported post. Pinch doesn't post, schedule, or change anything yet. The current pipeline (Postiz, Hermes, the Dropbox queues, `andar yes`) keeps running until each brand is switched over.

## Rules built in

- **Nothing posts without Nath's yes.** Pinch has no way to post yet; publishing arrives in phase 3 behind the day-of confirm. A yes counts only for the exact version Nath saw: a new version from a maker goes back to review. Posts the old queue marked ready still show in Review as "Needs your yes" until Nath approves them in Pinch.
- **Never mix Andar and Nest.** Each brand reads only its own folder. Post ids must match the brand's pattern (`A…` for Andar, anything else for Nest), so an Andar id in Nest's queue is skipped, not imported. Media paths can't leave the brand folder, and the database refuses to point a post at another brand's channel.
- **Mac mini only.** Run it there, next to Postiz, private over Tailscale.

## Run it on the Mac mini

```bash
cp .env.example .env          # brand folders, passcode, secret, maker token
npm ci
npm run import                # reads both queues, read-only
npm run build && npm start    # http://localhost:3000/review
```

Or with Docker (brand folders mounted read-only):

```bash
export PINCH_ANDAR_ROOT=".../Nath Anthony Ybañez/Andar"
export PINCH_NEST_ROOT=".../Nath Anthony Ybañez/Nest Workspaces"
docker compose up -d --build
docker compose exec pinch npm run import
tailscale serve --bg --https=8445 http://127.0.0.1:3100
```

Run the import again whenever the queues change; it's safe to repeat. A cron every 15 minutes is fine. Posts a maker has sent through the maker API belong to Pinch from then on; the importer skips them.

## What the importer reads

For each brand in `config/brands.json`:

| File | Used for |
| --- | --- |
| `post-queue.csv` | One post per row: date, slot, title, feed/story/reel files (carousel slides split on `;`), caption reference, status, owner, notes |
| `postiz-state.json` | Which posts the old scripts already drafted or scheduled in Postiz, kept as legacy publish jobs |
| Caption `.md` files | The `## <post id>` section, without note lines (`**…`, `Status:`) |

How queue status maps to a Pinch state:

| Queue | Pinch |
| --- | --- |
| `posted…` | Posted |
| `dropped: …` | Dropped (the slot shows as empty) |
| anything, already scheduled in Postiz | Scheduled (flagged if the queue says otherwise) |
| `ready` | Approved (still waits for the day-of confirm once publishing exists) |
| `hold: …`, `check: …`, anything else | On hold, with the reason |

Card flags: check this fact today, Reel has no sound, Facebook story is manual, unfinished caption (`TBD`, `[PRICE`…), missing file, off-slot time, queue/Postiz mismatch, and drafts that still need the old `andar yes`.

## Review (phase 2)

The home screen is an inbox: what's waiting for review, what goes out today, and one quiet line each for posts with makers and posts on hold. One button, "Review N posts", opens `/review`.

`/review` shows one post at a time, soonest slot first: new and revised posts from makers, posts changed in the old queue after a decision, and ready posts with no yes yet. Approve is the only filled button; Send back sits beside it; Later and Drop are behind the ··· menu. Swipe right to approve, swipe left to send back with a note (so a slip never drops a post). Undo stays for 10 seconds. Keyboard: → approve, ← send back, `l` later, `u` undo. Channels, version and quieter notes sit behind "Details"; only flags that need a look (check a fact, no sound, missing file…) show on the screen. `/revisions` lists what's with makers, with the note.

Sign in with `PINCH_PASSCODE`. The session cookie lasts 30 days; five wrong tries lock that client out for five minutes.

## Maker API

Makers send posts with `Authorization: Bearer $PINCH_MAKER_TOKEN` and, optionally, `X-Pinch-Maker: <name>`. Makers can't approve anything.

```bash
curl -X POST https://<mac-mini>:8445/api/posts \
  -H "Authorization: Bearer $PINCH_MAKER_TOKEN" -H "X-Pinch-Maker: ac" \
  -H "Content-Type: application/json" -d '{
    "brand": "andar", "externalId": "A40", "date": "2026-11-20", "time": "12:00",
    "title": "Workshop open day", "caption": "…",
    "media": [{ "part": "feed", "path": "Posts/A40/a40 1 - feed.png" }],
    "checks": ["Confirm the Saturday date"], "note": "what changed (for a revision)"
  }'
```

- `media[].path` is relative to the brand's folder and must exist there. `part` is `feed`, `story` or `reel`.
- The id must match the brand's pattern. Sending an id that already exists adds a new version and puts it back in review. A post already scheduled or posted returns 409.
- `GET /api/posts?state=revise[&brand=andar]` lists posts sent back, with the latest note. `GET /api/posts/:id` returns one post with its versions and decisions.

## Data model

`db/migrations/001_init.sql`: Brand → Channel; Post → Version → Media; Post → channels per part; Decision (every swipe, plus import records); Publish job (Postiz post ids and status); Import run. `002_review.sql` adds undo tracking to decisions.

## Develop

```bash
npm test          # parsers, importer, review and maker API, against fixtures in tests/fixtures
npm run typecheck
npm run dev
```

## Phases

1. Foundation: data model, importer, Calendar.
2. **Review stack** (this): swipe to approve, reject, revise with a comment, undo; maker API `POST /api/posts`.
3. Day-of confirm and publishing: Today screen, Postiz API worker, status polling, 08:00 Telegram nudge. Then switch Andar over.
4. Nest move: Threads channel, a week side by side, then retire the old Nest pieces.
5. Polish: Health screen, token reminders, Reel sound, MCP server for makers.
