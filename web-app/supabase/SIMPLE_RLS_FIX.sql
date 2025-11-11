-- SUPER SIMPLE FIX: Enable anonymous access to anonymous_sessions
-- Run this in Supabase SQL Editor

-- Step 1: Remove ALL existing policies (clean slate)
DROP POLICY IF EXISTS "Service role can manage anonymous sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;

-- Step 2: Disable RLS temporarily to test
ALTER TABLE anonymous_sessions DISABLE ROW LEVEL SECURITY;

-- Step 3: Test insert (should work now)
-- Try this in a separate query to verify:
-- INSERT INTO anonymous_sessions (funnel_answers, funnel_completed, demo_completed) 
-- VALUES ('[]'::jsonb, false, false) RETURNING id;

-- Step 4: Re-enable RLS
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;

-- Step 5: Create SIMPLEST possible policies
CREATE POLICY "allow_all_anonymous"
  ON anonymous_sessions
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_authenticated"
  ON anonymous_sessions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_service"
  ON anonymous_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'anonymous_sessions';

-- Should show:
-- allow_all_anonymous      | ALL | {anon}
-- allow_all_authenticated  | ALL | {authenticated}
-- allow_all_service        | ALL | {service_role}

