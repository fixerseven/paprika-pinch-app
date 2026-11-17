-- Phase 2: review decisions can be undone, and maker revisions are tracked.

-- What the post looked like before this decision, so an undo can put it back.
ALTER TABLE decisions ADD COLUMN prev_state TEXT;
ALTER TABLE decisions ADD COLUMN prev_reason TEXT;
-- Set when the decision was undone. An undone decision no longer counts as a yes.
ALTER TABLE decisions ADD COLUMN undone_at TEXT;

CREATE INDEX decisions_post ON decisions (post_id, id);
CREATE INDEX posts_state ON posts (state, scheduled_at);
