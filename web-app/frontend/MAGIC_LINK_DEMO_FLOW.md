# Magic Link Registration Flow (Demo → User)

## 🎯 Общий флоу

```
Анонимный пользователь
    ↓
Проходит воронку (10 вопросов)
    ↓
Нажимает "Демо 5 минут"
    ↓
Проходит демо-урок (5 мин)
    ↓
Вводит email для получения фидбэка
    ↓
Получает Magic Link на email
    ↓
Переходит по ссылке (Magic Link)
    ↓
Автоматическая регистрация (создан user в Supabase)
    ↓
Redirect на: /?view=demo-feedback
    ↓
Загрузка данных из anonymous_sessions
    ↓
Сохранение в sessions (History)
    ↓
Связывание sessionId → userId (converted_to_user_id)
    ↓
Показ ConversationScreen с initialFeedback
    ↓
FeedbackModal автоматически открыт
    ↓
Пользователь видит отчет + может купить доступ
```

---

## 📧 Отправка Magic Link

### EmailForm.tsx

**Когда пользователь вводит email:**

1. Сохраняем `demo_session_id` в localStorage:
   ```typescript
   localStorage.setItem('demo_session_id', sessionId);
   ```

2. Отправляем Magic Link:
   ```typescript
   await supabase.auth.signInWithOtp({
     email: email,
     options: {
       emailRedirectTo: `${window.location.origin}/?view=demo-feedback`
     }
   });
   ```
   
   **⚠️ ВАЖНО:** Redirect на `/` (главная страница продукта), **НЕ на `/welcome` (воронка)**!

3. Показываем экран успеха:
   ```
   ✉️ Отчет отправлен!
   Мы отправили подробный фидбэк по вашему демо-уроку на: email@example.com
   [Вернуться назад]
   ```

---

## 🔗 Обработка Magic Link

### MainApp.tsx (Главная страница продукта)

**Когда пользователь переходит по ссылке:**

1. **URL:** `/?view=demo-feedback`

2. **Загрузка данных из Supabase:**
   ```typescript
   const { data } = await supabase
     .from('anonymous_sessions')
     .select('*')
     .eq('id', demoSessionId)
     .single();
   ```

3. **Конвертация данных:**
   ```typescript
   // demo_transcript → TranscriptEntry[]
   const transcript: TranscriptEntry[] = data.demo_transcript.map((entry, i) => ({
     id: `demo-${i}`,
     speaker: entry.role === 'user' ? 'user' : 'ai',
     text: entry.content,
     isFinal: true
   }));
   
   // demo_feedback + demo_scores → FinalFeedback
   const feedback: FinalFeedback = {
     text: data.demo_feedback,
     scores: data.demo_scores
   };
   ```

4. **Сохранение в History:**
   ```typescript
   const newSession: NewSessionData = {
     scenario_title: 'Demo Lesson (5 min)',
     difficulty: 'intermediate',
     transcript: data.demo_transcript,
     scores: data.demo_scores,
     feedback_text: data.demo_feedback
   };
   
   await addSessionToCurrentUser(newSession);
   // Теперь демо урок в таблице sessions (History)
   ```

5. **Связать session с user:**
   ```typescript
   await markSessionAsConverted(demoSessionId, currentUser.id);
   // Обновляет в Supabase:
   // - converted_to_user_id = currentUser.id
   // - converted_at = now()
   
   localStorage.removeItem('demo_session_id');
   ```

6. **Показать ConversationScreen с feedback:**
   ```typescript
   setDemoFeedbackData({ transcript, feedback });
   
   // Затем в renderView():
   <ConversationScreen
     scenario={{ title: 'Demo Lesson (5 min)', ... }}
     initialTranscript={transcript}
     initialFeedback={feedback}  // ← Pre-loaded!
     ...
   />
   ```

7. **ConversationScreen с initialFeedback:**
   - Статус сразу `IDLE` (не `CONNECTING`)
   - `FeedbackModal` автоматически открыт
   - Live API session **НЕ запускается**
   - Таймер **НЕ запускается**
   - Пользователь видит отчет сразу

8. **Очистить URL:**
   ```typescript
   window.history.replaceState({}, '', '/');
   ```

---

## 🗄️ База данных

### Таблица: `anonymous_sessions`

**До регистрации:**
```sql
{
  id: 'uuid...',
  demo_transcript: [{role: 'user', content: 'Hello'}, ...],
  demo_feedback: '### Vocabulary\n...',
  demo_scores: {grammar: 85, ...},
  demo_completed: true,
  converted_to_user_id: NULL,  ← Еще не связано
  converted_at: NULL
}
```

**После регистрации:**
```sql
{
  id: 'uuid...',
  ...
  converted_to_user_id: 'user-uuid',  ← Связано!
  converted_at: '2025-11-11T18:30:00Z'
}
```

### Таблица: `users`

**Создается автоматически при переходе по Magic Link:**
```sql
{
  id: 'uuid...',
  email: 'user@example.com',
  email_confirmed_at: '2025-11-11T18:30:00Z',
  created_at: '2025-11-11T18:30:00Z',
  ...
}
```

---

## 🔒 RLS Политики

### anonymous_sessions:

1. **anon может INSERT:**
   ```sql
   CREATE POLICY "allow_all_anonymous"
     ON anonymous_sessions FOR ALL
     TO anon
     USING (true) WITH CHECK (true);
   ```

2. **authenticated может SELECT свои:**
   ```sql
   CREATE POLICY "Users can view own converted sessions"
     ON anonymous_sessions FOR SELECT
     USING (converted_to_user_id = auth.uid());
   ```

3. **authenticated может UPDATE:**
   ```sql
   CREATE POLICY "allow_all_authenticated"
     ON anonymous_sessions FOR ALL
     TO authenticated
     USING (true) WITH CHECK (true);
   ```

---

## 📊 Метрики конверсии

### SQL для аналитики:

**Конверсия демо → регистрация:**
```sql
SELECT 
  COUNT(*) as total_demo_completed,
  COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as registered,
  ROUND(100.0 * COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) / COUNT(*), 2) as conversion_rate
FROM anonymous_sessions
WHERE demo_completed = true;
```

**Время от демо до регистрации:**
```sql
SELECT 
  AVG(EXTRACT(EPOCH FROM (converted_at - created_at))) / 60 as avg_minutes
FROM anonymous_sessions
WHERE converted_at IS NOT NULL;
```

**Воронка по шагам:**
```sql
SELECT 
  COUNT(*) as total_sessions,
  COUNT(*) FILTER (WHERE funnel_completed) as completed_funnel,
  COUNT(*) FILTER (WHERE demo_completed) as completed_demo,
  COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as registered,
  ROUND(100.0 * COUNT(*) FILTER (WHERE funnel_completed) / COUNT(*), 2) as funnel_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE demo_completed) / COUNT(*) FILTER (WHERE funnel_completed), 2) as demo_rate,
  ROUND(100.0 * COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) / COUNT(*) FILTER (WHERE demo_completed), 2) as registration_rate
FROM anonymous_sessions;
```

---

## 🧪 Тестирование

### 1. Email отправка:
1. Пройти демо-урок
2. Ввести email
3. Проверить: "✉️ Отчет отправлен!"
4. Проверить: Magic Link пришел на email

### 2. Magic Link переход:
1. Открыть письмо
2. Нажать на ссылку
3. Проверить: URL = `/welcome?view=demo-feedback`
4. Проверить: Loader "Загружаем ваш фидбэк..."
5. Проверить: Показался фидбэк с оценками

### 3. База данных:
```sql
-- Проверить что session связан с user
SELECT * FROM anonymous_sessions WHERE id = '<demo_session_id>';
-- converted_to_user_id должен быть заполнен

-- Проверить что user создан
SELECT * FROM users WHERE id = '<converted_to_user_id>';
```

### 4. localStorage:
```javascript
// После успешной загрузки должен быть удален
localStorage.getItem('demo_session_id'); // null
```

---

## 🚨 Troubleshooting

### Magic Link не приходит:
1. Проверить Supabase Dashboard → Authentication → Email Templates
2. Проверить что email provider настроен
3. Проверить spam/junk folder

### Фидбэк не загружается:
```javascript
// Консоль браузера должна показывать:
🔗 Magic link return detected, loading demo feedback...
✅ Demo session loaded: {...}
✅ Session marked as converted: {...}
```

### RLS блокирует:
```sql
-- Проверить политики
SELECT * FROM pg_policies WHERE tablename = 'anonymous_sessions';

-- Должно быть 3 политики с TO anon, TO authenticated, TO service_role
```

### demo_session_id не найден:
- Пользователь очистил localStorage между демо и переходом по ссылке
- Решение: предложить пройти демо заново

---

## 🔄 Возможные улучшения

1. **Сохранение на сервере:**
   - Вместо localStorage использовать cookie
   - Отправлять demo_session_id в URL параметре

2. **Fallback если session_id потерян:**
   - Искать последний demo_completed = true по времени
   - Показывать список если несколько

3. **Email кастомизация:**
   - Персонализированный текст письма
   - Превью результатов в письме

4. **Ретаргетинг:**
   - Если пользователь не перешел по ссылке → reminder через 24ч
   - Хранить email в anonymous_sessions


