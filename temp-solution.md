# Решение проблемы с деплоем и секретами

Проблема заключается в том, что в системе уже есть секрет `TRANSLOADIT_TPL`, но он не отображается в списке секретов и блокирует добавление секрета заново.

## Вариант 1: Обходное решение через временный файл

1. Создайте файл `temp-wrangler.toml` с таким содержимым:

```toml
name = "linguapulse-lesson0-bot"
main = "lesson0-bot.js"
compatibility_date = "2025-05-17"

[[kv_namespaces]]
binding = "CHAT_KV"
id = "ff3bf4d1633d45cd92e95d193b7d250f"

[[d1_databases]]
binding = "USER_DB"
database_id = "47f30572-4b57-4978-890d-4fa880cf1427"
```

2. Выполните деплой с этим файлом:

```bash
npx wrangler deploy --config temp-wrangler.toml
```

3. После деплоя вручную настройте все необходимые секреты через Dashboard Cloudflare:
   - BOT_TOKEN
   - OPENAI_KEY
   - TRANSLOADIT_KEY
   - TRANSLOADIT_TPL
   - SYSTEM_PROMPT

## Вариант 2: Сброс воркера через Cloudflare Dashboard

1. Зайдите в Cloudflare Dashboard
2. Перейдите в раздел Workers & Pages
3. Найдите linguapulse-lesson0-bot
4. Удалите его
5. Создайте заново через wrangler
6. Добавьте все секреты

## Вариант 3: Использование Cloudflare API через curl

Если у вас есть API-ключ с правами на управление воркерами, можно выполнить сброс секретов через API:

```bash
# Получите токен API и Account ID из Cloudflare Dashboard
# Задайте переменные
CF_API_TOKEN="ваш_токен_api"
CF_ACCOUNT_ID="ваш_id_аккаунта"
WORKER_NAME="linguapulse-lesson0-bot"

# Удалите секрет
curl -X DELETE "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets/TRANSLOADIT_TPL" \
     -H "Authorization: Bearer $CF_API_TOKEN"

# Добавьте секрет заново
curl -X PUT "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts/$WORKER_NAME/secrets" \
     -H "Authorization: Bearer $CF_API_TOKEN" \
     -H "Content-Type: application/json" \
     --data '{"name": "TRANSLOADIT_TPL", "text": "ваше_значение_секрета"}'
``` 