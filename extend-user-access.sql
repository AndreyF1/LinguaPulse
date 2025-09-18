-- Продление доступа для пользователя 59156205 на 7 дней
-- Обновляем text_trial_ends_at на 7 дней от текущей даты или от существующей даты (если она больше)

UPDATE users 
SET text_trial_ends_at = GREATEST(
    COALESCE(text_trial_ends_at, NOW()),
    NOW()
) + INTERVAL '7 days'
WHERE telegram_id = 59156205;

-- Проверяем результат
SELECT 
    telegram_id,
    text_trial_ends_at,
    package_expires_at,
    interface_language
FROM users 
WHERE telegram_id = 59156205;
