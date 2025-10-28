-- Migration: Modify users table to support both Telegram and Web users
-- Description: Add email auth, web fields, and link to anonymous visitors

-- Add new columns for web authentication
ALTER TABLE users 
  -- Web authentication
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'telegram',
  
  -- Link to anonymous visitor
  ADD COLUMN IF NOT EXISTS visitor_id UUID,
  
  -- Onboarding data (from funnel)
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_language TEXT,
  ADD COLUMN IF NOT EXISTS learning_goal TEXT,
  ADD COLUMN IF NOT EXISTS time_commitment TEXT,
  
  -- Web-specific profile fields
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  
  -- Timestamps
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Add foreign key constraint to web_visitors
ALTER TABLE users
  ADD CONSTRAINT users_visitor_id_fkey 
  FOREIGN KEY (visitor_id) REFERENCES web_visitors(id) ON DELETE SET NULL;

-- Add foreign key to web_visitors.converted_to_user_id (now that users has the columns)
ALTER TABLE web_visitors
  ADD CONSTRAINT web_visitors_converted_user_fkey
  FOREIGN KEY (converted_to_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- Create unique index on email (only for non-null values)
CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;

-- Create unique index on telegram_id (only for non-null values)
DROP INDEX IF EXISTS idx_users_telegram_id;
CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL;

-- Create indexes for new columns
CREATE INDEX idx_users_visitor ON users(visitor_id);
CREATE INDEX idx_users_auth_provider ON users(auth_provider);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

-- Make telegram_id nullable (was required before, now optional for web users)
ALTER TABLE users ALTER COLUMN telegram_id DROP NOT NULL;

-- Add check constraint: must have either telegram_id or email
ALTER TABLE users 
  ADD CONSTRAINT users_identity_check 
  CHECK (telegram_id IS NOT NULL OR email IS NOT NULL);

-- Add check constraint for auth_provider
ALTER TABLE users
  ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('telegram', 'magic_link', 'google', 'email'));

-- Update function for updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments
COMMENT ON COLUMN users.email IS 'Email for web users (magic link auth)';
COMMENT ON COLUMN users.auth_provider IS 'Authentication method: telegram, magic_link, google, email';
COMMENT ON COLUMN users.visitor_id IS 'Links to anonymous visitor before registration';
COMMENT ON COLUMN users.target_language IS 'Language user wants to learn (from funnel)';
COMMENT ON COLUMN users.learning_goal IS 'User goal: Work, Travel, Hobby (from funnel)';
COMMENT ON COLUMN users.onboarding_completed IS 'Whether user completed onboarding flow';

