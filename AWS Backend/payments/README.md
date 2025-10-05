# Payments Lambda - YooMoney Webhook Handler

## Описание
Lambda функция для обработки платежей от YooMoney. Принимает POST запросы с form-data, проверяет подпись, записывает платеж в Supabase и начисляет доступ пользователю.

## Environment Variables
- `SUPABASE_URL` - URL проекта Supabase
- `SUPABASE_SERVICE_ROLE` - service-role ключ Supabase  
- `YOOMONEY_WEBHOOK_SECRET` - секретное слово из настроек YooMoney

## Зависимости
- `requests` - для работы с Supabase API

## Пакеты (UUID → конфигурация)
```python
PKG = {
    "fe88e77a-7931-410d-8a74-5b0473798c6c": {"days": 30, "lessons": 30},  # 30 дней
    "551f676f-22e7-4c8c-ae7a-c5a8de655438": {"days": 14, "lessons": 10},  # 2 недели
    "3ec3f495-7257-466b-a0ba-bfac669a68c8": {"days": 3,  "lessons": 3},   # 3 дня
}
```

## Логика работы
1. **Парсинг** form-urlencoded данных от YooMoney
2. **Верификация** подписи SHA1 (стандарт YooMoney)
3. **Декодирование** `label` (base64 с user_id, product_id, order_id)
4. **Запись** платежа в таблицу `payments` (идемпотентно)
5. **Начисление** доступа (продление подписки + уроки)

## API Gateway
Маршрут: `POST /yoomoney-webhook`

## Требования к таблице payments
Таблица должна содержать поля:
- `id` (TEXT, PRIMARY KEY) - order_id из label
- `user_id` (UUID) - ID пользователя
- `product_id` (UUID) - ID продукта/пакета
- `amount` (INTEGER) - сумма платежа в копейках
- `status` (TEXT) - статус платежа ("paid")
- `provider` (TEXT) - провайдер ("yoomoney")
- `provider_operation_id` (TEXT) - ID операции от провайдера
- `label` (TEXT) - оригинальный label от YooMoney
- `raw` (JSONB) - полные данные от YooMoney
- `created_at` (TIMESTAMP) - время создания

## Безопасность
- Проверка подписи YooMoney для предотвращения подделок
- Идемпотентность по `order_id` (повторные запросы не дублируют данные)
- Логирование всех операций для отладки
