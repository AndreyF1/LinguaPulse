# 🔧 Troubleshooting Supabase Errors

## Проблема: Кнопка "Завершить" в воронке не работает

### Симптомы:
- Кнопка "Завершить" ничего не делает
- В консоли браузера (F12) видна ошибка вида:
  ```
  ❌ Failed to save funnel answers: { code: '42501', message: 'new row violates row-level security policy' }
  ```

### Причина:
RLS (Row Level Security) политики для таблицы `anonymous_sessions` блокируют UPDATE операции от анонимных пользователей.

### Решение:

#### Шаг 1: Проверить текущие политики

1. Откройте **Supabase Dashboard**
2. Перейдите в **SQL Editor**
3. Выполните:
   ```sql
   SELECT policyname, cmd, roles::text
   FROM pg_policies 
   WHERE tablename = 'anonymous_sessions';
   ```

**Ожидаемый результат:**
```
policyname              | cmd | roles
------------------------|-----|---------------
allow_all_anonymous     | ALL | {anon}
allow_all_authenticated | ALL | {authenticated}
allow_all_service       | ALL | {service_role}
```

#### Шаг 2: Исправить политики (если они неправильные)

Скопируйте и выполните файл `CHECK_AND_FIX_RLS.sql` в SQL Editor.

Или выполните вручную:

```sql
-- Удалить старые политики
DROP POLICY IF EXISTS "Service role can manage anonymous sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_anonymous" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_authenticated" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_service" ON anonymous_sessions;

-- Создать правильные политики
CREATE POLICY "allow_all_anonymous"
  ON anonymous_sessions FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_authenticated"
  ON anonymous_sessions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "allow_all_service"
  ON anonymous_sessions FOR ALL TO service_role
  USING (true) WITH CHECK (true);
```

#### Шаг 3: Проверить работу

1. Обновите страницу с воронкой (F5)
2. Очистите localStorage (в консоли браузера):
   ```javascript
   localStorage.clear()
   location.reload()
   ```
3. Пройдите воронку заново
4. Нажмите "Завершить"

✅ Должно работать!

---

## Проблема: "Failed to create anonymous session"

### Симптомы:
- В консоли браузера:
  ```
  ❌ Failed to create anonymous session: { code: '42501', ... }
  ```
- `sessionId` начинается с `local_...`

### Причина:
RLS политики блокируют INSERT операции.

### Решение:
Такое же, как выше — исправить RLS политики через `CHECK_AND_FIX_RLS.sql`.

---

## Проблема: "Failed to load demo session" после Magic Link

### Симптомы:
- После перехода по Magic Link появляется бесконечный loader
- В консоли:
  ```
  ❌ Failed to load demo session: ...
  ```

### Возможные причины:
1. `demo_session_id` не существует в localStorage
2. Сессия не найдена в Supabase
3. RLS политики блокируют SELECT

### Решение:

1. **Проверить localStorage:**
   ```javascript
   console.log('demo_session_id:', localStorage.getItem('demo_session_id'))
   console.log('anon_session_id:', localStorage.getItem('anon_session_id'))
   ```

2. **Проверить Supabase:**
   - Откройте Supabase Dashboard → Table Editor
   - Откройте таблицу `anonymous_sessions`
   - Найдите строку с нужным `id`
   - Проверьте, что `demo_completed = true` и есть данные в `demo_transcript`, `demo_feedback`, `demo_scores`

3. **Если данных нет:**
   - Пройдите демо-урок заново
   - Убедитесь что в конце урока в консоли есть:
     ```
     💾 Saving demo session...
     ✅ Demo session saved
     ```

---

## Общие советы по отладке

### 1. Консоль браузера (F12)
Всегда открывайте консоль перед тестированием. Все ошибки и логи видны там.

### 2. Network tab
Откройте вкладку Network и фильтруйте по `supabase` чтобы увидеть все запросы к БД.

### 3. Очистка состояния
Если что-то сломалось:
```javascript
// В консоли браузера:
localStorage.clear()
sessionStorage.clear()
location.reload()
```

### 4. Проверка RLS
Самая частая проблема — неправильные RLS политики. Всегда начинайте с проверки политик.

---

## Быстрые SQL запросы

### Посмотреть все сессии:
```sql
SELECT id, created_at, funnel_completed, demo_completed, converted_to_user_id
FROM anonymous_sessions
ORDER BY created_at DESC
LIMIT 10;
```

### Посмотреть последнюю сессию с демо:
```sql
SELECT id, created_at, demo_completed, demo_feedback, demo_scores
FROM anonymous_sessions
WHERE demo_completed = true
ORDER BY created_at DESC
LIMIT 1;
```

### Найти конвертированные сессии:
```sql
SELECT 
  a.id as session_id,
  a.created_at,
  a.converted_at,
  u.email
FROM anonymous_sessions a
LEFT JOIN auth.users u ON u.id = a.converted_to_user_id
WHERE a.converted_to_user_id IS NOT NULL
ORDER BY a.converted_at DESC;
```

### Удалить тестовые сессии:
```sql
-- ОСТОРОЖНО! Удаляет все сессии без email
DELETE FROM anonymous_sessions
WHERE converted_to_user_id IS NULL
AND created_at < NOW() - INTERVAL '1 day';
```

