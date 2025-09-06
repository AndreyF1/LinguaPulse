# LinguaPulse - Документация проекта

## 📋 Обзор проекта

LinguaPulse - это Telegram-бот для изучения английского языка с гибридной архитектурой, использующей Cloudflare Workers, AWS Lambda и Supabase.

## 🏗️ Архитектура

### Компоненты системы

1. **Cloudflare Worker** (`telegram-webhook.js`)
   - Принимает webhook'и от Telegram
   - Маршрутизирует запросы к Lambda
   - Обрабатывает опросник пользователей
   - Управляет состоянием через KV storage

2. **AWS Lambda** (`linguapulse-onboarding`)
   - Обрабатывает логику онбординга
   - Взаимодействует с Supabase
   - Управляет опросником пользователей
   - Трансформирует данные для БД

3. **Supabase (PostgreSQL)**
   - Хранит данные пользователей
   - Управляет продуктами и подписками
   - Обеспечивает безопасность через RLS

## 📊 Схема базы данных

### Таблица `users`
```sql
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

### Таблица `products`
```sql
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  price INTEGER NOT NULL,
  lessons_granted INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  duration_days INTEGER DEFAULT 30
);
```

## 🔄 Бизнес-процессы

### 1. Онбординг пользователя

**Триггер:** Пользователь отправляет `/start` в Telegram

**Процесс:**
1. Webhook проверяет существование пользователя через Lambda
2. Если пользователь новый:
   - Показывается выбор языка интерфейса
   - Создается запись в `users` с `interface_language`
3. Запускается опросник (6 вопросов)
4. При завершении опросника:
   - Обновляется `current_level` (трансформируется в enum)
   - Заполняются `quiz_started_at` и `quiz_completed_at`
   - Рассчитывается `package_expires_at` из продукта
   - Начисляется продукт с ID `7d9d5dbb-7ed2-4bdc-9d2f-c88929085ab5`

### 2. Опросник пользователя

**Вопросы (в порядке):**
1. `language_level` - уровень языка (сохраняется в БД)
2. `study_goal` - цель изучения (маркетинг)
3. `gender` - пол (маркетинг)
4. `age` - возраст (маркетинг)
5. `telegram_preference` - предпочтение Telegram (маркетинг)
6. `voice_usage` - использование голосовых сообщений (маркетинг)

**Локализация:**
- Русский интерфейс: `["Начинающий", "Средний", "Продвинутый"]`
- Английский интерфейс: `["Beginner", "Intermediate", "Advanced"]`

## 🔧 Технические решения

### 1. Извлечение username из Telegram

```javascript
const username = telegramUser.username 
  ? `@${telegramUser.username}` 
  : telegramUser.first_name 
    ? `${telegramUser.first_name}${telegramUser.last_name ? ' ' + telegramUser.last_name : ''}`
    : `user_${chatId}`;
```

**Приоритет:**
1. `@username` (если есть)
2. `Имя Фамилия` (если нет username)
3. `user_123456789` (fallback)

### 2. Трансформация уровня языка

```python
def transform_language_level(russian_level):
    level_mapping = {
        'Начинающий': 'Beginner',
        'Средний': 'Intermediate', 
        'Продвинутый': 'Advanced',
        'Beginner': 'Beginner',
        'Intermediate': 'Intermediate',
        'Advanced': 'Advanced'
    }
    return level_mapping.get(russian_level, 'Beginner')
```

### 3. Расчет срока действия пакета

```python
def get_product_info(product_id, supabase_url, supabase_key):
    # Получает продукт из БД
    # Рассчитывает expires_at = now() + duration_days
    return {
        'expires_at': (datetime.now() + timedelta(days=duration_days)).isoformat()
    }
```

## 🚀 CI/CD

### GitHub Actions

**AWS Lambda деплой** (`.github/workflows/deploy-aws.yml`):
- Триггер: изменения в `AWS Backend/`
- Деплоит `lambda_function.py` в `linguapulse-onboarding`

**Cloudflare Worker деплой** (`.github/workflows/deploy-cloudflare.yml`):
- Триггер: изменения в `Cloudflare Worker/`
- Деплоит worker через Wrangler

## 🔐 Переменные окружения

### Lambda (AWS)
- `SUPABASE_URL` - URL Supabase проекта
- `SUPABASE_SERVICE_KEY` - Service Role Key для доступа к БД
- `TELEGRAM_BOT_TOKEN` - Токен Telegram бота

### Cloudflare Worker
- `ONBOARDING_URL` - URL Lambda функции
- `AWS_LAMBDA_TOKEN` - Токен для вызова Lambda
- `CF_API_TOKEN` - Токен Cloudflare API
- `CF_ACCOUNT_ID` - ID аккаунта Cloudflare

## 📁 Структура проекта

```
LinguaPulse/
├── AWS Backend/
│   └── lambda_function.py          # Lambda функция онбординга
├── Cloudflare Worker/
│   ├── telegram-webhook.js         # Основной webhook
│   ├── newbies-funnel.js          # Опросник (legacy, не используется)
│   ├── main-lesson.js             # Уроки (legacy)
│   ├── lesson0-bot.js             # Бот уроков (legacy)
│   ├── linguapulse-test-bot.js    # Тестовый бот (legacy)
│   ├── reminder.js                # Напоминания (legacy)
│   └── wrangler.toml              # Конфигурация Cloudflare
├── .github/workflows/
│   ├── deploy-aws.yml             # Деплой Lambda
│   ├── deploy-cloudflare.yml      # Деплой Worker
│   └── test.yml                   # Тестовый workflow
└── PROJECT_DOCUMENTATION.md       # Эта документация
```

## 🧪 Тестирование

### Локальное тестирование Lambda
```bash
python3 -c "
import boto3
import json

lambda_client = boto3.client('lambda', region_name='us-east-1')
response = lambda_client.invoke(
    FunctionName='linguapulse-onboarding',
    InvocationType='RequestResponse',
    Payload=json.dumps({
        'action': 'get_survey_question',
        'question_type': 'language_level',
        'language': 'ru'
    })
)
print(json.loads(response['Payload'].read().decode('utf-8')))
"
```

### Тестирование через Telegram
1. Отправить `/start` в бота
2. Выбрать язык интерфейса
3. Пройти все 6 вопросов опросника
4. Проверить данные в Supabase

## 🔍 Отладка

### Логи Lambda
- CloudWatch Logs: `/aws/lambda/linguapulse-onboarding`
- Содержат: входящие запросы, ответы Supabase, ошибки

### Логи Cloudflare Worker
- Cloudflare Dashboard → Workers → telegram-webhook
- Содержат: webhook запросы, вызовы Lambda, состояние опросника

### Проверка данных Supabase
```bash
curl -X GET "https://qpqwyvzpwwwyolnvtglw.supabase.co/rest/v1/users" \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "apikey: YOUR_SERVICE_KEY"
```

## 🚨 Известные проблемы и решения

### 1. RLS (Row Level Security) в Supabase
**Проблема:** Lambda не может создавать записи из-за RLS
**Решение:** Использовать Service Role Key вместо анонимного доступа

### 2. Трансформация уровня языка
**Проблема:** Пользователи видят русские опции, но БД ожидает английские
**Решение:** Функция `transform_language_level()` преобразует значения

### 3. Username извлечение
**Проблема:** В тестах username был дефолтным
**Решение:** Улучшена логика извлечения из Telegram данных

## 📈 Метрики и мониторинг

### Ключевые метрики
- Количество новых пользователей (записи в `users`)
- Прохождение опросника (`quiz_completed_at` заполнено)
- Активность пользователей (`is_active = true`)
- Использование уроков (`lessons_left`)

### Алерты
- Ошибки Lambda (CloudWatch)
- Ошибки Worker (Cloudflare Dashboard)
- Проблемы с Supabase (логи приложения)

## 🔄 Обновления и поддержка

### Добавление новых вопросов опросника
1. Обновить `SURVEY_QUESTIONS` в `lambda_function.py`
2. Добавить в `QUESTION_ORDER`
3. Обновить логику в webhook

### Изменение схемы БД
1. Обновить таблицы в Supabase
2. Обновить код Lambda для работы с новыми полями
3. Протестировать на тестовых данных

### Добавление новых языков
1. Добавить переводы в `SURVEY_QUESTIONS`
2. Обновить логику трансформации
3. Протестировать локализацию

---

**Последнее обновление:** 6 сентября 2025
**Версия:** 1.0.0
**Статус:** Production Ready
