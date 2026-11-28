-- Claude connector: OAuth sign-in for Claude chats, and where each decision came from.

-- Apps that registered themselves (OAuth dynamic client registration), such as claude.ai or Claude Code.
CREATE TABLE oauth_clients (
  id             TEXT PRIMARY KEY,             -- client_id, random
  name           TEXT NOT NULL,
  redirect_uris  TEXT NOT NULL,                -- JSON list
  secret_hash    TEXT,                         -- only for apps that asked for a client secret
  created_at     TEXT NOT NULL
);

-- One-time codes from the consent screen. Stored hashed; live for five minutes.
CREATE TABLE oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  challenge      TEXT NOT NULL,                -- PKCE S256 code_challenge
  actor          TEXT NOT NULL,
  resource       TEXT,
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);

-- A connection: one Claude app that Nath allowed. Revoking it ends both of its tokens.
CREATE TABLE oauth_grants (
  id             INTEGER PRIMARY KEY,
  client_id      TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  actor          TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  last_used_at   TEXT,
  revoked_at     TEXT
);

-- Access and refresh tokens, stored hashed. Refresh tokens rotate on every use.
CREATE TABLE oauth_tokens (
  token_hash     TEXT PRIMARY KEY,
  grant_id       INTEGER NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  expires_at     TEXT NOT NULL,
  used_at        TEXT
);
CREATE INDEX oauth_tokens_grant ON oauth_tokens (grant_id);

-- Where a decision was made: NULL for the Pinch app itself, or the connected app's name (e.g. 'Claude').
ALTER TABLE decisions ADD COLUMN via TEXT;
