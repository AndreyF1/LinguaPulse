-- Migration: Migrate data from profiles to users and drop profiles
-- Description: Transfer any existing profiles data to users table and remove profiles

-- ============================================
-- 1. Migrate data from profiles to users
-- ============================================

-- Insert profiles that don't exist in users
-- (This handles the case where profiles was created independently)
INSERT INTO users (
  id,
  username,
  auth_provider,
  lessons_left,
  total_lessons_completed,
  current_streak,
  is_active,
  created_at,
  updated_at
)
SELECT 
  p.id,
  p.username,
  'magic_link' as auth_provider,
  0 as lessons_left,
  0 as total_lessons_completed,
  0 as current_streak,
  true as is_active,
  now() as created_at,
  p.updated_at
FROM profiles p
WHERE NOT EXISTS (
  SELECT 1 FROM users u WHERE u.id = p.id
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 2. Drop profiles table
-- ============================================

-- Drop the table (CASCADE will handle foreign keys in lesson_sessions)
DROP TABLE IF EXISTS profiles CASCADE;

-- ============================================
-- 3. Verify migration
-- ============================================

-- Create a log entry (optional, for tracking)
DO $$
BEGIN
  RAISE NOTICE 'Migration completed: profiles merged into users and dropped';
END $$;

COMMENT ON TABLE users IS 'Unified user table for both Telegram and Web users (formerly separate from profiles)';

