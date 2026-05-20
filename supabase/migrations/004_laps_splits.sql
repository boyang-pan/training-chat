-- Migration 004: Activity laps and splits
-- Zero additional API calls — extracted from the Phase 2 detailed activity response.

-- Drop suffer_score which is always null (Strava only populates it with HR data that isn't present)
ALTER TABLE activities DROP COLUMN IF EXISTS suffer_score;

-- Laps: one row per watch-recorded or manual lap per activity
CREATE TABLE activity_laps (
  id                    bigint NOT NULL,
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id           bigint NOT NULL,
  name                  text NOT NULL,             -- e.g. "Lap 1"
  elapsed_time          int NOT NULL,              -- seconds (wall clock)
  moving_time           int NOT NULL,              -- seconds moving
  start_date            timestamptz NOT NULL,
  distance              float NOT NULL,            -- meters
  start_index           int,                       -- position in activity stream
  end_index             int,                       -- position in activity stream
  total_elevation_gain  float,                     -- meters
  average_speed         float,                     -- m/s
  max_speed             float,                     -- m/s
  average_heartrate     float,
  max_heartrate         float,
  average_cadence       float,
  average_watts         float,
  device_watts          boolean,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_activity_laps_activity_id
  ON activity_laps (user_id, activity_id);

ALTER TABLE activity_laps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_activity_laps" ON activity_laps
  FOR ALL USING (auth.uid() = user_id);

-- Splits: one row per 1 km metric split per activity
-- No unique Strava ID — PK is (user_id, activity_id, split index)
CREATE TABLE activity_splits (
  user_id               uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id           bigint NOT NULL,
  split                 int NOT NULL,              -- 1-indexed: 1 = first km
  distance              float NOT NULL,            -- meters in this split (last may be < 1000)
  elapsed_time          int NOT NULL,              -- seconds (wall clock)
  moving_time           int NOT NULL,              -- seconds moving
  average_speed         float,                     -- m/s; convert to min/km: 1000/(speed*60)
  average_heartrate     float,
  pace_zone             int,                       -- Strava pace zone 1–5
  PRIMARY KEY (user_id, activity_id, split),
  FOREIGN KEY (user_id, activity_id) REFERENCES activities(user_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_activity_splits_activity_id
  ON activity_splits (user_id, activity_id);

ALTER TABLE activity_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_activity_splits" ON activity_splits
  FOR ALL USING (auth.uid() = user_id);
