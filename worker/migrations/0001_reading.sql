CREATE TABLE IF NOT EXISTS clock (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  nonce TEXT NOT NULL
);
INSERT OR IGNORE INTO clock VALUES (1, 0, '');
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  did TEXT NOT NULL,
  csrf TEXT NOT NULL,
  device TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS places (
  did TEXT NOT NULL,
  feed TEXT NOT NULL CHECK (feed = 'following'),
  revision INTEGER NOT NULL,
  device TEXT NOT NULL,
  state TEXT,
  updated INTEGER NOT NULL,
  PRIMARY KEY (did, feed)
);
UPDATE clock SET revision = MAX(revision, COALESCE((SELECT MAX(revision) FROM places), 0))
WHERE id = 1;
