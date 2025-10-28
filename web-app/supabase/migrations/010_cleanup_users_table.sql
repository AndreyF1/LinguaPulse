-- Migration: Cleanup users table - remove unused fields
-- Description: Remove Telegram-only and onboarding fields from users table

-- Drop Telegram-only fields
ALTER TABLE users DROP COLUMN IF EXISTS ai_mode;
ALTER TABLE users DROP COLUMN IF EXISTS text_messages_total;
ALTER TABLE users DROP COLUMN IF EXISTS last_text_used_at;
ALTER TABLE users DROP COLUMN IF EXISTS quiz_started_at;
ALTER TABLE users DROP COLUMN IF EXISTS quiz_completed_at;
ALTER TABLE users DROP COLUMN IF EXISTS is_active;

-- Drop onboarding fields (data moved to funnel_answers table)
ALTER TABLE users DROP COLUMN IF EXISTS interface_language;
ALTER TABLE users DROP COLUMN IF EXISTS current_level;
ALTER TABLE users DROP COLUMN IF EXISTS target_language;
ALTER TABLE users DROP COLUMN IF EXISTS learning_goal;
ALTER TABLE users DROP COLUMN IF EXISTS time_commitment;

-- Drop unused profile fields
ALTER TABLE users DROP COLUMN IF EXISTS avatar_url;
ALTER TABLE users DROP COLUMN IF EXISTS display_name;

-- Log
DO $$
BEGIN
  RAISE NOTICE 'Removed 13 unused columns from users table';
  RAISE NOTICE 'Telegram-only: ai_mode, text_messages_total, last_text_used_at, quiz_started/completed_at, is_active';
  RAISE NOTICE 'Onboarding: interface_language, current_level, target_language, learning_goal, time_commitment';
  RAISE NOTICE 'Profile: avatar_url, display_name';
END $$;

COMMENT ON TABLE users IS 'Simplified users table - onboarding data in funnel_answers, profile minimal';

