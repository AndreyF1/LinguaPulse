-- Migration: Modify payments and sessions tables for web support
-- Description: Add visitor tracking to payments, rename sessions, link foreign keys

-- ============================================
-- 1. Modify payments table
-- ============================================

-- Add visitor_id for anonymous payments (before user registers)
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS visitor_id UUID,
  ADD COLUMN IF NOT EXISTS session_id TEXT; -- browser session for attribution

-- Add foreign key to web_visitors
ALTER TABLE payments
  ADD CONSTRAINT payments_visitor_id_fkey
  FOREIGN KEY (visitor_id) REFERENCES web_visitors(id) ON DELETE SET NULL;

-- Make user_id nullable (can be null for anonymous payments)
ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;

-- Add check: must have either user_id or visitor_id
ALTER TABLE payments
  ADD CONSTRAINT payments_identity_check
  CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL);

-- Add index
CREATE INDEX idx_payments_visitor ON payments(visitor_id);
CREATE INDEX idx_payments_session ON payments(session_id);

-- Link foreign key to users now
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Comments
COMMENT ON COLUMN payments.visitor_id IS 'For anonymous payments before user registration';
COMMENT ON COLUMN payments.session_id IS 'Browser session ID for attribution';

-- ============================================
-- 2. Rename sessions → lesson_sessions
-- ============================================

-- Rename the table
ALTER TABLE IF EXISTS sessions RENAME TO lesson_sessions;

-- Update foreign key constraint to point to users instead of profiles
ALTER TABLE lesson_sessions DROP CONSTRAINT IF EXISTS sessions_user_id_fkey;
ALTER TABLE lesson_sessions DROP CONSTRAINT IF EXISTS lesson_sessions_user_id_fkey;
ALTER TABLE lesson_sessions
  ADD CONSTRAINT lesson_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Rename indexes
ALTER INDEX IF EXISTS idx_sessions_user RENAME TO idx_lesson_sessions_user;
ALTER INDEX IF EXISTS sessions_pkey RENAME TO lesson_sessions_pkey;

-- Update trigger if exists
DROP TRIGGER IF EXISTS update_sessions_updated_at ON lesson_sessions;

-- Add updated_at column if not exists
ALTER TABLE lesson_sessions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE TRIGGER update_lesson_sessions_updated_at
  BEFORE UPDATE ON lesson_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON TABLE lesson_sessions IS 'Full lesson sessions with AI feedback (after user has access)';
COMMENT ON COLUMN lesson_sessions.user_id IS 'User who completed this lesson';

-- ============================================
-- 3. Link foreign keys in other tables
-- ============================================

-- Link funnel_answers.user_id → users
ALTER TABLE funnel_answers DROP CONSTRAINT IF EXISTS funnel_answers_user_id_fkey;
ALTER TABLE funnel_answers
  ADD CONSTRAINT funnel_answers_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Link events.user_id → users
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_user_id_fkey;
ALTER TABLE events
  ADD CONSTRAINT events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Link demo_sessions.user_id → users
ALTER TABLE demo_sessions DROP CONSTRAINT IF EXISTS demo_sessions_user_id_fkey;
ALTER TABLE demo_sessions
  ADD CONSTRAINT demo_sessions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- Link demo_sessions.payment_id → payments
ALTER TABLE demo_sessions DROP CONSTRAINT IF EXISTS demo_sessions_payment_id_fkey;
ALTER TABLE demo_sessions
  ADD CONSTRAINT demo_sessions_payment_id_fkey
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE SET NULL;

