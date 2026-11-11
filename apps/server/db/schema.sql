-- btree_gist lets one rule mix "same room" with "times overlap".
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- One row. It holds the clock for the whole board.
CREATE TABLE IF NOT EXISTS board (
  id      int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  epoch   int NOT NULL DEFAULT 0,      -- goes up by one each new day
  seed    int NOT NULL DEFAULT 1,      -- the number the fake day is built from
  minute  double precision NOT NULL DEFAULT 420,
  speed   int NOT NULL DEFAULT 60,     -- 60 means one board minute per real second
  running boolean NOT NULL DEFAULT true
);

-- Every change ever made today, in order. This is the source of truth.
CREATE TABLE IF NOT EXISTS events (
  seq        bigint PRIMARY KEY,
  at         double precision NOT NULL,
  body       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Where each case sits right now.
-- The two EXCLUDE rules are the safety net:
--   1. two cases can never share a room at the same time
--   2. one surgeon can never be in two cases at the same time
-- The database itself refuses to save a double booking, even if the app has a bug.
-- DEFERRED means the rules are checked at the end of a transaction,
-- so a bump can shuffle many cases at once.
CREATE TABLE IF NOT EXISTS cases (
  id         text PRIMARY KEY,
  room_id    text NOT NULL,
  surgeon_id text NOT NULL,
  start_min  int NOT NULL,
  end_min    int NOT NULL,
  status     text NOT NULL DEFAULT 'scheduled',
  version    int NOT NULL DEFAULT 1,
  CHECK (end_min > start_min),
  CONSTRAINT one_case_per_room EXCLUDE USING gist
    (room_id WITH =, int4range(start_min, end_min) WITH &&)
    WHERE (status <> 'cancelled') DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT one_room_per_surgeon EXCLUDE USING gist
    (surgeon_id WITH =, int4range(start_min, end_min) WITH &&)
    WHERE (status <> 'cancelled') DEFERRABLE INITIALLY DEFERRED
);

INSERT INTO board (id) VALUES (1) ON CONFLICT DO NOTHING;
