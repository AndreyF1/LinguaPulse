-- Migration: Create funnel_answers table
-- Description: Stores answers to onboarding funnel questions (10 questions)

CREATE TABLE IF NOT EXISTS funnel_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification (one of these will be filled)
  visitor_id UUID REFERENCES web_visitors(id) ON DELETE CASCADE,
  user_id UUID, -- will be linked to users(id) after migration
  
  -- Question data
  question_number INTEGER NOT NULL CHECK (question_number BETWEEN 1 AND 10),
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL, -- choice, yes_no, text, range
  answer_value TEXT NOT NULL,
  answer_label TEXT, -- human-readable label
  
  -- Metadata
  answered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  time_spent_seconds INTEGER, -- how long user thought before answering
  
  -- Additional context
  page_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Ensure at least one ID is present
  CONSTRAINT funnel_answers_user_check CHECK (visitor_id IS NOT NULL OR user_id IS NOT NULL)
);

-- Indexes
CREATE INDEX idx_funnel_answers_visitor ON funnel_answers(visitor_id, question_number);
CREATE INDEX idx_funnel_answers_user ON funnel_answers(user_id, question_number);
CREATE INDEX idx_funnel_answers_question ON funnel_answers(question_number);
CREATE INDEX idx_funnel_answers_answered_at ON funnel_answers(answered_at DESC);

-- Unique constraint: one answer per question per user/visitor
CREATE UNIQUE INDEX idx_funnel_answers_visitor_question 
  ON funnel_answers(visitor_id, question_number) 
  WHERE visitor_id IS NOT NULL;

CREATE UNIQUE INDEX idx_funnel_answers_user_question 
  ON funnel_answers(user_id, question_number) 
  WHERE user_id IS NOT NULL;

-- Comments
COMMENT ON TABLE funnel_answers IS 'Stores user answers to onboarding funnel questions';
COMMENT ON COLUMN funnel_answers.question_number IS 'Question number from 1 to 10';
COMMENT ON COLUMN funnel_answers.time_spent_seconds IS 'Time user spent thinking before answering';

