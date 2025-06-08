# LinguaPulse Development Environment

Эта ветка (`dev`) содержит конфигурацию для разработки с отдельными dev-воркерами.

## Настройка Dev-среды

### 1. Создание ресурсов в Cloudflare

#### Dev Telegram Bot
1. Перейдите к @BotFather в Telegram
2. Создайте нового бота: `/newbot`
3. Назовите его `LinguaPulse Dev Bot` или похоже
4. Сохраните полученный токен как `DEV_BOT_TOKEN`

#### Dev D1 Database
Dev среда использует продакшн базу данных для тестовых вопросов.
Отдельная dev база не нужна - все тесты используют одинаковые вопросы.

#### Dev KV Namespace  
```bash
npx wrangler kv:namespace create "DEV_CHAT_KV"
```
Скопируйте `id` из вывода.

### 2. Обновление wrangler.toml

Dev среда уже настроена:
- Использует отдельный KV namespace для изоляции сессий
- Использует продакшн базу данных для тестовых вопросов
- Это обеспечивает одинаковость тестов между dev и prod

### 3. Настройка секретов для dev среды

#### Через GitHub Secrets (для CI/CD):
В настройках репозитория GitHub добавьте секрет:
- `DEV_BOT_TOKEN` - токен dev telegram бота

#### Через wrangler (для локальной разработки):
```bash
# Для каждого dev воркера установите BOT_TOKEN
echo "ваш_dev_bot_token" | npx wrangler secret put BOT_TOKEN --env dev-webhook
echo "ваш_dev_bot_token" | npx wrangler secret put BOT_TOKEN --env dev-lesson0  
echo "ваш_dev_bot_token" | npx wrangler secret put BOT_TOKEN --env dev-main-lesson

# OpenAI и Transloadit можно использовать те же что и для продакшн
echo "ваш_openai_key" | npx wrangler secret put OPENAI_KEY --env dev-lesson0
echo "ваш_transloadit_key" | npx wrangler secret put TRANSLOADIT_KEY --env dev-lesson0
echo "ваш_transloadit_template" | npx wrangler secret put TRANSLOADIT_TPL --env dev-lesson0
```

### 4. Настройка webhook для dev бота

После деплоя dev-telegram-webhook получите его URL и настройте webhook:
```bash
curl -X POST "https://api.telegram.org/bot<DEV_BOT_TOKEN>/setWebhook" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://dev-telegram-webhook.<your-subdomain>.workers.dev/tg"}'
```

## Деплой dev среды

### Автоматический (через GitHub Actions):
```bash
git add .
git commit -m "Setup dev environment"
git push origin dev
```

### Ручной деплой:
```bash
# Деплой всех dev воркеров
npm run dev:all

# Или по отдельности
npm run dev:webhook
npm run dev:test-bot
npm run dev:lesson0
npm run dev:main-lesson
npm run dev:reminder
```

## Тестирование

1. Найдите вашего dev бота в Telegram
2. Отправьте `/start` для начала тестирования
3. Все изменения будут влиять только на dev среду

## Безопасность

- Dev среда использует отдельную базу данных
- Отдельный KV namespace
- Отдельный Telegram бот
- Продакшн среда остается нетронутой

## Переход в продакшн

После тестирования в dev среде:
1. Создайте PR из `dev` в `main`
2. После мержа изменения автоматически деплоятся в продакшн

## Troubleshooting

### Если dev база данных пустая:
```bash
# Скопируйте схему из продакшн базы или создайте таблицы заново
npx wrangler d1 execute linguapulse-dev-db --file=schema.sql
```

### Если не работают service bindings:
Убедитесь что все dev воркеры деплоятся в правильном порядке:
1. test-bot, lesson0, main-lesson, reminder
2. webhook (последним, так как он зависит от других) 