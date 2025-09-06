# Changelog - LinguaPulse

## [1.0.0] - 2025-09-06

### 🎉 Initial Release
- Полная интеграция онбординга пользователей
- Гибридная архитектура: Cloudflare Workers + AWS Lambda + Supabase
- Опросник с 6 вопросами (1 для БД, 5 для маркетинга)
- Поддержка русского и английского интерфейсов
- CI/CD через GitHub Actions

### ✨ Features
- **Онбординг пользователей**
  - Проверка существования пользователя
  - Выбор языка интерфейса
  - Создание записи в Supabase
  - Персонализированные приветствия

- **Опросник пользователей**
  - 6 вопросов с локализацией
  - Сохранение состояния в KV storage
  - Трансформация данных для БД
  - Маркетинговые данные

- **Управление данными**
  - Извлечение username из Telegram
  - Трансформация уровня языка (ru → en)
  - Расчет срока действия пакета
  - Timestamps для опросника

### 🔧 Technical Details

#### Lambda Function (`linguapulse-onboarding`)
- **Actions:**
  - `check_user` - проверка пользователя
  - `start_survey` - создание пользователя
  - `get_survey_question` - получение вопроса
  - `complete_survey` - завершение опросника
  - `deactivate_user` - деактивация

#### Cloudflare Worker (`telegram-webhook.js`)
- **Routes:**
  - `/start` - онбординг
  - `language:ru/en` - выбор языка
  - `survey:question:answer` - опросник

#### Supabase Schema
```sql
-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT UNIQUE NOT NULL,
  username TEXT,
  interface_language TEXT DEFAULT 'ru',
  current_level TEXT CHECK (current_level IN ('Beginner', 'Intermediate', 'Advanced')),
  lessons_left INTEGER DEFAULT 0,
  package_expires_at TIMESTAMP WITH TIME ZONE,
  total_lessons_completed INTEGER DEFAULT 0,
  quiz_started_at TIMESTAMP WITH TIME ZONE,
  quiz_completed_at TIMESTAMP WITH TIME ZONE,
  last_payment_at TIMESTAMP WITH TIME ZONE,
  current_streak INTEGER DEFAULT 0,
  last_lesson_date DATE,
  is_active BOOLEAN DEFAULT true
);
```

### 🐛 Bug Fixes
- **RLS (Row Level Security)** - использование Service Role Key
- **Username extraction** - улучшена логика извлечения из Telegram
- **Language transformation** - исправлена трансформация ru → en
- **Schema compatibility** - исправлены поля для Supabase

### 🔄 CI/CD
- **AWS Lambda Deploy** - автоматический деплой при изменениях в `AWS Backend/`
- **Cloudflare Worker Deploy** - автоматический деплой при изменениях в `Cloudflare Worker/`
- **Test Workflow** - проверка структуры проекта

### 📊 Data Flow
1. User → `/start` → Webhook
2. Webhook → `check_user` → Lambda → Supabase
3. Webhook → выбор языка → `start_survey` → Lambda → Supabase
4. Webhook → опросник → `get_survey_question` → Lambda
5. Webhook → завершение → `complete_survey` → Lambda → Supabase

### 🧪 Testing
- **Unit Tests** - Lambda функции
- **Integration Tests** - полный flow через Telegram
- **Data Validation** - проверка сохранения в Supabase

### 📚 Documentation
- `PROJECT_DOCUMENTATION.md` - полная документация
- `QUICK_REFERENCE.md` - быстрая справка
- `CHANGELOG.md` - история изменений

---

## [0.9.0] - 2025-09-06 (Pre-release)

### 🔄 Major Refactoring
- Очистка проекта от legacy файлов
- Реструктуризация в `AWS Backend/` и `Cloudflare Worker/`
- Удаление зависимости от `newbies-funnel.js`
- Интеграция опросника в Lambda

### 🗑️ Removed
- Legacy Cloudflare Workers (кроме основного webhook)
- Старые тестовые файлы
- Дублирующие конфигурации

### ✨ Added
- Полная интеграция с Supabase
- Система трансформации данных
- Улучшенная обработка ошибок
- Логирование для отладки

---

## [0.8.0] - 2025-09-06 (Development)

### 🔧 Infrastructure
- Настройка AWS Lambda
- Настройка Cloudflare Workers
- Настройка Supabase
- Настройка CI/CD

### 🧪 Testing
- Тестирование Lambda функций
- Тестирование webhook
- Тестирование интеграции

---

## [0.7.0] - 2025-09-06 (Planning)

### 📋 Planning
- Анализ требований
- Проектирование архитектуры
- Выбор технологий
- Планирование этапов

---

**Legend:**
- ✨ New features
- 🔧 Technical changes
- 🐛 Bug fixes
- 🗑️ Removed
- 📚 Documentation
- 🧪 Testing
- 🔄 Refactoring
