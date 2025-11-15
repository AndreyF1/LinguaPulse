-- Migration: Fix anonymous_sessions RLS for magic link flow
-- Description: Allow authenticated users to read any anonymous session (needed to convert it)

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Authenticated users can read any session" ON anonymous_sessions;

-- New policy: Authenticated users can read ANY anonymous session
-- (needed for magic link flow where user needs to read session BEFORE converting it)
CREATE POLICY "Authenticated users can read any session"
  ON anonymous_sessions FOR SELECT
  TO authenticated
  USING (true);

-- Log
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed anonymous_sessions RLS - authenticated users can now read any session to convert it';
END $$;

COMMENT ON POLICY "Authenticated users can read any session" ON anonymous_sessions IS 'Allows magic link users to read their demo session before converting it';

