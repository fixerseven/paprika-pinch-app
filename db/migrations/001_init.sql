-- Pinch data model, phase 1.
-- Brand -> Channel; Post -> Version -> Media; Decision; Publish job.
-- Times are stored as ISO 8601 UTC strings. Local posting date and slot are
-- kept too, in the brand's timezone, because that is how people talk about them.

CREATE TABLE brands (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  colour        TEXT NOT NULL,
  timezone      TEXT NOT NULL,
  slots         TEXT NOT NULL DEFAULT '[]',   -- JSON array of "HH:MM" default slot times
  approvers     TEXT NOT NULL DEFAULT '[]',   -- JSON array of approver handles
  post_id_pattern TEXT NOT NULL,              -- regex every external post id must match
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE channels (
  id            INTEGER PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(id),
  key           TEXT NOT NULL UNIQUE,         -- e.g. andar-facebook
  platform      TEXT NOT NULL,                -- facebook | instagram | threads | linkedin | tiktok | x
  name          TEXT NOT NULL,                -- page or account name
  postiz_integration_id TEXT,
  token_expires_at TEXT,
  active        INTEGER NOT NULL DEFAULT 1,
  notes         TEXT
);

CREATE TABLE posts (
  id            INTEGER PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(id),
  external_id   TEXT NOT NULL,                -- the maker's id: A12, A2-21, B13, Q06 ...
  local_date    TEXT NOT NULL,                -- YYYY-MM-DD in the brand's timezone
  local_time    TEXT NOT NULL,                -- HH:MM in the brand's timezone
  scheduled_at  TEXT NOT NULL,                -- the same moment in UTC
  title         TEXT NOT NULL,
  track         TEXT,
  owner         TEXT,                         -- which maker thread owns it
  state         TEXT NOT NULL CHECK (state IN
                  ('review','approved','scheduled','published','failed','revise','held','rejected')),
  state_reason  TEXT,
  flags         TEXT NOT NULL DEFAULT '[]',   -- JSON array of {code, text}
  notes         TEXT,
  source        TEXT NOT NULL DEFAULT 'api',  -- import | api
  source_ref    TEXT,                         -- e.g. queue file the row came from
  current_version_id INTEGER,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (brand_id, external_id)
);
CREATE INDEX posts_by_time ON posts (scheduled_at);

CREATE TABLE versions (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  number        INTEGER NOT NULL,
  caption       TEXT,
  caption_ref   TEXT,                         -- e.g. Posts/.../Captions.md#A12
  content_hash  TEXT NOT NULL,                -- caption + media, to spot a changed post on re-import
  created_by    TEXT NOT NULL,
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (post_id, number)
);

CREATE TABLE media (
  id            INTEGER PRIMARY KEY,
  version_id    INTEGER NOT NULL REFERENCES versions(id),
  part          TEXT NOT NULL CHECK (part IN ('feed','story','reel')),
  position      INTEGER NOT NULL,             -- carousel order, from 1
  path          TEXT NOT NULL,                -- relative to the brand's media root
  kind          TEXT NOT NULL CHECK (kind IN ('image','video'))
);

-- Which channels each part of a post goes to.
CREATE TABLE post_channels (
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  channel_id    INTEGER NOT NULL REFERENCES channels(id),
  part          TEXT NOT NULL CHECK (part IN ('feed','story','reel')),
  PRIMARY KEY (post_id, channel_id, part)
);

-- Never mix brands: a post can only target its own brand's channels.
CREATE TRIGGER post_channels_same_brand
BEFORE INSERT ON post_channels
WHEN (SELECT brand_id FROM posts WHERE id = NEW.post_id)
  <> (SELECT brand_id FROM channels WHERE id = NEW.channel_id)
BEGIN
  SELECT RAISE(ABORT, 'a post can only target channels of its own brand');
END;

CREATE TABLE decisions (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  version_id    INTEGER REFERENCES versions(id),
  action        TEXT NOT NULL CHECK (action IN
                  ('import','approve','reject','revise','confirm','hold','undo')),
  comment       TEXT,
  actor         TEXT NOT NULL,                -- 'nath', or 'import' for the queue importer
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE publish_jobs (
  id            INTEGER PRIMARY KEY,
  post_id       INTEGER NOT NULL REFERENCES posts(id),
  channel_id    INTEGER REFERENCES channels(id), -- null when the old scripts didn't record it
  part          TEXT NOT NULL CHECK (part IN ('feed','story','reel')),
  postiz_post_id TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('draft','scheduled','published','failed')),
  publish_at    TEXT,
  error         TEXT,
  source        TEXT NOT NULL DEFAULT 'pinch',  -- legacy-import | pinch
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (postiz_post_id)
);

CREATE TABLE import_runs (
  id            INTEGER PRIMARY KEY,
  brand_id      INTEGER NOT NULL REFERENCES brands(id),
  started_at    TEXT NOT NULL,
  queue_modified_at TEXT,
  created       INTEGER NOT NULL DEFAULT 0,
  updated       INTEGER NOT NULL DEFAULT 0,
  new_versions  INTEGER NOT NULL DEFAULT 0,
  unchanged     INTEGER NOT NULL DEFAULT 0,
  skipped       INTEGER NOT NULL DEFAULT 0,
  warnings      TEXT NOT NULL DEFAULT '[]'
);
