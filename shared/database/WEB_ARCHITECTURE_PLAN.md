# Web Architecture - Database Plan

## Текущая ситуация

### Telegram таблицы:
- **`users`** - основная (telegram_id, lessons_left, package_expires_at, streaks, etc)
- **`payments`** - платежи (YooMoney)
- **`products`** - пакеты подписок
- **`feedback`** - отзывы
- **`text_usage_daily`** - статистика

### Веб таблицы (уже созданы):
- **`profiles`** - минималистичные профили (id, username)
- **`sessions`** - история уроков (→ profiles.id)

### ❗ Проблема:
- `users` (Telegram) и `profiles` (Web) - две отдельные сущности
- `sessions` привязаны к `profiles`, но основная логика в `users`
- Нет связи между анонимными посетителями и зарегистрированными

---

## Предлагаемая архитектура для веб-воронки

### **Концепция: Unified User Model**

```
Анонимный визит → Воронка (10 вопросов) → Demo → Magic Link → Оплата → Уроки
     ↓                    ↓                   ↓          ↓          ↓
  anon_id           funnel_answers      demo_sessions  user_id   payments
```

### **Новые таблицы для воронки:**

#### 1. **`web_visitors`** (анонимные посетители)
```sql
CREATE TABLE web_visitors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Tracking
  first_visit_at TIMESTAMPTZ DEFAULT now(),
  last_visit_at TIMESTAMPTZ DEFAULT now(),
  
  -- Attribution
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  referrer TEXT,
  
  -- Device/Location
  user_agent TEXT,
  ip_address INET,
  country TEXT,
  
  -- Conversion
  converted_to_user_id UUID REFERENCES users(id), -- после регистрации
  converted_at TIMESTAMPTZ
);

CREATE INDEX idx_web_visitors_converted ON web_visitors(converted_to_user_id);
```

#### 2. **`funnel_answers`** (ответы на воронку)
```sql
CREATE TABLE funnel_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification (один из них заполнен)
  visitor_id UUID REFERENCES web_visitors(id),
  user_id UUID REFERENCES users(id),
  
  -- Question data
  question_number INTEGER NOT NULL, -- 1-10
  question_text TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  answer_label TEXT,
  
  -- Metadata
  answered_at TIMESTAMPTZ DEFAULT now(),
  time_spent_seconds INTEGER -- сколько думал
);

CREATE INDEX idx_funnel_answers_visitor ON funnel_answers(visitor_id);
CREATE INDEX idx_funnel_answers_user ON funnel_answers(user_id);
```

#### 3. **`events`** (универсальная аналитика)
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification
  visitor_id UUID REFERENCES web_visitors(id),
  user_id UUID REFERENCES users(id),
  session_id UUID, -- browser session
  
  -- Event data
  event_type TEXT NOT NULL, -- visit, question_answered, paywall_view, cta_click, demo_start, demo_end, purchase_success
  event_data JSONB, -- гибкие данные для каждого типа события
  
  -- Context
  page_url TEXT,
  referrer TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_visitor ON events(visitor_id, created_at DESC);
CREATE INDEX idx_events_user ON events(user_id, created_at DESC);
CREATE INDEX idx_events_type ON events(event_type);
CREATE INDEX idx_events_session ON events(session_id);
```

#### 4. **`demo_sessions`** (демо-диалоги)
```sql
CREATE TABLE demo_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User identification
  visitor_id UUID REFERENCES web_visitors(id),
  user_id UUID REFERENCES users(id),
  
  -- Demo data
  scenario_title TEXT NOT NULL,
  difficulty TEXT, -- beginner/intermediate/advanced
  transcript JSONB, -- полный диалог
  
  -- Audio (если есть)
  audio_url TEXT,
  duration_seconds INTEGER,
  
  -- Feedback от AI
  scores JSONB, -- {grammar: 8, vocabulary: 7, pronunciation: 6}
  feedback_text TEXT,
  
  -- Completion
  started_at TIMESTAMPTZ DEFAULT now(),
  ended_at TIMESTAMPTZ,
  end_reason TEXT, -- completed, timeout, abandoned, error
  
  -- Conversion tracking
  converted_to_payment BOOLEAN DEFAULT false
);

CREATE INDEX idx_demo_sessions_visitor ON demo_sessions(visitor_id);
CREATE INDEX idx_demo_sessions_user ON demo_sessions(user_id);
```

### **Модификации существующих таблиц:**

#### **`users`** - объединяем с `profiles`
```sql
ALTER TABLE users 
  -- Веб-аутентификация
  ADD COLUMN email TEXT UNIQUE,
  ADD COLUMN email_verified BOOLEAN DEFAULT false,
  ADD COLUMN auth_provider TEXT DEFAULT 'telegram', -- telegram, magic_link, google
  
  -- Связь с анонимным визитом
  ADD COLUMN visitor_id UUID REFERENCES web_visitors(id),
  
  -- Онбординг (из воронки)
  ADD COLUMN onboarding_completed BOOLEAN DEFAULT false,
  ADD COLUMN target_language TEXT, -- из воронки
  ADD COLUMN learning_goal TEXT, -- из воронки
  
  -- Для веб (из старой profiles)
  ADD COLUMN avatar_url TEXT,
  ADD COLUMN display_name TEXT;

-- Индексы
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_visitor ON users(visitor_id);
CREATE UNIQUE INDEX idx_users_telegram_id ON users(telegram_id) WHERE telegram_id IS NOT NULL;
```

#### **`payments`** - добавляем поддержку анонимных
```sql
ALTER TABLE payments
  ADD COLUMN visitor_id UUID REFERENCES web_visitors(id),
  ADD COLUMN session_id TEXT; -- browser session для атрибуции

-- user_id может быть NULL для анонимных платежей
ALTER TABLE payments ALTER COLUMN user_id DROP NOT NULL;

-- После создания юзера через magic link, обновим payment
```

#### **`sessions`** - переименовываем и связываем с users
```sql
-- Переименуем существующую таблицу
ALTER TABLE sessions RENAME TO lesson_sessions;

-- Меняем foreign key с profiles на users
ALTER TABLE lesson_sessions 
  DROP CONSTRAINT sessions_user_id_fkey,
  ADD CONSTRAINT lesson_sessions_user_id_fkey 
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```

#### **`profiles`** - удаляем (больше не нужна)
```sql
-- Переносим данные в users если нужно
INSERT INTO users (id, username, interface_language, lessons_left, total_lessons_completed, current_streak, is_active)
SELECT id, username, 'en', 0, 0, 0, true 
FROM profiles 
WHERE id NOT IN (SELECT id FROM users);

-- Удаляем profiles
DROP TABLE profiles CASCADE;
```

---

## События для аналитики (MVP)

### **Типы событий в таблице `events`:**

```typescript
type EventType = 
  | 'visit'               // визит на лендинг
  | 'question_viewed'     // вопрос показан
  | 'question_answered'   // ответ на вопрос
  | 'funnel_completed'    // все 10 вопросов пройдены
  | 'paywall_view'        // показан paywall
  | 'cta_click'           // клик CTA (demo / pay)
  | 'demo_start'          // начало демо
  | 'demo_message_sent'   // сообщение в демо
  | 'demo_completed'      // успешное завершение демо
  | 'demo_abandoned'      // пользователь ушёл из демо
  | 'magic_link_sent'     // magic link отправлен
  | 'magic_link_clicked'  // magic link открыт
  | 'user_registered'     // создан аккаунт
  | 'payment_started'     // клик на оплату
  | 'payment_success'     // успешная оплата
  | 'payment_failed'      // ошибка оплаты
  | 'first_lesson_start'  // первый урок

// Пример event_data для разных событий:
{
  // visit
  "utm_source": "google",
  "utm_medium": "cpc",
  "landing_page": "/",
  
  // question_answered
  "question_number": 3,
  "answer": "intermediate",
  "time_spent_ms": 2500,
  
  // demo_start
  "scenario": "Coffee Shop",
  "difficulty": "beginner",
  
  // payment_success
  "product_id": "uuid",
  "amount": 590,
  "provider": "yoomoney"
}
```

---

## Воронка (10 вопросов) - примерная структура

```javascript
const funnelQuestions = [
  { id: 1, text: "Какой язык хотите изучать?", type: "choice", options: ["English", "Spanish", "German"] },
  { id: 2, text: "Ваш текущий уровень?", type: "choice", options: ["Beginner", "Intermediate", "Advanced"] },
  { id: 3, text: "Какая цель обучения?", type: "choice", options: ["Работа", "Путешествия", "Хобби"] },
  { id: 4, text: "Сколько времени можете уделять?", type: "choice", options: ["10 мин/день", "30 мин/день", "1 час/день"] },
  { id: 5, text: "Пробовали учить раньше?", type: "yes_no" },
  // ... ещё 5 вопросов для engagement
]
```

---

## Миграция данных

### **Шаг 1: Создать новые таблицы**
```sql
-- web_visitors, events, funnel_answers, demo_sessions
```

### **Шаг 2: Модифицировать users**
```sql
-- добавить новые колонки (email, auth_provider, visitor_id, etc)
```

### **Шаг 3: Перенести profiles → users**
```sql
-- если есть данные в profiles
```

### **Шаг 4: Удалить profiles**
```sql
DROP TABLE profiles CASCADE;
```

### **Шаг 5: Переименовать sessions → lesson_sessions**
```sql
ALTER TABLE sessions RENAME TO lesson_sessions;
```

---

## Workflow: Анонимный → Зарегистрированный

```javascript
// 1. Пользователь попадает на лендинг
const visitorId = await createWebVisitor({ utm_source, utm_medium, referrer });

// 2. Проходит воронку (10 вопросов)
await saveFunnelAnswer({ visitor_id: visitorId, question: 1, answer: "English" });
// ... answers 2-10

// 3. Видит paywall → клик "Demo"
await trackEvent({ visitor_id: visitorId, event_type: 'cta_click', event_data: { action: 'demo' } });

// 4. Проходит демо-диалог
const demoId = await startDemo({ visitor_id: visitorId, scenario: "Coffee Shop" });
// ... диалог
await endDemo({ demo_id: demoId, end_reason: 'completed' });

// 5. Возвращается на paywall → клик "Оплатить"
await trackEvent({ visitor_id: visitorId, event_type: 'payment_started' });

// 6. Magic Link для регистрации перед оплатой
await sendMagicLink({ email: "user@example.com", visitor_id: visitorId });

// 7. Создание пользователя
const userId = await createUser({
  email: "user@example.com",
  auth_provider: "magic_link",
  visitor_id: visitorId, // связь с анонимной историей
  // данные из воронки
  target_language: "English",
  current_level: "Intermediate",
  learning_goal: "Работа"
});

// 8. Обновляем visitor → converted
await updateWebVisitor(visitorId, { converted_to_user_id: userId, converted_at: now() });

// 9. Оплата (уже с user_id)
await processPayment({ user_id: userId, visitor_id: visitorId, product_id, amount });

// 10. Первый урок
await trackEvent({ user_id: userId, event_type: 'first_lesson_start' });
```

---

## RLS (Row Level Security) для веб

```sql
-- users: пользователи видят только себя
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users FOR UPDATE
  USING (auth.uid() = id);

-- lesson_sessions: только свои уроки
CREATE POLICY "Users can view own sessions"
  ON lesson_sessions FOR SELECT
  USING (auth.uid() = user_id);

-- demo_sessions: анонимные видят по visitor_id, авторизованные по user_id
CREATE POLICY "Users can view own demos"
  ON demo_sessions FOR SELECT
  USING (
    auth.uid() = user_id 
    OR visitor_id IN (SELECT id FROM web_visitors WHERE converted_to_user_id = auth.uid())
  );

-- events: аналогично
CREATE POLICY "Users can view own events"
  ON events FOR SELECT
  USING (
    auth.uid() = user_id
    OR visitor_id IN (SELECT id FROM web_visitors WHERE converted_to_user_id = auth.uid())
  );
```

---

## Frontend: Supabase Auth для Magic Link

```typescript
// 1. Отправка magic link
const { error } = await supabase.auth.signInWithOtp({
  email: 'user@example.com',
  options: {
    emailRedirectTo: 'https://linguapulse.com/auth/callback',
    data: {
      visitor_id: visitorId, // передаём в metadata
    }
  }
});

// 2. Callback после клика на magic link
const { data: { session } } = await supabase.auth.getSession();
const userId = session.user.id;

// 3. Создание/обновление пользователя в users таблице
await supabase.from('users').upsert({
  id: userId,
  email: session.user.email,
  visitor_id: visitorId,
  auth_provider: 'magic_link',
  // ... данные из воронки
});
```

---

## Выводы

### ✅ Преимущества предложенной архитектуры:

1. **Единая таблица users** - нет дублирования между Telegram и Web
2. **Анонимная аналитика** - видим весь путь от первого визита до оплаты
3. **Гибкая event tracking** - легко добавлять новые события
4. **Attribution** - UTM метки сохраняются и связываются с платежами
5. **Переиспользование** - payments, products работают для обеих версий
6. **Privacy-friendly** - можно удалять анонимные данные после конверсии

### 📊 Аналитика, которую получим:

- **Conversion funnel**: Landing → Question 10 → Paywall → Demo → Payment
- **Drop-off analysis**: на каком вопросе отваливаются?
- **Demo effectiveness**: сколько после демо покупают?
- **Attribution**: какие источники приводят платящих?
- **A/B testing**: разные варианты вопросов/paywall/демо

### 🚀 Что нужно сделать:

1. ✅ Создать SQL миграции для новых таблиц
2. ✅ Обновить users таблицу (добавить email, auth_provider, etc)
3. ✅ Настроить RLS политики
4. ✅ Создать TypeScript типы для фронтенда
5. ✅ Реализовать event tracking (хук `useTrackEvent`)
6. ✅ Настроить Supabase Auth (Magic Link)

**Готов начать с миграций?** 🎯

