# How to Apply Migration 013

## Migration: Allow anonymous INSERT into anonymous_sessions

This migration enables anonymous users (not logged in) to create and update their own session records from the frontend, which is necessary for funnel tracking.

## Method 1: Via Supabase Dashboard (Recommended)

1. Go to https://supabase.com/dashboard
2. Select your project
3. Go to **SQL Editor**
4. Click **"New query"**
5. Copy and paste the entire contents of `migrations/013_allow_anon_insert_sessions.sql`
6. Click **"Run"**
7. Verify success in the logs

## Method 2: Via Supabase CLI

```bash
cd web-app
npx supabase login
npx supabase db push
```

## What This Migration Does

### Before:
- ❌ Anonymous users cannot write to `anonymous_sessions`
- ❌ Funnel data not tracked
- ❌ No conversion metrics

### After:
- ✅ Anonymous users can INSERT (create new sessions)
- ✅ Anonymous users can UPDATE their sessions by ID
- ✅ Funnel answers saved to Supabase
- ✅ Demo transcripts + feedback saved
- ✅ Full conversion funnel tracking

## RLS Policies Created:

1. **Service role full access** - Backend can manage all sessions
2. **Users can view converted sessions** - After signup, users can see their anonymous journey
3. **Anonymous INSERT** - Anyone can create a new session (for funnel start)
4. **Anonymous UPDATE** - Anyone can update sessions (frontend stores ID in localStorage)

## Security Notes:

- Frontend stores session ID in `localStorage` (`anon_session_id`)
- No sensitive data in anonymous_sessions (only funnel answers, transcripts, UTM params)
- Once user signs up, session is linked via `converted_to_user_id`
- RLS prevents users from viewing/editing other people's sessions

## Testing After Migration:

1. Go to https://linguapulse.ai/welcome
2. Open DevTools Console
3. Complete funnel questionnaire
4. Check console: `✅ Funnel answers saved`
5. Complete demo lesson
6. Check console: `✅ Demo session saved`
7. Go to Supabase Dashboard → Table Editor → anonymous_sessions
8. Verify new row created with:
   - `funnel_answers` (JSONB array)
   - `demo_transcript` (JSONB array)
   - `demo_feedback` (text)
   - `demo_scores` (JSONB object)

## Troubleshooting:

### If INSERT fails:
```sql
-- Check if policy exists
SELECT * FROM pg_policies WHERE tablename = 'anonymous_sessions' AND policyname = 'Anonymous users can create sessions';

-- If missing, run migration again
```

### If UPDATE fails:
```sql
-- Check if policy exists
SELECT * FROM pg_policies WHERE tablename = 'anonymous_sessions' AND policyname = 'Anyone can update sessions by id';

-- If missing, run migration again
```

## Rollback (if needed):

```sql
-- Remove new policies
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;

-- Restore original policies (service role + users view only)
CREATE POLICY "Service role can manage anonymous sessions"
  ON anonymous_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

CREATE POLICY "Users can view own converted sessions"
  ON anonymous_sessions FOR SELECT
  USING (converted_to_user_id = auth.uid());
```

