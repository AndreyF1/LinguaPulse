-- Migration: Allow anonymous INSERT into anonymous_sessions
-- Description: Enable anonymous users to create their own session records from frontend

-- Drop existing policies
DROP POLICY IF EXISTS "Service role can manage anonymous sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;

-- ============================================
-- RLS Policies for anonymous_sessions
-- ============================================

-- 1. Service role full access
CREATE POLICY "Service role can manage anonymous sessions"
  ON anonymous_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- 2. Users can view their own converted sessions
CREATE POLICY "Users can view own converted sessions"
  ON anonymous_sessions FOR SELECT
  USING (converted_to_user_id = auth.uid());

-- 3. Anonymous users can INSERT (create new sessions)
CREATE POLICY "Anonymous users can create sessions"
  ON anonymous_sessions FOR INSERT
  WITH CHECK (true);

-- 4. Anonymous users can UPDATE their own sessions (by id stored in localStorage)
CREATE POLICY "Anyone can update sessions by id"
  ON anonymous_sessions FOR UPDATE
  USING (true)
  WITH CHECK (true);

-- Log
DO $$
BEGIN
  RAISE NOTICE '=== ANONYMOUS SESSION RLS UPDATED ===';
  RAISE NOTICE 'Added: INSERT policy for anonymous users';
  RAISE NOTICE 'Added: UPDATE policy for session updates';
  RAISE NOTICE 'Note: Frontend stores session ID in localStorage';
END $$;

COMMENT ON TABLE anonymous_sessions IS 'Anonymous user sessions with public INSERT/UPDATE access for funnel tracking';

