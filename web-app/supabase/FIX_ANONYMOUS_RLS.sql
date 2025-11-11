-- SIMPLE FIX: Add missing RLS policies for anonymous users
-- Run this if migration 013 didn't work

-- First, remove conflicting policies if they exist
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;

-- Now add the two missing policies

-- Policy 1: Allow anonymous INSERT (anyone can create a new session)
CREATE POLICY "Anonymous users can create sessions"
  ON anonymous_sessions 
  FOR INSERT 
  WITH CHECK (true);

-- Policy 2: Allow anonymous UPDATE (anyone can update a session by id)
CREATE POLICY "Anyone can update sessions by id"
  ON anonymous_sessions 
  FOR UPDATE 
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT 'RLS policies added successfully!' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'anonymous_sessions' ORDER BY policyname;

