-- Migration 008: Structured athlete profile
CREATE TABLE user_profiles (
  user_id             uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  date_of_birth       date,
  weight_kg           numeric(5,1),
  height_cm           numeric(5,1),
  preferred_units     text NOT NULL DEFAULT 'metric'
                        CHECK (preferred_units IN ('metric', 'imperial')),
  primary_sport       text CHECK (primary_sport IN ('running', 'cycling', 'triathlon', 'other')),
  experience_level    text CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  max_heart_rate      int,
  goal_type           text CHECK (goal_type IN ('race_prep', 'fitness', 'performance', 'other')),
  goal_event_name     text,
  goal_event_distance text,
  goal_event_date     date,
  current_injuries    text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_profile" ON user_profiles
  FOR ALL USING (auth.uid() = user_id);
