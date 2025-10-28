-- Migration: Drop unused Telegram-only tables
-- Description: Remove feedback and text_usage_daily tables (not used in web version)

-- Drop RLS policies first
DROP POLICY IF EXISTS "Users can view own feedback" ON feedback;
DROP POLICY IF EXISTS "Users can create own feedback" ON feedback;
DROP POLICY IF EXISTS "Service role can manage feedback" ON feedback;

DROP POLICY IF EXISTS "Users can view own usage stats" ON text_usage_daily;
DROP POLICY IF EXISTS "Service role can manage usage stats" ON text_usage_daily;

-- Drop tables
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS text_usage_daily CASCADE;

-- Log
DO $$
BEGIN
  RAISE NOTICE 'Dropped unused Telegram-only tables: feedback, text_usage_daily';
END $$;

COMMENT ON DATABASE postgres IS 'Tables feedback and text_usage_daily removed - not used in web version';

