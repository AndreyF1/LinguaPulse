-- Migration: Create events table for universal analytics
-- Description: Tracks all user events throughout the funnel

CREATE TYPE event_type AS ENUM (
  'visit',
  'question_viewed',
  'question_answered',
  'funnel_completed',
  'paywall_view',
  'cta_click',
  'demo_start',
  'demo_message_sent',
  'demo_completed',
  'demo_abandoned',
  'magic_link_sent',
  'magic_link_clicked',
  'user_registered',
  'payment_started',
  'payment_success',
  'payment_failed',
  'first_lesson_start',
  'lesson_completed',
  'custom'
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification
  visitor_id UUID REFERENCES web_visitors(id) ON DELETE CASCADE,
  user_id UUID, -- will be linked to users(id) after migration
  session_id TEXT, -- browser session
  
  -- Event data
  event_type event_type NOT NULL,
  event_name TEXT, -- custom event name if event_type = 'custom'
  event_data JSONB DEFAULT '{}'::jsonb, -- flexible data for each event type
  
  -- Context
  page_url TEXT,
  referrer TEXT,
  user_agent TEXT,
  
  -- Device info
  device_type TEXT, -- mobile, tablet, desktop
  os TEXT,
  browser TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure at least one ID is present
  CONSTRAINT events_user_check CHECK (visitor_id IS NOT NULL OR user_id IS NOT NULL)
);

-- Indexes for analytics queries
CREATE INDEX idx_events_visitor ON events(visitor_id, created_at DESC);
CREATE INDEX idx_events_user ON events(user_id, created_at DESC);
CREATE INDEX idx_events_type ON events(event_type, created_at DESC);
CREATE INDEX idx_events_session ON events(session_id, created_at DESC);
CREATE INDEX idx_events_created_at ON events(created_at DESC);

-- GIN index for JSONB queries
CREATE INDEX idx_events_data ON events USING gin(event_data);

-- Comments
COMMENT ON TABLE events IS 'Universal event tracking for analytics and funnel analysis';
COMMENT ON COLUMN events.event_type IS 'Predefined event types for common actions';
COMMENT ON COLUMN events.event_data IS 'Flexible JSONB field for event-specific data';

-- Example event_data structures:
COMMENT ON COLUMN events.event_data IS 'Examples:
  visit: {"landing_page": "/", "utm_source": "google"}
  question_answered: {"question_number": 3, "answer": "intermediate"}
  demo_start: {"scenario": "Coffee Shop", "difficulty": "beginner"}
  payment_success: {"product_id": "uuid", "amount": 590, "provider": "yoomoney"}';

