-- Migration: Radical simplification - merge 4 anonymous tables into 1
-- Description: Replace web_visitors, events, funnel_answers, demo_sessions with single anonymous_sessions table

-- ============================================
-- 1. Create new unified anonymous_sessions table
-- ============================================

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Attribution (UTM tracking)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  referrer TEXT,
  
  -- Funnel data (JSONB instead of separate table)
  funnel_answers JSONB DEFAULT '[]'::jsonb,
  -- Example: [{"question": 1, "answer": "English", "time_spent": 5}, ...]
  funnel_completed BOOLEAN DEFAULT false,
  
  -- Demo session data (JSONB instead of separate table)
  demo_scenario TEXT,
  demo_transcript JSONB,
  -- Example: [{"role": "user", "content": "Hello"}, {"role": "ai", "content": "Hi!"}]
  demo_feedback TEXT,
  demo_scores JSONB,
  -- Example: {"grammar": 8, "vocabulary": 7, "pronunciation": 6}
  demo_completed BOOLEAN DEFAULT false,
  
  -- Conversion tracking
  converted_to_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  converted_at TIMESTAMPTZ,
  
  -- Device/Browser info (optional)
  user_agent TEXT,
  
  -- Meta
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_anonymous_sessions_converted ON anonymous_sessions(converted_to_user_id);
CREATE INDEX idx_anonymous_sessions_utm_source ON anonymous_sessions(utm_source);
CREATE INDEX idx_anonymous_sessions_created_at ON anonymous_sessions(created_at DESC);
CREATE INDEX idx_anonymous_sessions_funnel_completed ON anonymous_sessions(funnel_completed);
CREATE INDEX idx_anonymous_sessions_demo_completed ON anonymous_sessions(demo_completed);

-- GIN indexes for JSONB queries
CREATE INDEX idx_anonymous_sessions_funnel ON anonymous_sessions USING gin(funnel_answers);
CREATE INDEX idx_anonymous_sessions_demo ON anonymous_sessions USING gin(demo_transcript);

-- Comments
COMMENT ON TABLE anonymous_sessions IS 'Unified table for anonymous user sessions: attribution, funnel, demo - everything in one place';
COMMENT ON COLUMN anonymous_sessions.funnel_answers IS 'Array of funnel Q&A: [{"question": 1, "answer": "English"}]';
COMMENT ON COLUMN anonymous_sessions.demo_transcript IS 'Demo conversation: [{"role": "user", "content": "Hello"}]';
COMMENT ON COLUMN anonymous_sessions.converted_to_user_id IS 'User ID after registration, NULL if not converted';

-- ============================================
-- 2. Drop old anonymous-related tables
-- ============================================

-- Drop RLS policies first
DROP POLICY IF EXISTS "Service role can manage visitors" ON web_visitors;
DROP POLICY IF EXISTS "Users can view own visitor history" ON web_visitors;

DROP POLICY IF EXISTS "Service role can manage funnel answers" ON funnel_answers;
DROP POLICY IF EXISTS "Users can view own funnel answers" ON funnel_answers;

DROP POLICY IF EXISTS "Service role can manage events" ON events;
DROP POLICY IF EXISTS "Users can view own events" ON events;

DROP POLICY IF EXISTS "Service role can manage demo sessions" ON demo_sessions;
DROP POLICY IF EXISTS "Users can view own demo sessions" ON demo_sessions;

-- Drop tables
DROP TABLE IF EXISTS demo_sessions CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS funnel_answers CASCADE;
DROP TABLE IF EXISTS web_visitors CASCADE;

-- Drop ENUMs
DROP TYPE IF EXISTS event_type CASCADE;
DROP TYPE IF EXISTS demo_end_reason CASCADE;

-- ============================================
-- 3. Clean up visitor_id references
-- ============================================

-- Remove visitor_id from users
ALTER TABLE users DROP COLUMN IF EXISTS visitor_id;

-- Remove visitor_id from payments
ALTER TABLE payments DROP COLUMN IF EXISTS visitor_id;

-- ============================================
-- 4. Setup RLS for anonymous_sessions
-- ============================================

ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;

-- Service role full access
CREATE POLICY "Service role can manage anonymous sessions"
  ON anonymous_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Users can view their own converted sessions
CREATE POLICY "Users can view own converted sessions"
  ON anonymous_sessions FOR SELECT
  USING (converted_to_user_id = auth.uid());

-- ============================================
-- 5. Add trigger for updated_at
-- ============================================

CREATE TRIGGER update_anonymous_sessions_updated_at
  BEFORE UPDATE ON anonymous_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. Log migration
-- ============================================

DO $$
BEGIN
  RAISE NOTICE '=== RADICAL SIMPLIFICATION COMPLETE ===';
  RAISE NOTICE 'Deleted 4 tables: web_visitors, events, funnel_answers, demo_sessions';
  RAISE NOTICE 'Created 1 table: anonymous_sessions (unified)';
  RAISE NOTICE 'Removed visitor_id from users and payments';
  RAISE NOTICE 'Total tables: 5 (was 8, reduction: 38%%)';
END $$;

COMMENT ON DATABASE postgres IS 'Radically simplified: 4 anonymous tables merged into 1';

