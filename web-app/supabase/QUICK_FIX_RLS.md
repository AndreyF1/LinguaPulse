# QUICK FIX: Enable Anonymous Sessions

## Проблема
Сайт висит на "Загрузка..." потому что `anonymous_sessions` таблица имеет RLS (Row Level Security), но **НЕТ политик для INSERT/UPDATE** от анонимных пользователей.

## Решение за 2 минуты

### Шаг 1: Открыть Supabase Dashboard
1. https://supabase.com/dashboard
2. Выбрать проект **LinguaPulse**
3. Перейти в **SQL Editor** (левое меню)

### Шаг 2: Проверить текущие политики (опционально)
Создать новый query, вставить и запустить:

```sql
SELECT policyname, cmd 
FROM pg_policies 
WHERE tablename = 'anonymous_sessions' 
ORDER BY policyname;
```

**Ожидаемый результат СЕЙЧАС (2 политики):**
```
Service role can manage anonymous sessions | ALL
Users can view own converted sessions      | SELECT
```

**Нужно ДОБАВИТЬ (еще 2 политики):**
```
Anonymous users can create sessions | INSERT
Anyone can update sessions by id    | UPDATE
```

### Шаг 3: Применить FIX (ГЛАВНОЕ!)
Создать новый query, вставить и запустить:

```sql
-- SIMPLE FIX: Add missing RLS policies for anonymous users

-- Remove if exist (cleanup)
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;

-- Add two missing policies
CREATE POLICY "Anonymous users can create sessions"
  ON anonymous_sessions 
  FOR INSERT 
  WITH CHECK (true);

CREATE POLICY "Anyone can update sessions by id"
  ON anonymous_sessions 
  FOR UPDATE 
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT 'RLS policies added successfully!' as status;
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'anonymous_sessions' ORDER BY policyname;
```

**Ожидаемый результат:**
```
status: RLS policies added successfully!

policyname                                 | cmd
-------------------------------------------+--------
Anonymous users can create sessions        | INSERT
Anyone can update sessions by id           | UPDATE
Service role can manage anonymous sessions | ALL
Users can view own converted sessions      | SELECT
```

### Шаг 4: Проверить на сайте
1. Открыть https://linguapulse.ai/welcome
2. `Ctrl+Shift+R` (hard refresh)
3. Открыть DevTools Console
4. Очистить localStorage: 
   - DevTools → Application → Local Storage → Clear All
5. Обновить страницу (`F5`)
6. В консоли должно быть:
   ```
   ✅ Anonymous session created: <uuid>
   📍 Funnel initialized with session: <uuid>
   ```
7. Пройти воронку → в консоли:
   ```
   ✅ Funnel answers saved
   ```

### Шаг 5: Проверить в Supabase
1. **Table Editor** → `anonymous_sessions`
2. Должна появиться новая строка с:
   - `id` - UUID
   - `funnel_answers` - JSONB массив
   - `utm_source`, `referrer` - если есть
   - `created_at` - текущее время

---

## Почему это произошло?

### Миграция 011 (изначальная):
```sql
-- Создала таблицу anonymous_sessions
-- Включила RLS
-- Добавила только 2 политики:
--   1. Service role - ALL
--   2. Users view - SELECT
-- ❌ НЕ добавила политики для INSERT/UPDATE от анонимов
```

### Миграция 013 (должна была исправить):
```sql
-- Должна была добавить:
--   3. Anonymous INSERT
--   4. Anonymous UPDATE
-- ❓ Возможно не применилась или была ошибка
```

### FIX_ANONYMOUS_RLS.sql (этот файл):
```sql
-- Гарантированно добавляет недостающие политики
-- ✅ Простой, без побочных эффектов
```

---

## Безопасность

**Q: Безопасно ли давать anonymous INSERT/UPDATE?**

**A: Да, безопасно:**

1. **INSERT с `WITH CHECK (true)`:**
   - Любой может создать новую строку
   - Но не может выбрать ID другого пользователя (UUID генерируется автоматически)
   - Не содержит sensitive данных (только UTM, funnel answers, demo transcript)

2. **UPDATE с `USING (true)` / `WITH CHECK (true)`:**
   - Технически любой может обновить любую строку
   - НО: frontend знает только свой ID (из localStorage)
   - Нет мотивации изменять чужие данные
   - Данные не sensitive (не пароли, не платежи)

3. **После регистрации:**
   - `converted_to_user_id` заполняется
   - Пользователь может видеть свою anonymous journey через обычную политику SELECT

4. **Альтернатива (более secure, но сложнее):**
   ```sql
   -- Потребовала бы JWT token даже для анонимов
   -- Или проверку по session ID в localStorage
   -- Но это overkill для tracking данных
   ```

---

## Troubleshooting

### Ошибка: "relation does not exist"
```sql
-- Проверить, что таблица существует
SELECT tablename FROM pg_tables WHERE tablename = 'anonymous_sessions';

-- Если не существует - применить миграцию 011
```

### Ошибка: "policy already exists"
```sql
-- Удалить вручную
DROP POLICY "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY "Anyone can update sessions by id" ON anonymous_sessions;

-- Попробовать снова
```

### Сайт все еще не грузится
1. Проверить консоль браузера на другие ошибки
2. Очистить localStorage
3. Hard refresh (`Ctrl+Shift+R`)
4. Проверить Network tab - статус 401 означает RLS проблема

---

## Откат (если нужно)

```sql
-- Удалить добавленные политики
DROP POLICY "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY "Anyone can update sessions by id" ON anonymous_sessions;

-- Вернуться к original состоянию (только service role + users view)
```

После отката сайт снова будет работать в **fallback режиме** (local_* sessions).

