# LinguaPulse - Быстрая справка

## 🚀 Быстрый старт

### 1. Проверка статуса системы
```bash
# Lambda функция
aws lambda get-function --function-name linguapulse-onboarding

# Cloudflare Worker
curl -X GET "https://telegram-webhook.andreykatkov13.workers.dev/tg" -H "Content-Type: application/json" -d '{"test": "ping"}'

# Supabase
curl -X GET "https://qpqwyvzpwwwyolnvtglw.supabase.co/rest/v1/users" -H "Authorization: Bearer sb_secret_lghNzKHiDruF7qitrw873Q_PH788Qyy" -H "apikey: sb_secret_lghNzKHiDruF7qitrw873Q_PH788Qyy"
```

### 2. Деплой изменений
```bash
# Lambda
cd "AWS Backend" && zip lambda_function.zip lambda_function.py && aws lambda update-function-code --function-name linguapulse-onboarding --zip-file fileb://lambda_function.zip

# Worker (автоматически через Git push)
git add . && git commit -m "Update" && git push origin main
```

## 🔧 Ключевые функции

### Lambda Actions
- `check_user` - проверка существования пользователя
- `start_survey` - создание пользователя и начало опросника
- `get_survey_question` - получение вопроса опросника
- `complete_survey` - завершение опросника и начисление продукта
- `deactivate_user` - деактивация пользователя

### Webhook Routes
- `/start` - онбординг пользователя
- `language:ru/en` - выбор языка интерфейса
- `survey:question:answer` - ответы опросника

## 📊 Схема данных

### Пользователь в Supabase
```json
{
  "telegram_id": 59156205,
  "username": "@username",
  "interface_language": "ru",
  "current_level": "Intermediate",
  "lessons_left": 3,
  "package_expires_at": "2025-09-09T13:48:25.093045+00:00",
  "quiz_started_at": "2025-09-06T13:48:25.347656+00:00",
  "quiz_completed_at": "2025-09-06T13:48:25.347656+00:00",
  "is_active": true
}
```

### Опросник (6 вопросов)
1. **language_level** - уровень языка (сохраняется)
2. **study_goal** - цель изучения (маркетинг)
3. **gender** - пол (маркетинг)
4. **age** - возраст (маркетинг)
5. **telegram_preference** - предпочтение Telegram (маркетинг)
6. **voice_usage** - использование голосовых сообщений (маркетинг)

## 🔐 Креды и токены

### Supabase
- **URL:** `https://qpqwyvzpwwwyolnvtglw.supabase.co`
- **Service Key:** `sb_secret_lghNzKHiDruF7qitrw873Q_PH788Qyy`

### AWS Lambda
- **Function:** `linguapulse-onboarding`
- **Region:** `us-east-1`

### Cloudflare Worker
- **URL:** `https://telegram-webhook.andreykatkov13.workers.dev/tg`
- **Account ID:** `8d31393d0f3f72e199fc37102d2c719e`

## 🧪 Тестирование

### Тест Lambda функции
```python
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
```

### Тест полного flow
1. Очистить таблицу `users`
2. Отправить `/start` в Telegram бота
3. Выбрать язык интерфейса
4. Пройти все 6 вопросов
5. Проверить данные в Supabase

## 🚨 Частые проблемы

### 1. Lambda не обновляется
```bash
# Проверить handler
aws lambda get-function-configuration --function-name linguapulse-onboarding

# Обновить handler
aws lambda update-function-configuration --function-name linguapulse-onboarding --handler lambda_function.lambda_handler
```

### 2. RLS ошибки в Supabase
- Использовать Service Role Key, не анонимный ключ
- Проверить права доступа в Supabase Dashboard

### 3. Username не извлекается
- Проверить логи webhook в Cloudflare Dashboard
- Убедиться, что передается `update.callback_query.from`

## 📁 Важные файлы

- `AWS Backend/lambda_function.py` - основная логика
- `Cloudflare Worker/telegram-webhook.js` - webhook и опросник
- `.github/workflows/deploy-aws.yml` - деплой Lambda
- `.github/workflows/deploy-cloudflare.yml` - деплой Worker

## 🔄 Workflow

1. **Пользователь** → `/start` в Telegram
2. **Webhook** → проверяет пользователя через Lambda
3. **Lambda** → проверяет в Supabase
4. **Webhook** → показывает выбор языка
5. **Пользователь** → выбирает язык
6. **Webhook** → создает пользователя через Lambda
7. **Lambda** → сохраняет в Supabase
8. **Webhook** → показывает опросник
9. **Пользователь** → отвечает на вопросы
10. **Webhook** → завершает опросник через Lambda
11. **Lambda** → обновляет данные в Supabase
12. **Webhook** → показывает результат

---

**Для восстановления контекста:** прочитайте `PROJECT_DOCUMENTATION.md`
