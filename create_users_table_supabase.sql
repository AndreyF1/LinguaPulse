-- Create users table in Supabase with correct schema
-- This script should be run in Supabase SQL Editor

-- Drop existing table if it exists (be careful with this in production!)
DROP TABLE IF EXISTS users CASCADE;

-- Create users table with correct schema
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT UNIQUE,
    username TEXT,
    interface_language TEXT DEFAULT 'ru',
    current_level TEXT CHECK (current_level IN ('Beginner', 'Intermediate', 'Advanced')),
    lessons_left INTEGER NOT NULL DEFAULT 0,
    package_expires_at TIMESTAMP WITH TIME ZONE,
    total_lessons_completed INTEGER NOT NULL DEFAULT 0,
    quiz_started_at TIMESTAMP WITH TIME ZONE,
    quiz_completed_at TIMESTAMP WITH TIME ZONE,
    last_payment_at TIMESTAMP WITH TIME ZONE,
    current_streak INTEGER NOT NULL DEFAULT 0,
    last_lesson_date DATE,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX idx_users_telegram_id ON users(telegram_id);
CREATE INDEX idx_users_is_active ON users(is_active);
CREATE INDEX idx_users_lessons_left ON users(lessons_left);
CREATE INDEX idx_users_created_at ON users(created_at);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
