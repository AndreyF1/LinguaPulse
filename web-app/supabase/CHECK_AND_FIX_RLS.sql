-- 🔍 ДИАГНОСТИКА И ИСПРАВЛЕНИЕ RLS для anonymous_sessions
-- Скопируйте в Supabase SQL Editor и выполните

-- ===== ШАГ 1: ПРОВЕРКА ТЕКУЩИХ ПОЛИТИК =====
SELECT 
    policyname, 
    cmd, 
    roles::text,
    qual::text as using_clause,
    with_check::text as with_check_clause
FROM pg_policies 
WHERE tablename = 'anonymous_sessions'
ORDER BY policyname;

-- Ожидаемый результат:
-- allow_all_anonymous      | ALL | {anon}          | true | true
-- allow_all_authenticated  | ALL | {authenticated} | true | true
-- allow_all_service        | ALL | {service_role}  | true | true

-- Если политик нет или они другие, выполните ШАГ 2

-- ===== ШАГ 2: ПОЛНОЕ ИСПРАВЛЕНИЕ RLS =====

-- 2.1: Удалить все старые политики
DROP POLICY IF EXISTS "Service role can manage anonymous sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Users can view own converted sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anonymous users can create sessions" ON anonymous_sessions;
DROP POLICY IF EXISTS "Anyone can update sessions by id" ON anonymous_sessions;
DROP POLICY IF EXISTS "Allow anon to insert" ON anonymous_sessions;
DROP POLICY IF EXISTS "Allow anon to update" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_anonymous" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_authenticated" ON anonymous_sessions;
DROP POLICY IF EXISTS "allow_all_service" ON anonymous_sessions;

-- 2.2: Убедиться что RLS включен
ALTER TABLE anonymous_sessions ENABLE ROW LEVEL SECURITY;

-- 2.3: Создать правильные политики
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

-- ===== ШАГ 3: ПРОВЕРКА ПОСЛЕ ИСПРАВЛЕНИЯ =====
SELECT 
    '✅ RLS политики установлены:' as status,
    policyname, 
    cmd, 
    roles::text
FROM pg_policies 
WHERE tablename = 'anonymous_sessions'
ORDER BY policyname;

-- ===== ШАГ 4: ТЕСТИРОВАНИЕ (опционально) =====
-- Раскомментируйте следующие строки чтобы протестировать:

-- Тест INSERT (от имени anon):
-- SET ROLE anon;
-- INSERT INTO anonymous_sessions (funnel_answers, funnel_completed, demo_completed) 
-- VALUES ('[]'::jsonb, false, false) RETURNING id;

-- Тест UPDATE (от имени anon):
-- UPDATE anonymous_sessions 
-- SET funnel_answers = '[{"question": 1, "answer": "test"}]'::jsonb 
-- WHERE id = (SELECT id FROM anonymous_sessions LIMIT 1)
-- RETURNING id;

-- Сбросить роль обратно:
-- RESET ROLE;

