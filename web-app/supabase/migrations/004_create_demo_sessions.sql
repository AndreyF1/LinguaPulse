-- Migration: Create demo_sessions table
-- Description: Stores demo conversation sessions (before user registers)

CREATE TYPE demo_end_reason AS ENUM (
  'completed',
  'timeout',
  'abandoned',
  'error',
  'user_stopped'
);

CREATE TABLE IF NOT EXISTS demo_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification
  visitor_id UUID REFERENCES web_visitors(id) ON DELETE CASCADE,
  user_id UUID, -- will be linked to users(id) after migration
  
  -- Demo configuration
  scenario_title TEXT NOT NULL,
  scenario_description TEXT,
  difficulty TEXT CHECK (difficulty IN ('beginner', 'intermediate', 'advanced')),
  target_language TEXT DEFAULT 'English',
  
  -- Conversation data
  transcript JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of messages
  message_count INTEGER DEFAULT 0,
  
  -- Audio (if voice demo)
  audio_url TEXT,
  audio_duration_seconds INTEGER,
  
  -- AI Feedback
  scores JSONB, -- {grammar: 8, vocabulary: 7, pronunciation: 6, fluency: 7}
  feedback_text TEXT,
  feedback_generated_at TIMESTAMPTZ,
  
  -- Session tracking
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  end_reason demo_end_reason,
  
  -- Conversion tracking
  converted_to_payment BOOLEAN DEFAULT false,
  payment_id UUID, -- will be linked to payments(id) after migration
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Ensure at least one ID is present
  CONSTRAINT demo_sessions_user_check CHECK (visitor_id IS NOT NULL OR user_id IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_demo_sessions_visitor ON demo_sessions(visitor_id, started_at DESC);
CREATE INDEX idx_demo_sessions_user ON demo_sessions(user_id, started_at DESC);
CREATE INDEX idx_demo_sessions_started_at ON demo_sessions(started_at DESC);
CREATE INDEX idx_demo_sessions_converted ON demo_sessions(converted_to_payment);
CREATE INDEX idx_demo_sessions_scenario ON demo_sessions(scenario_title);

-- GIN index for transcript search
CREATE INDEX idx_demo_sessions_transcript ON demo_sessions USING gin(transcript);

-- Comments
COMMENT ON TABLE demo_sessions IS 'Demo conversation sessions for lead generation';
COMMENT ON COLUMN demo_sessions.transcript IS 'Array of messages: [{role: "user", content: "Hello"}, {role: "assistant", content: "Hi!"}]';
COMMENT ON COLUMN demo_sessions.scores IS 'AI-generated scores: {grammar: 8, vocabulary: 7, pronunciation: 6}';
COMMENT ON COLUMN demo_sessions.converted_to_payment IS 'Whether this demo led to a payment';

