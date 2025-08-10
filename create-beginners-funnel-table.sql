-- Таблица для трекинга воронки начинающих пользователей
-- Отслеживает каждый этап прохождения бесплатного урока

CREATE TABLE IF NOT EXISTS beginners_funnel (
    telegram_id INTEGER PRIMARY KEY,
    
    -- Этап 1: Пользователь появился в боте
    entered_bot_at TEXT,
    
    -- Этап 2: Завершил опросник и выбрал уровень "Начинающий/Beginner"
    completed_survey_at TEXT,
    
    -- Этап 3: Начал бесплатный урок (получил приветствие от Алекса)
    started_lesson0_at TEXT,
    
    -- Этап 4: Отправил первое аудио (тест микрофона - "Привет")
    sent_first_audio_at TEXT,
    
    -- Этап 5: Отправил второе аудио (представился - "Hello! My name is...")
    sent_intro_audio_at TEXT,
    
    -- Этап 6: Отправил третье аудио (назвал город - "I am from...")  
    sent_city_audio_at TEXT,
    
    -- Этап 7: Отправил финальное аудио (ответил на "How are you today?")
    sent_final_audio_at TEXT,
    
    -- Этап 8: Завершил бесплатный урок полностью
    completed_lesson0_at TEXT,
    
    -- Метаданные
    language_level TEXT, -- "Начинающий" или "Beginner"
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Индексы для быстрых запросов по датам
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_entered_bot ON beginners_funnel(entered_bot_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_completed_survey ON beginners_funnel(completed_survey_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_started_lesson ON beginners_funnel(started_lesson0_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_completed_lesson ON beginners_funnel(completed_lesson0_at);
CREATE INDEX IF NOT EXISTS idx_beginners_funnel_created_at ON beginners_funnel(created_at);
