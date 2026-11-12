CREATE TABLE device_registry (
  did TEXT NOT NULL,
  device TEXT NOT NULL CHECK (length(device) = 36),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 64 AND length(CAST(label AS BLOB)) <= 256),
  updated INTEGER NOT NULL CHECK (updated >= 0),
  PRIMARY KEY (did, device)
);
CREATE TABLE reading_history (
  did TEXT NOT NULL,
  feed TEXT NOT NULL CHECK (length(feed) BETWEEN 1 AND 256),
  device TEXT NOT NULL CHECK (length(device) = 36),
  revision INTEGER NOT NULL CHECK (revision > 0),
  state TEXT NOT NULL CHECK (length(CAST(state AS BLOB)) <= 16384 AND json_valid(state) AND json_type(state, '$.anchor') = 'text'),
  updated INTEGER NOT NULL CHECK (updated > 0),
  PRIMARY KEY (did, feed, device, revision)
);
CREATE INDEX reading_history_recent ON reading_history (did, feed, device, revision DESC);
CREATE TRIGGER reading_history_delete_update AFTER UPDATE OF state ON places WHEN NEW.state IS NULL BEGIN DELETE FROM reading_history WHERE did = NEW.did AND feed = NEW.feed; END;
CREATE TRIGGER reading_history_delete_insert AFTER INSERT ON places WHEN NEW.state IS NULL BEGIN DELETE FROM reading_history WHERE did = NEW.did AND feed = NEW.feed; END;
INSERT OR IGNORE INTO device_registry (did, device, label, updated)
SELECT did, device, 'Browser-' || substr(device, 1, 4), MAX(updated) FROM places GROUP BY did, device;
INSERT OR IGNORE INTO device_registry (did, device, label, updated)
SELECT did, device, 'Browser-' || substr(device, 1, 4), 0 FROM sessions;
INSERT OR IGNORE INTO reading_history (did, feed, device, revision, state, updated)
SELECT did, feed, device, revision, state, updated FROM places WHERE state IS NOT NULL;
