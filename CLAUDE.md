# Working in Pinch

Pinch is Nath's approval station for social posts (Andar, Nest Workspaces, and future pages). Read README.md first.

Hard rules:
- Nothing posts without Nath's yes. Any code path that reaches Postiz must require both the content approval and the day-of confirm.
- Never mix brands. Keep reads inside a brand's own folder, keep the post-id pattern check, and keep the `post_channels_same_brand` trigger.
- Host is Paprika's Mac mini only, never the Knight3090 PC.
- Don't touch Postiz, Hermes, or the old Dropbox queues until the brand is being switched over and Nath has said so.
- No photos of Nath's or Ac's faces in Andar posts.

Conventions: TypeScript, Next.js App Router, better-sqlite3 with plain SQL migrations in `db/migrations` (never edit an applied migration; add a new file). Run `npm test` and `npm run typecheck` before committing.
