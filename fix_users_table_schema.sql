-- Fix users table schema in Supabase
-- Remove self-referencing foreign key constraint on id field

-- First, let's check if there are any foreign key constraints on the users table
-- and drop them if they exist

-- Drop the problematic foreign key constraint
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_id_fkey;

-- The table should now work properly with auto-generated UUIDs for the id field
-- All other fields remain the same:
-- - id: UUID (Primary Key, auto-generated)
-- - telegram_id: bigint (optional)
-- - username: text (optional)
-- - interface_language: text (default: 'ru')
-- - current_level: user_level enum (optional)
-- - lessons_left: integer (required, default: 0)
-- - package_expires_at: timestamp with time zone (optional)
-- - total_lessons_completed: integer (required, default: 0)
-- - quiz_started_at: timestamp with time zone (optional)
-- - quiz_completed_at: timestamp with time zone (optional)
-- - last_payment_at: timestamp with time zone (optional)
-- - current_streak: integer (required, default: 0)
-- - last_lesson_date: date (optional)
-- - is_active: boolean (required, default: true)
