-- Добавление новых столбцов для функционала текстового помощника
-- Выполните этот SQL в Supabase Dashboard -> SQL Editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS text_trial_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS text_messages_total INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_text_used_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS waitlist_voice BOOLEAN DEFAULT false;

-- Создание таблицы для отслеживания ежедневного использования текстового помощника
CREATE TABLE IF NOT EXISTS text_usage_daily (
  user_id UUID REFERENCES users(id),
  day DATE NOT NULL,
  messages INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

-- Проверка результатов
SELECT 
  column_name, 
  data_type, 
  is_nullable, 
  column_default 
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('text_trial_ends_at', 'text_messages_total', 'last_text_used_at', 'waitlist_voice')
ORDER BY column_name;

-- Проверка создания таблицы text_usage_daily
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'text_usage_daily'
ORDER BY ordinal_position;
