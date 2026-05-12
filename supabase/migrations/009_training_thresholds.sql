-- Add FTP (cycling) and run threshold pace to user profiles
-- Used to compute training zones injected into the agent system prompt

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS ftp_watts INT,
  ADD COLUMN IF NOT EXISTS run_threshold_pace_sec INT;
