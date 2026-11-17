# Pinch

One place to approve every social post, for every brand and page. Nath swipes a post once to approve the content, then once more on the day it goes out. Nothing reaches Postiz without both.

This is **phase 1 (foundation)**: the data model, a read-only importer for the Andar and Nest post queues, and a Calendar of every imported post. Pinch doesn't post, schedule, or change anything yet. The current pipeline (Postiz, Hermes, the Dropbox queues, `andar yes`) keeps running until each brand is switched over.

## Rules built in

- **Nothing posts without Nath's yes.** Phase 1 has no way to post at all; publishing arrives in phase 3 behind the day-of confirm.
- **Never mix Andar and Nest.** Each brand reads only its own folder. Post ids must match the brand's pattern (`A…` for Andar, anything else for Nest), so an Andar id in Nest's queue is skipped, not imported. Media paths can't leave the brand folder, and the database refuses to point a post at another brand's channel.
- **Mac mini only.** Run it there, next to Postiz, private over Tailscale.

## Run it on the Mac mini

```bash
cp .env.example .env          # set the two brand folders
npm ci
npm run import                # reads both queues, read-only
npm run build && npm start    # http://localhost:3000/calendar
```

Or with Docker (brand folders mounted read-only):

```bash
export PINCH_ANDAR_ROOT=".../Nath Anthony Ybañez/Andar"
export PINCH_NEST_ROOT=".../Nath Anthony Ybañez/Nest Workspaces"
docker compose up -d --build
docker compose exec pinch npm run import
tailscale serve --bg --https=8445 http://127.0.0.1:3100
```

Run the import again whenever the queues change; it's safe to repeat. A cron every 15 minutes is fine until makers post straight to Pinch in phase 2.

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

## Data model

`db/migrations/001_init.sql`: Brand → Channel; Post → Version → Media; Post → channels per part; Decision (every swipe, plus import records); Publish job (Postiz post ids and status); Import run.

## Develop

```bash
npm test          # parsers and importer, against fixtures in tests/fixtures
npm run typecheck
npm run dev
```

## Phases

1. **Foundation** (this): data model, importer, Calendar.
2. Review stack: swipe to approve, reject, revise with a comment, undo; maker API `POST /api/posts`.
3. Day-of confirm and publishing: Today screen, Postiz API worker, status polling, 08:00 Telegram nudge. Then switch Andar over.
4. Nest move: Threads channel, a week side by side, then retire the old Nest pieces.
5. Polish: Health screen, token reminders, Reel sound, MCP server for makers.
