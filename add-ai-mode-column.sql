-- Добавляем колонку для сохранения текущего режима ИИ пользователя
ALTER TABLE users 
ADD COLUMN IF NOT EXISTS ai_mode TEXT DEFAULT 'translation';

-- Создаем индекс для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_users_ai_mode ON users(ai_mode);

-- Комментарий для понимания
COMMENT ON COLUMN users.ai_mode IS 'Current AI mode: translation, grammar, text_dialog, audio_dialog';
