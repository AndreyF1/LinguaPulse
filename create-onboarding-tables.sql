-- Create tables for onboarding funnel

-- Table for user interface preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    telegram_id INTEGER PRIMARY KEY,
    interface_language TEXT NOT NULL CHECK (interface_language IN ('ru', 'en')),
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- Table for user survey responses
CREATE TABLE IF NOT EXISTS user_survey (
    telegram_id INTEGER PRIMARY KEY,
    language_level TEXT,
    study_goal TEXT,
    gender TEXT,
    age TEXT,
    telegram_preference TEXT,
    voice_usage TEXT,
    completed_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_user_preferences_language ON user_preferences(interface_language);
CREATE INDEX IF NOT EXISTS idx_user_survey_completed_at ON user_survey(completed_at); 