# LinguaPulse - Telegram Bot Version (Archived)

⚠️ **Это архивная версия проекта на базе Telegram бота.**

Новая веб-версия находится в папке `/web-app`.

## Структура

- **AWS Backend/** - Lambda функции для обработки AI запросов
- **Cloudflare Worker/** - Webhook обработчик для Telegram Bot API

## Ветка

Исходный код этой версии также доступен в ветке `telegram-version`.

## Архитектура

```
Telegram Bot API
       ↓
Cloudflare Worker (webhook)
       ↓
AWS Lambda Functions
       ↓
Supabase (Database)
       ↓
OpenAI API
```

---

Для работы с веб-версией см. `/web-app/README.md`

