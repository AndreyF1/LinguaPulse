-- Migration: Setup Row Level Security (RLS) policies
-- Description: Enable RLS and create policies for all tables

-- ============================================
-- Enable RLS on all tables
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE text_usage_daily ENABLE ROW LEVEL SECURITY;

-- ============================================
-- USERS table policies
-- ============================================

-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- Service role can do everything (for server-side operations)
CREATE POLICY "Service role full access to users"
  ON users FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- WEB_VISITORS table policies
-- ============================================

-- Visitors are public for analytics (service role only)
CREATE POLICY "Service role can manage visitors"
  ON web_visitors FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Users can view their own converted visitor
CREATE POLICY "Users can view own visitor history"
  ON web_visitors FOR SELECT
  USING (converted_to_user_id = auth.uid());

-- ============================================
-- FUNNEL_ANSWERS table policies
-- ============================================

-- Service role full access (for server-side tracking)
CREATE POLICY "Service role can manage funnel answers"
  ON funnel_answers FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Users can view their own funnel answers
CREATE POLICY "Users can view own funnel answers"
  ON funnel_answers FOR SELECT
  USING (
    user_id = auth.uid()
    OR visitor_id IN (
      SELECT id FROM web_visitors WHERE converted_to_user_id = auth.uid()
    )
  );

-- ============================================
-- EVENTS table policies
-- ============================================

-- Service role full access (for server-side tracking)
CREATE POLICY "Service role can manage events"
  ON events FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Users can view their own events
CREATE POLICY "Users can view own events"
  ON events FOR SELECT
  USING (
    user_id = auth.uid()
    OR visitor_id IN (
      SELECT id FROM web_visitors WHERE converted_to_user_id = auth.uid()
    )
  );

-- ============================================
-- DEMO_SESSIONS table policies
-- ============================================

-- Service role full access
CREATE POLICY "Service role can manage demo sessions"
  ON demo_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- Users can view their own demo sessions (including anonymous ones)
CREATE POLICY "Users can view own demo sessions"
  ON demo_sessions FOR SELECT
  USING (
    user_id = auth.uid()
    OR visitor_id IN (
      SELECT id FROM web_visitors WHERE converted_to_user_id = auth.uid()
    )
  );

-- ============================================
-- LESSON_SESSIONS table policies
-- ============================================

-- Users can view their own lesson sessions
CREATE POLICY "Users can view own lesson sessions"
  ON lesson_sessions FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own lesson sessions
CREATE POLICY "Users can create own lesson sessions"
  ON lesson_sessions FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Service role full access
CREATE POLICY "Service role can manage lesson sessions"
  ON lesson_sessions FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- PAYMENTS table policies
-- ============================================

-- Users can view their own payments
CREATE POLICY "Users can view own payments"
  ON payments FOR SELECT
  USING (user_id = auth.uid());

-- Service role full access (for webhooks and admin)
CREATE POLICY "Service role can manage payments"
  ON payments FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- PRODUCTS table policies
-- ============================================

-- Products are public for reading (anyone can see available packages)
CREATE POLICY "Anyone can view active products"
  ON products FOR SELECT
  USING (is_active = true);

-- Only service role can modify products
CREATE POLICY "Service role can manage products"
  ON products FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- FEEDBACK table policies
-- ============================================

-- Users can view their own feedback
CREATE POLICY "Users can view own feedback"
  ON feedback FOR SELECT
  USING (user_id = auth.uid());

-- Users can insert their own feedback
CREATE POLICY "Users can create own feedback"
  ON feedback FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Service role full access
CREATE POLICY "Service role can manage feedback"
  ON feedback FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- TEXT_USAGE_DAILY table policies
-- ============================================

-- Users can view their own usage stats
CREATE POLICY "Users can view own usage stats"
  ON text_usage_daily FOR SELECT
  USING (user_id = auth.uid());

-- Service role full access (for updating stats)
CREATE POLICY "Service role can manage usage stats"
  ON text_usage_daily FOR ALL
  USING (auth.jwt()->>'role' = 'service_role');

-- ============================================
-- Helper function for checking service role
-- ============================================

-- Function to check if current user is service role (useful for Edge Functions)
CREATE OR REPLACE FUNCTION is_service_role()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN auth.jwt()->>'role' = 'service_role';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION is_service_role() IS 'Check if current user has service_role (for Edge Functions)';

