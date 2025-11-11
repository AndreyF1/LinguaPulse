-- DEBUG: Check current RLS policies on anonymous_sessions

-- 1. Check if RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename = 'anonymous_sessions';
-- Expected: rowsecurity = true

-- 2. Check all policies
SELECT 
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'anonymous_sessions'
ORDER BY cmd, policyname;

-- Expected 4 policies:
-- 1. "Service role can manage anonymous sessions" - cmd: ALL
-- 2. "Users can view own converted sessions" - cmd: SELECT
-- 3. "Anonymous users can create sessions" - cmd: INSERT
-- 4. "Anyone can update sessions by id" - cmd: UPDATE

-- 3. Check table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'anonymous_sessions'
ORDER BY ordinal_position;

-- 4. Try to insert as anonymous (this will test the policy)
-- This should work if policy is correct:
INSERT INTO anonymous_sessions (
  utm_source,
  funnel_answers,
  funnel_completed,
  demo_completed,
  user_agent
) VALUES (
  'test',
  '[]'::jsonb,
  false,
  false,
  'test'
) RETURNING id;
-- If this fails with RLS error, policy is not working

