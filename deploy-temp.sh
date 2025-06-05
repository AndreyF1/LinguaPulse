#!/bin/bash

# Создаем временный файл конфигурации
cat > temp-wrangler.toml << EOF
name = "linguapulse-lesson0-bot"
main = "lesson0-bot.js"
compatibility_date = "2025-05-17"

[[kv_namespaces]]
binding = "CHAT_KV"
id = "ff3bf4d1633d45cd92e95d193b7d250f"

[[d1_databases]]
binding = "USER_DB"
database_id = "47f30572-4b57-4978-890d-4fa880cf1427"
EOF

# Выполняем деплой без переноса переменных
npx wrangler deploy --config temp-wrangler.toml

echo "Деплой завершен. Пожалуйста, настройте секреты через Cloudflare Dashboard:"
echo "- BOT_TOKEN"
echo "- OPENAI_KEY"
echo "- TRANSLOADIT_KEY"
echo "- TRANSLOADIT_TPL (значение: 5d38b8e98706437cbeacb94e1e97fcb0)"
echo "- SYSTEM_PROMPT" 