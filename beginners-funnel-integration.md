# Интеграция логирования воронки для начинающих пользователей

## 📊 Цель
Отслеживать каждый этап прохождения бесплатного урока начинающими пользователями для анализа конверсии и выявления узких мест в воронке.

## 🗄️ Структура таблицы `beginners_funnel`

### Основные поля:
- `telegram_id` - ID пользователя (PRIMARY KEY)
- `entered_bot_at` - Первое взаимодействие с ботом
- `completed_survey_at` - Завершение опроса и выбор уровня "Начинающий/Beginner"
- `started_lesson0_at` - Начало бесплатного урока (получение приветствия Алекса)
- `sent_first_audio_at` - Первое голосовое сообщение (тест микрофона)
- `sent_intro_audio_at` - Представление на английском ("Hello! My name is...")
- `sent_city_audio_at` - Упоминание города ("I am from...")
- `sent_final_audio_at` - Ответ на финальный вопрос ("How are you today?")
- `completed_lesson0_at` - Полное завершение урока
- `language_level` - "Начинающий" или "Beginner"

## 🔧 Места для интеграции логирования

### 1. telegram-webhook.js
**Этап: entered_bot_at**
```javascript
// При обработке команды /start для новых пользователей
// Добавить в функцию обработки /start:
if (isBeginnerLevel) {
    await logBeginnerFunnelStep(chatId, 'entered_bot_at', db);
}
```

### 2. newbies-funnel.js  
**Этап: completed_survey_at**
```javascript
// После сохранения результатов опроса в user_survey
// Если language_level === 'Начинающий' || language_level === 'Beginner':
if (language_level === 'Начинающий' || language_level === 'Beginner') {
    await logBeginnerFunnelStep(chatId, 'completed_survey_at', db);
}
```

### 3. lesson0-bot.js
**Этап: started_lesson0_at**
```javascript
// В начале функции runBeginnerScriptLesson
await logBeginnerFunnelStep(chatId, 'started_lesson0_at', db);
```

**Этап: sent_first_audio_at**
```javascript
// В handleBeginnerVoiceResponse при переходе с шага 0 на шаг 1
if (beginnerState.step === 0) {
    await logBeginnerFunnelStep(chatId, 'sent_first_audio_at', db);
}
```

**Этап: sent_intro_audio_at**
```javascript
// В handleBeginnerVoiceResponse при успешной валидации представления
if (beginnerState.step === 1 && hasIntroWords) {
    await logBeginnerFunnelStep(chatId, 'sent_intro_audio_at', db);
}
```

**Этап: sent_city_audio_at**
```javascript
// В handleBeginnerVoiceResponse при успешной валидации города
if (beginnerState.step === 2 && hasCityWords) {
    await logBeginnerFunnelStep(chatId, 'sent_city_audio_at', db);
}
```

**Этап: sent_final_audio_at**
```javascript
// В handleBeginnerVoiceResponse при получении финального ответа
if (beginnerState.step === 3) {
    await logBeginnerFunnelStep(chatId, 'sent_final_audio_at', db);
}
```

**Этап: completed_lesson0_at**
```javascript
// При завершении урока (показе конверсионного сообщения)
await logBeginnerFunnelStep(chatId, 'completed_lesson0_at', db);
```

## 🛠️ Вспомогательная функция

```javascript
// Добавить в каждый файл где нужно логирование
async function logBeginnerFunnelStep(chatId, step, db) {
  try {
    const now = new Date().toISOString();
    
    // Получаем уровень языка из user_survey
    const userSurvey = await db.prepare(
      'SELECT language_level FROM user_survey WHERE telegram_id = ?'
    ).bind(chatId).first();
    
    const languageLevel = userSurvey?.language_level;
    
    // Создаем запись если еще нет
    await db.prepare(`
      INSERT INTO beginners_funnel (telegram_id, language_level, ${step})
      VALUES (?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        ${step} = excluded.${step},
        updated_at = datetime('now')
    `).bind(chatId, languageLevel, now).run();
    
    console.log(`Logged beginner funnel step: ${step} for user ${chatId}`);
  } catch (error) {
    console.error(`Failed to log beginner funnel step ${step}:`, error);
  }
}
```

## 📈 Запросы для анализа воронки

### Конверсия по этапам:
```sql
SELECT 
  COUNT(entered_bot_at) as entered_bot,
  COUNT(completed_survey_at) as completed_survey,
  COUNT(started_lesson0_at) as started_lesson,
  COUNT(sent_first_audio_at) as sent_first_audio,
  COUNT(sent_intro_audio_at) as sent_intro,
  COUNT(sent_city_audio_at) as sent_city,
  COUNT(sent_final_audio_at) as sent_final,
  COUNT(completed_lesson0_at) as completed_lesson
FROM beginners_funnel
WHERE DATE(created_at) = '2025-08-10';
```

### Процент конверсии между этапами:
```sql
SELECT 
  ROUND(COUNT(completed_survey_at) * 100.0 / COUNT(entered_bot_at), 2) as survey_conversion,
  ROUND(COUNT(started_lesson0_at) * 100.0 / COUNT(completed_survey_at), 2) as lesson_start_conversion,
  ROUND(COUNT(sent_first_audio_at) * 100.0 / COUNT(started_lesson0_at), 2) as first_audio_conversion,
  ROUND(COUNT(completed_lesson0_at) * 100.0 / COUNT(sent_first_audio_at), 2) as completion_conversion
FROM beginners_funnel
WHERE entered_bot_at IS NOT NULL;
```

## ⚠️ Важные моменты

1. **Только для начинающих**: Логирование срабатывает только для пользователей с уровнем "Начинающий" или "Beginner"

2. **Не менять существующий функционал**: Логирование добавляется как дополнительные вызовы, не затрагивая основную логику

3. **Обработка ошибок**: Все вызовы логирования должны быть в try-catch, чтобы не ломать основной флоу

4. **Производительность**: Логирование асинхронное и не блокирует основные операции

5. **Данные в реальном времени**: Позволит отслеживать конверсию в режиме реального времени
