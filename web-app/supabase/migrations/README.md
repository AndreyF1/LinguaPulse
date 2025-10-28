# Database Migrations

Миграции для веб-версии LinguaPulse.

## 📋 Список миграций

### Новые таблицы:
- **001_create_web_visitors.sql** - Анонимные посетители (UTM tracking)
- **002_create_funnel_answers.sql** - Ответы на воронку (10 вопросов)
- **003_create_events.sql** - Универсальная аналитика событий
- **004_create_demo_sessions.sql** - Демо-диалоги (до регистрации)

### Модификации существующих:
- **005_modify_users_for_web.sql** - Расширение users для веб-авторизации
- **006_modify_payments_and_sessions.sql** - Поддержка анонимных платежей, переименование sessions
- **007_migrate_profiles_to_users.sql** - Объединение profiles в users

### Безопасность:
- **008_setup_rls_policies.sql** - Row Level Security политики

## 🚀 Применение миграций

### Вариант 1: Через SQL Editor в Supabase Dashboard

1. Откройте [Supabase Dashboard](https://supabase.com/dashboard/project/qpqwyvzpwwwyolnvtglw)
2. Перейдите в **SQL Editor**
3. Выполните миграции **по порядку** (001, 002, 003, ...)
4. Копируйте содержимое каждого файла и нажимайте **Run**

⚠️ **Важно:** Выполняйте строго по порядку!

### Вариант 2: Через Supabase CLI (требует Docker)

```bash
cd web-app

# Проверить статус миграций
supabase migration list

# Применить все миграции
supabase db push

# Или применить конкретную миграцию
supabase db push --include-all
```

### Вариант 3: Вручную через psql

```bash
# Если есть прямое подключение к БД
psql "postgresql://postgres:[PASSWORD]@db.qpqwyvzpwwwyolnvtglw.supabase.co:5432/postgres"

# Затем выполнить каждую миграцию:
\i migrations/001_create_web_visitors.sql
\i migrations/002_create_funnel_answers.sql
# ... и так далее
```

## ✅ Проверка миграций

После применения миграций проверьте:

```sql
-- 1. Проверить новые таблицы
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('web_visitors', 'events', 'funnel_answers', 'demo_sessions')
ORDER BY table_name;

-- Должно вернуть: demo_sessions, events, funnel_answers, web_visitors

-- 2. Проверить новые колонки в users
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'users' 
  AND column_name IN ('email', 'auth_provider', 'visitor_id', 'onboarding_completed')
ORDER BY column_name;

-- 3. Проверить что profiles удалена
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name = 'profiles';

-- Должно вернуть пусто (таблица удалена)

-- 4. Проверить переименование sessions → lesson_sessions
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('sessions', 'lesson_sessions');

-- Должно вернуть только: lesson_sessions

-- 5. Проверить RLS политики
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

## 🔄 Откат миграций

Если нужно откатить изменения:

```sql
-- Откат миграции 008 (RLS)
DROP POLICY IF EXISTS "Users can view own profile" ON users;
DROP POLICY IF EXISTS "Users can update own profile" ON users;
-- ... остальные политики

-- Откат миграции 007 (profiles)
-- Восстановить profiles невозможно без бэкапа
-- Рекомендуется сделать бэкап перед миграцией!

-- Откат миграции 006 (payments, sessions)
ALTER TABLE lesson_sessions RENAME TO sessions;
ALTER TABLE payments DROP COLUMN visitor_id;
-- ...

-- Откат миграций 001-004 (новые таблицы)
DROP TABLE IF EXISTS demo_sessions CASCADE;
DROP TABLE IF EXISTS events CASCADE;
DROP TABLE IF EXISTS funnel_answers CASCADE;
DROP TABLE IF EXISTS web_visitors CASCADE;
DROP TYPE IF EXISTS event_type;
DROP TYPE IF EXISTS demo_end_reason;
```

⚠️ **Внимание:** Откат удалит все данные из новых таблиц!

## 📝 Бэкап перед миграцией

**Рекомендуется сделать бэкап перед применением миграций:**

### Через Dashboard:
1. Database → Backups → Create manual backup

### Через CLI (если есть Docker):
```bash
supabase db dump -f backup_$(date +%Y%m%d_%H%M%S).sql
```

### Через pg_dump:
```bash
pg_dump "postgresql://postgres:[PASSWORD]@db.qpqwyvzpwwwyolnvtglw.supabase.co:5432/postgres" > backup.sql
```

## 🎯 После миграции

1. ✅ Обновите TypeScript типы на фронтенде (уже в `shared/types/database.ts`)
2. ✅ Настройте Supabase Auth для Magic Link
3. ✅ Создайте Edge Functions для аналитики
4. ✅ Добавьте event tracking на фронтенде

## 📚 Документация

Полная документация архитектуры: [WEB_ARCHITECTURE_PLAN.md](../../../shared/database/WEB_ARCHITECTURE_PLAN.md)

## ❓ Troubleshooting

### Ошибка: "relation already exists"
- Таблица уже создана. Пропустите эту миграцию или используйте `DROP TABLE IF EXISTS` перед повторным применением.

### Ошибка: "column already exists"
- Колонка уже добавлена. Используйте `ADD COLUMN IF NOT EXISTS` в миграции.

### Ошибка: "foreign key constraint violation"
- Убедитесь что миграции применяются по порядку.
- Проверьте что ссылаемые таблицы созданы.

### Ошибка при удалении profiles: "cannot drop table because other objects depend on it"
- Это нормально если есть foreign keys. Используйте `DROP TABLE profiles CASCADE;`
- Миграция 006 должна обновить foreign keys перед удалением.

