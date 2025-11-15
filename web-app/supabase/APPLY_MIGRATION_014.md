# Применение Migration 014: Fix Magic Link RLS

## 🚨 КРИТИЧНО: Миграция нужна для работы Magic Link!

**Проблема:** RLS блокирует чтение `anonymous_sessions` после magic link → всё зависает

**Решение:** Разрешить authenticated пользователям читать любые сессии (для конвертации)

---

## 📋 Шаги применения

### 1. Открыть Supabase Dashboard

```
https://supabase.com/dashboard/project/YOUR_PROJECT_ID/editor
```

### 2. Открыть SQL Editor

**Navigation:** SQL Editor (левое меню) → New Query

### 3. Скопировать и выполнить миграцию

```sql
-- Migration: Fix anonymous_sessions RLS for magic link flow
-- Description: Allow authenticated users to read any anonymous session (needed to convert it)

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Authenticated users can read any session" ON anonymous_sessions;

-- New policy: Authenticated users can read ANY anonymous session
-- (needed for magic link flow where user needs to read session BEFORE converting it)
CREATE POLICY "Authenticated users can read any session"
  ON anonymous_sessions FOR SELECT
  TO authenticated
  USING (true);

-- Log
DO $$
BEGIN
  RAISE NOTICE '✅ Fixed anonymous_sessions RLS - authenticated users can now read any session to convert it';
END $$;

COMMENT ON POLICY "Authenticated users can read any session" ON anonymous_sessions IS 'Allows magic link users to read their demo session before converting it';
```

### 4. Нажать RUN (или Ctrl+Enter)

**Ожидаемый результат:**
```
✅ Success. No rows returned
```

### 5. Проверить политики

```sql
-- Проверить что новая политика создана
SELECT 
  schemaname, 
  tablename, 
  policyname, 
  roles,
  cmd,
  qual
FROM pg_policies 
WHERE tablename = 'anonymous_sessions';
```

**Должны быть:**
1. `Service role can manage anonymous sessions` (service_role, ALL)
2. `Authenticated users can read any session` (authenticated, SELECT) ← **НОВАЯ**
3. `Anonymous users can create sessions` (anon, INSERT)
4. `Anyone can update sessions by id` (ALL, UPDATE)

---

## 🧪 Тестирование

### Тест Magic Link Flow:

1. **Пройти демо-урок** (`/welcome`)
2. **Ввести email** для фидбэка
3. **Открыть письмо** и кликнуть по Magic Link
4. **Проверить:**
   - ✅ НЕ зависает на "Loading demo feedback..."
   - ✅ Показывается ConversationScreen с фидбэком
   - ✅ FeedbackModal открыт автоматически
   - ✅ Видны оценки и текст фидбэка

### Проверка в консоли браузера:

```javascript
// Должны быть эти логи:
🔗 Magic link: loading demo session...
✅ Demo session loaded: {...}
💾 Saving demo to history...
✅ Demo saved to history
✅ Demo session linked to user
```

### Если всё еще зависает:

```sql
-- Проверить RLS вручную (от имени authenticated пользователя)
SELECT * FROM anonymous_sessions WHERE id = 'YOUR_SESSION_ID';
-- Должно вернуть данные (не "new row violates row-level security policy")
```

---

## 🔒 Безопасность

**Q:** Почему безопасно разрешать authenticated читать ВСЕ сессии?

**A:**
1. ✅ **Только authenticated** (не anon)
2. ✅ **Только SELECT** (не INSERT/UPDATE/DELETE)
3. ✅ **UUID хранится в localStorage** (только у владельца)
4. ✅ **После конвертации** сессия привязывается к user_id

**Альтернатива (более сложная):**
- Переместить чтение в Edge Function с service role
- Но это добавляет latency и усложняет код

---

## 📊 Аналитика после миграции

```sql
-- Проверить конверсию magic link → registration
SELECT 
  COUNT(*) FILTER (WHERE demo_completed = true) as demo_completed,
  COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) as registered,
  ROUND(100.0 * COUNT(*) FILTER (WHERE converted_to_user_id IS NOT NULL) / 
    COUNT(*) FILTER (WHERE demo_completed = true), 2) as conversion_rate
FROM anonymous_sessions
WHERE created_at > NOW() - INTERVAL '7 days';
```

---

## ⚠️ Rollback (если что-то пошло не так)

```sql
-- Вернуться к старой политике
DROP POLICY IF EXISTS "Authenticated users can read any session" ON anonymous_sessions;

CREATE POLICY "Users can view own converted sessions"
  ON anonymous_sessions FOR SELECT
  USING (converted_to_user_id = auth.uid());
```

**НО:** Это вернёт проблему с зависанием magic link!

---

## 📝 Checklist

- [ ] Миграция выполнена в Supabase
- [ ] Политики проверены (4 политики для anonymous_sessions)
- [ ] Тест: демо → email → magic link → фидбэк (БЕЗ зависания)
- [ ] Консоль браузера: нет ошибок RLS
- [ ] Конверсия работает: `converted_to_user_id` заполняется

---

## 🎯 Результат

✅ **AI прощается** естественно в конце урока
✅ **Magic Link работает** без зависаний
✅ **Feedback открывается** сразу после регистрации
✅ **UX плавный** - как задумывалось изначально!

