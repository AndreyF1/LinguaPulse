# LinguaPulse

Telegram-бот для обучения языкам с использованием AI.

## Настройка CI/CD для деплоя

Для автоматического деплоя через GitHub Actions и правильной установки переменных окружения, необходимо:

1. Привязать репозиторий к GitHub
2. Настроить следующие секреты в репозитории (Settings > Secrets > Actions):

### Обязательные секреты для CI/CD:
- `CF_API_TOKEN`: API токен Cloudflare с правами для Workers
- `CF_ACCOUNT_ID`: ID аккаунта Cloudflare

### Секреты для работы приложения:
- `BOT_TOKEN`: Токен Telegram бота
- `OPENAI_KEY`: API ключ OpenAI
- `TRANSLOADIT_KEY`: API ключ Transloadit
- `TRANSLOADIT_TPL`: ID шаблона Transloadit
- `SYSTEM_PROMPT`: Системный промпт для GPT (опционально)
- `TRIBUTE_APP_LINK`: Ссылка на приложение Tribute
- `TRIBUTE_CHANNEL_LINK`: Резервная ссылка на канал Tribute
- `TRIBUTE_API_KEY`: API ключ Tribute для проверки вебхуков


## Процесс деплоя

После настройки секретов, каждый push в ветку main запустит автоматический деплой на Cloudflare Workers и установит все необходимые переменные окружения.

Деплой также можно запустить вручную через GitHub UI (Actions > Deploy to Cloudflare Workers > Run workflow).

## Локальная разработка

Для локальной разработки можно использовать:

```bash
# Запуск wrangler в dev режиме для конкретного воркера
npx wrangler dev --env webhook
```

Переменные окружения при локальной разработке можно задать в `.dev.vars` файле.
# Debug trigger - Thu  5 Jun 20:17:59 CEST 2025
