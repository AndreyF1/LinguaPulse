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

# Выполняем полный сброс и деплой без переноса переменных
echo "Выполняем деплой с временным файлом конфигурации..."
npx wrangler deploy --config temp-wrangler.toml

# Устанавливаем секреты вручную
echo "Устанавливаем необходимые секреты..."

# Получаем значения секретов из переменных окружения или запрашиваем их
if [ -z "$BOT_TOKEN" ]; then
  echo "Введите BOT_TOKEN:"
  read -s BOT_TOKEN
fi

if [ -z "$OPENAI_KEY" ]; then
  echo "Введите OPENAI_KEY:"
  read -s OPENAI_KEY
fi

if [ -z "$TRANSLOADIT_KEY" ]; then
  echo "Введите TRANSLOADIT_KEY:"
  read -s TRANSLOADIT_KEY
fi

if [ -z "$TRANSLOADIT_TPL" ]; then
  # Используем значение, которое вы уже показали
  TRANSLOADIT_TPL="5d38b8e98706437cbeacb94e1e97fcb0"
fi

if [ -z "$SYSTEM_PROMPT" ]; then
  echo "Введите SYSTEM_PROMPT (или нажмите Enter для значения по умолчанию):"
  read SYSTEM_PROMPT
  if [ -z "$SYSTEM_PROMPT" ]; then
    SYSTEM_PROMPT="You are a helpful AI language tutor."
  fi
fi

# Устанавливаем секреты
echo "$BOT_TOKEN" | npx wrangler secret put BOT_TOKEN --name linguapulse-lesson0-bot
echo "$OPENAI_KEY" | npx wrangler secret put OPENAI_KEY --name linguapulse-lesson0-bot
echo "$TRANSLOADIT_KEY" | npx wrangler secret put TRANSLOADIT_KEY --name linguapulse-lesson0-bot
echo "$TRANSLOADIT_TPL" | npx wrangler secret put TRANSLOADIT_TPL --name linguapulse-lesson0-bot
echo "$SYSTEM_PROMPT" | npx wrangler secret put SYSTEM_PROMPT --name linguapulse-lesson0-bot

echo "Деплой завершен. Все секреты настроены." 