-- Обновление таблицы beginners_funnel
-- Убираем поле entered_bot_at и переносим created_at на второе место

-- Создаем временную таблицу с правильной структурой
CREATE TABLE beginners_funnel_new (
    telegram_id INTEGER PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now')),
    
    -- Этап 1: Завершил опросник и выбрал уровень "Начинающий/Beginner"
    completed_survey_at TEXT,
    
    -- Этап 2: Начал бесплатный урок (получил приветствие от Алекса)
    started_lesson0_at TEXT,
    
    -- Этап 3: Отправил первое аудио (тест микрофона - "Привет")
    sent_first_audio_at TEXT,
    
    -- Этап 4: Отправил второе аудио (представился - "Hello! My name is...")
    sent_intro_audio_at TEXT,
    
    -- Этап 5: Отправил третье аудио (назвал город - "I am from...")  
    sent_city_audio_at TEXT,
    
    -- Этап 6: Отправил финальное аудио (ответил на "How are you today?")
    sent_final_audio_at TEXT,
    
    -- Этап 7: Завершил бесплатный урок полностью
    completed_lesson0_at TEXT,
    
    -- Метаданные
    language_level TEXT, -- "Начинающий" или "Beginner"
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Копируем данные из старой таблицы (если есть)
INSERT INTO beginners_funnel_new (
    telegram_id, created_at, completed_survey_at, started_lesson0_at,
    sent_first_audio_at, sent_intro_audio_at, sent_city_audio_at,
    sent_final_audio_at, completed_lesson0_at, language_level, updated_at
)
SELECT 
    telegram_id, created_at, completed_survey_at, started_lesson0_at,
    sent_first_audio_at, sent_intro_audio_at, sent_city_audio_at,
    sent_final_audio_at, completed_lesson0_at, language_level, updated_at
FROM beginners_funnel;

-- Удаляем старую таблицу
DROP TABLE beginners_funnel;

-- Переименовываем новую таблицу
ALTER TABLE beginners_funnel_new RENAME TO beginners_funnel;

-- Создаем индексы заново
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_completed_survey ON beginners_funnel(completed_survey_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_started_lesson ON beginners_funnel(started_lesson0_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_completed_lesson ON beginners_funnel(completed_lesson0_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_created_at ON beginners_funnel(created_at);
