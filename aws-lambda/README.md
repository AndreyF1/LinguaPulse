# LinguaPulse AWS Lambda Functions

Этот каталог содержит AWS Lambda функции для LinguaPulse, которые заменяют Cloudflare Workers.

## Структура

```
aws-lambda/
├── onboarding/           # Заменяет newbies-funnel.js
│   ├── lambda_function.py
│   ├── requirements.txt
│   ├── template.yaml
│   └── deploy.sh
└── shared/              # Общие модули
    ├── database.py      # Supabase клиент
    └── telegram.py      # Telegram API клиент
```

## Требования

1. **AWS CLI** - для деплоя
2. **AWS SAM CLI** - для сборки и деплоя
3. **Python 3.11** - для разработки

## Настройка

### 1. Установка AWS CLI и SAM CLI

```bash
# AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# SAM CLI
pip install aws-sam-cli
```

### 2. Настройка AWS credentials

```bash
aws configure
# Введите:
# - AWS Access Key ID
# - AWS Secret Access Key  
# - Default region: us-east-1
# - Default output format: json
```

### 3. Получение Supabase credentials

1. Перейдите в [Supabase Dashboard](https://supabase.com/dashboard)
2. Выберите ваш проект
3. Перейдите в Settings > API
4. Скопируйте:
   - **Project URL** (например: `https://xxx.supabase.co`)
   - **anon/public key** (длинная строка)

## Деплой

### Onboarding Lambda

```bash
cd aws-lambda/onboarding
./deploy.sh <supabase_url> <supabase_key>
```

Пример:
```bash
./deploy.sh "https://xxx.supabase.co" "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

После деплоя вы получите API endpoint, который нужно добавить в Cloudflare webhook.

## Логика работы

### Onboarding (newbies-funnel)

1. **Язык интерфейса** - пользователь выбирает русский/английский
2. **Опросник** - определение уровня английского
3. **Стартовый пакет** - автоматически начисляется:
   - 3 урока
   - Действителен 3 дня
   - Записывается в Supabase

### Новая пакетная система

- Пользователи получают **пакеты уроков** вместо ежедневных уроков
- Уроки можно проходить **когда угодно** в рамках срока действия пакета
- Если не использовать - уроки **автоматически сгорают**

## Переменные окружения

- `SUPABASE_URL` - URL проекта Supabase
- `SUPABASE_ANON_KEY` - анонимный ключ Supabase  
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота

## Мониторинг

Логи Lambda функций доступны в AWS CloudWatch:
- AWS Console > CloudWatch > Log groups
- Ищите `/aws/lambda/linguapulse-onboarding`
