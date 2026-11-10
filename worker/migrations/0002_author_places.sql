CREATE TABLE places_author_migration (
  did TEXT NOT NULL,
  feed TEXT NOT NULL CHECK (
    feed = 'following' OR (
      length(feed) <= 256 AND
      (
        (substr(feed, 1, 15) = 'author|did:plc:' AND
        length(substr(feed, 16, 24)) = 24 AND
        substr(feed, 16, 24) NOT GLOB '*[^a-z2-7]*' AND
        substr(feed, 40, 1) = '|' AND
        substr(feed, 41) IN ('posts_and_author_threads', 'posts_with_replies', 'posts_with_media'))
        OR
        (substr(feed, 1, 15) = 'author|did:web:' AND
        instr(substr(feed, 16), '|') BETWEEN 2 AND 181 AND
        substr(feed, 16, instr(substr(feed, 16), '|') - 1) NOT GLOB '*[^a-zA-Z0-9.:%_-]*' AND
        substr(feed, 16 + instr(substr(feed, 16), '|')) IN ('posts_and_author_threads', 'posts_with_replies', 'posts_with_media'))
      )
    )
  ),
  revision INTEGER NOT NULL,
  device TEXT NOT NULL,
  state TEXT,
  updated INTEGER NOT NULL,
  PRIMARY KEY (did, feed)
);
INSERT INTO places_author_migration (did, feed, revision, device, state, updated)
SELECT did, feed, revision, device, state, updated FROM places;
DROP TABLE places;
ALTER TABLE places_author_migration RENAME TO places;
