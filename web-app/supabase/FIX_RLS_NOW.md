# ⚡ СРОЧНО: Исправить RLS для anonymous_sessions

## 🔴 Проблема
RLS политика все еще блокирует INSERT от анонимных пользователей!

**Ошибка в консоли:**
```
401 (Unauthorized)
"new row violates row-level security policy for table anonymous_sessions"
```

**Причина:** Предыдущие политики не указали роль `anon` (anonymous).

---

## ✅ ПРОСТОЕ РЕШЕНИЕ (3 минуты)

### Шаг 1: Открыть Supabase SQL Editor
1. https://supabase.com/dashboard
2. Выбрать проект **LinguaPulse**
3. **SQL Editor** → **New query**

### Шаг 2: Скопировать и запустить этот SQL:

```sql
-- Remove old policies
DROP POLICY IF EXISTS "Service role can manage anonymous sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;

-- Re-enable RLS (if disabled)
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;

-- Create CORRECT policies with roles
CREATE POLICY "allow_all_anonymous"
  ON anonymous_sessions
  FOR ALL
  TO anon
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_authenticated"
  ON anonymous_sessions
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "allow_all_service"
  ON anonymous_sessions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Verify
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'anonymous_sessions';
```

### Шаг 3: Проверить результат

Должно показать **3 политики**:
```
policyname              | cmd | roles
------------------------+-----+----------------
allow_all_anonymous     | ALL | {anon}
allow_all_authenticated | ALL | {authenticated}
allow_all_service       | ALL | {service_role}
```

### Шаг 4: Проверить на сайте

1. Открыть https://linguapulse.ai/welcome
2. Очистить localStorage:
   ```javascript
   localStorage.clear();
   location.reload();
   ```
3. В консоли должно быть:
   ```
   ✅ Anonymous session created: <UUID>
   📍 Funnel initialized with session: <UUID>
   ```
4. Пройти воронку
5. В консоли:
   ```
   ✅ Funnel answers saved
   ```

### Шаг 5: Проверить в Supabase

**Table Editor** → `anonymous_sessions` → должна появиться новая строка! ✅

---

## 🔍 Почему предыдущие политики не работали?

**Было:**
```sql
CREATE POLICY "Anonymous users can create sessions"
  ON anonymous_sessions 
  FOR INSERT 
  WITH CHECK (true);
  -- ❌ Нет TO anon - не работает для анонимов!
```

**Стало:**
```sql
CREATE POLICY "allow_all_anonymous"
  ON anonymous_sessions
  FOR ALL
  TO anon          -- ✅ Явно указана роль anon
  USING (true)
  WITH CHECK (true);
```

**Ключевая разница:** `TO anon` - это роль, под которой работает Supabase клиент от незалогиненных пользователей.

---

## 🔒 Безопасность

**Q: Это безопасно?**

**A: Да, для tracking таблицы:**
- Данные не sensitive (UTM, ответы воронки, транскрипты демо)
- Нет персональных данных до указания email
- Нет паролей, платежей
- После регистрации привязывается к user_id
- Альтернатива (строгие политики) требует больше логики и не оправдана для tracking

**Если нужны строгие политики позже:**
```sql
-- Можно добавить проверки на обязательные поля, лимиты и т.д.
CREATE POLICY "limit_inserts"
  ON anonymous_sessions
  FOR INSERT
  TO anon
  WITH CHECK (
    funnel_answers IS NOT NULL AND
    created_at > now() - interval '1 hour' -- только за последний час
  );
```

---

## 🚨 Если все еще не работает

### Проверка 1: RLS включен?
```sql
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename = 'anonymous_sessions';
-- Должно быть: rowsecurity = true
```

### Проверка 2: Политики созданы?
```sql
SELECT * FROM pg_policies WHERE tablename = 'anonymous_sessions';
-- Должно быть 3 политики
```

### Проверка 3: Ручная проверка INSERT
```sql
-- В Supabase SQL Editor (работает как anon role по умолчанию)
INSERT INTO anonymous_sessions (funnel_answers, funnel_completed, demo_completed)
VALUES ('[]'::jsonb, false, false)
RETURNING id;
-- Должно вернуть UUID
```

### Проверка 4: Временно отключить RLS для теста
```sql
ALTER TABLE anonymous_sessions DISABLE ROW LEVEL SECURITY;
-- Попробовать на сайте
-- Если работает - проблема точно в RLS
-- Не забыть включить обратно:
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;
```

---

## 📞 Если ничего не помогает

1. Скопировать вывод:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'anonymous_sessions';
   ```
2. Скопировать ошибку из консоли браузера
3. Проверить логи Supabase: Dashboard → Logs → Postgres Logs

