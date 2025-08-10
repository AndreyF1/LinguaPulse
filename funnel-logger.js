// Вспомогательная функция для логирования воронки начинающих пользователей
// Используется во всех workers для единообразного логирования

/**
 * Логирует этап воронки для начинающих пользователей
 * @param {number} chatId - Telegram ID пользователя
 * @param {string} step - Название этапа (например, 'entered_bot_at')
 * @param {Object} db - Экземпляр базы данных D1
 * @param {string} [languageLevel] - Уровень языка (если уже известен)
 */
async function logBeginnerFunnelStep(chatId, step, db, languageLevel = null) {
  try {
    // Проверяем, что это действительно начинающий пользователь
    if (!languageLevel) {
      const userSurvey = await db.prepare(
        'SELECT language_level FROM user_survey WHERE telegram_id = ?'
      ).bind(chatId).first();
      
      languageLevel = userSurvey?.language_level;
    }
    
    // Логируем только для начинающих
    if (languageLevel !== 'Начинающий' && languageLevel !== 'Beginner') {
      return; // Не логируем для других уровней
    }
    
    const now = new Date().toISOString();
    
    // Создаем запись или обновляем существующую
    await db.prepare(`
      INSERT INTO beginners_funnel (telegram_id, language_level, ${step}, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        ${step} = excluded.${step},
        updated_at = excluded.updated_at
    `).bind(chatId, languageLevel, now, now).run();
    
    console.log(`✅ Logged beginner funnel step: ${step} for user ${chatId} (${languageLevel})`);
  } catch (error) {
    // Ошибки логирования не должны ломать основной флоу
    console.error(`❌ Failed to log beginner funnel step ${step} for user ${chatId}:`, error);
  }
}

/**
 * Безопасная версия логирования - никогда не бросает исключения
 * @param {number} chatId - Telegram ID пользователя
 * @param {string} step - Название этапа
 * @param {Object} db - Экземпляр базы данных D1
 * @param {string} [languageLevel] - Уровень языка
 */
async function safeLogBeginnerFunnelStep(chatId, step, db, languageLevel = null) {
  try {
    await logBeginnerFunnelStep(chatId, step, db, languageLevel);
  } catch (error) {
    // Полностью поглощаем все ошибки логирования
    console.error(`Silent error in funnel logging for ${chatId}:`, error);
  }
}

module.exports = {
  logBeginnerFunnelStep,
  safeLogBeginnerFunnelStep
};
