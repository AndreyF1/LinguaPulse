-- Migration: Create web_visitors table for anonymous visitor tracking
-- Description: Tracks anonymous visitors before they register, with UTM attribution

CREATE TABLE IF NOT EXISTS web_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tracking
  first_visit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_visit_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Attribution (UTM parameters)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  utm_term TEXT,
  referrer TEXT,
  
  -- Device/Location info
  user_agent TEXT,
  ip_address INET,
  country TEXT,
  city TEXT,
  
  -- Browser session tracking
  session_id TEXT, -- client-side generated session ID
  
  -- Conversion tracking
  converted_to_user_id UUID, -- will be linked to users(id) after migration
  converted_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Indexes for performance
CREATE INDEX idx_web_visitors_converted ON web_visitors(converted_to_user_id);
CREATE INDEX idx_web_visitors_session ON web_visitors(session_id);
CREATE INDEX idx_web_visitors_first_visit ON web_visitors(first_visit_at DESC);
CREATE INDEX idx_web_visitors_utm_source ON web_visitors(utm_source);

-- Comments
COMMENT ON TABLE web_visitors IS 'Tracks anonymous visitors before registration with UTM attribution';
COMMENT ON COLUMN web_visitors.converted_to_user_id IS 'Links to users.id after registration';
COMMENT ON COLUMN web_visitors.session_id IS 'Client-side browser session ID for tracking';

