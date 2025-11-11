-- Check current RLS policies on anonymous_sessions table

SELECT 
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies 
WHERE tablename = 'anonymous_sessions'
ORDER BY policyname;

-- Expected policies after migration 013:
-- 1. "Service role can manage anonymous sessions" - FOR ALL
-- 2. "Users can view own converted sessions" - FOR SELECT
-- 3. "Anonymous users can create sessions" - FOR INSERT
-- 4. "Anyone can update sessions by id" - FOR UPDATE

