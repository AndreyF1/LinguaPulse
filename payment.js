// payment-worker.js для обработки подписок через Tribute
// Обрабатывает подписки и обновляет профиль пользователя

export default {
  async fetch(request, env) {
    // Принимаем только POST запросы
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Разбираем тело запроса
    let data;
    try {
      data = await request.json();
    } catch (error) {
      return new Response('Invalid JSON', { status: 400 });
    }
    
    // Получаем идентификатор телеграм из запроса
    const telegramId = data.telegram_id;
    if (!telegramId || isNaN(parseInt(telegramId))) {
      return new Response('Invalid telegram ID', { status: 400 });
    }
    
    // Обрабатываем разные действия
    switch (data.action) {
      case 'process_subscription':
        // Обрабатываем подписку (вызывается из webhook-обработчика Tribute)
        return await processSubscription(telegramId, env);
        
      default:
        return new Response('Invalid action', { status: 400 });
    }
  },
};

// Обрабатываем подписку после успешной оплаты
async function processSubscription(telegramId, env) {
  console.log(`Processing subscription for user ${telegramId}`);
  
  try {
    // Получаем текущий профиль пользователя
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(telegramId, 10))
      .all();
    
    if (!results.length) {
      console.error(`User not found: ${telegramId}`);
      return new Response('User not found', { status: 404 });
    }
    
    const profile = results[0];
    console.log(`Processing subscription for user profile:`, {
      telegramId,
      current_subscription: profile.subscription_expired_at,
      current_next_lesson: profile.next_lesson_access_at
    });
    
    // Рассчитываем даты подписки
    const now = new Date();
    const subscribed_at = now.toISOString();
    
    // Устанавливаем дату истечения на 7 дней с текущего момента
    const expirationDate = new Date(now);
    expirationDate.setDate(expirationDate.getDate() + 7);
    expirationDate.setHours(23, 59, 59, 999);
    const subscription_expired_at = expirationDate.toISOString();
    
    // Для новых подписок делаем урок сразу доступным
    const nextLessonDate = new Date(now);
    // Проверяем, является ли это первой подпиской пользователя
    if (!profile.subscription_expired_at || new Date(profile.subscription_expired_at) < now) {
      // Первый раз подписывается или подписка истекла - сделать урок доступным сразу
      nextLessonDate.setTime(now.getTime() - 60000); // Устанавливаем на 1 минуту назад для гарантии доступности
    } else {
      // Продление - следуем обычному расписанию
      nextLessonDate.setHours(2, 0, 0, 0);
      // Если уже после 2 утра, устанавливаем на завтра
      if (now.getHours() >= 2) {
        nextLessonDate.setDate(nextLessonDate.getDate() + 1);
      }
    }
    
    const next_lesson_access_at = nextLessonDate.toISOString();
    
    // Рассчитываем новую сумму оплаты (добавляем $1 к текущему значению)
    const currentAmount = profile.amount_paid || 0;
    const amount_paid = currentAmount + 1;
    
    // Записываем платеж в таблицу payment_history
    try {
      await env.USER_DB
        .prepare(`
          INSERT INTO payment_history (
            telegram_id, 
            amount, 
            status, 
            created_at
          ) VALUES (?, ?, ?, ?)
        `)
        .bind(
          parseInt(telegramId, 10),
          1.00, // $1.00
          'completed',
          new Date().toISOString()
        )
        .run();
      
      console.log(`Payment recorded for user ${telegramId}`);
    } catch (paymentError) {
      console.error('Error recording payment:', paymentError);
      // Продолжаем даже при ошибке записи платежа
    }
    
    // Важно: прямое обновление профиля пользователя с более подробным логированием
    console.log(`Updating user profile with new subscription data:`, {
      telegramId,
      new_subscription_expired_at: subscription_expired_at,
      new_next_lesson_access_at: next_lesson_access_at
    });
    
    try {
      const updateResult = await env.USER_DB
        .prepare(`
          UPDATE user_profiles 
          SET subscribed_at = ?, 
              subscription_expired_at = ?, 
              next_lesson_access_at = ?, 
              amount_paid = ?
          WHERE telegram_id = ?
        `)
        .bind(
          subscribed_at,
          subscription_expired_at,
          next_lesson_access_at,
          amount_paid,
          parseInt(telegramId, 10)
        )
        .run();
      
      console.log('Profile update result:', updateResult);
      
      // Дополнительная проверка, что обновление прошло успешно
      const { results: updatedProfile } = await env.USER_DB
        .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
        .bind(parseInt(telegramId, 10))
        .all();
      
      if (updatedProfile.length > 0) {
        console.log('Profile after update:', {
          subscription_expired_at: updatedProfile[0].subscription_expired_at,
          next_lesson_access_at: updatedProfile[0].next_lesson_access_at
        });
      }
    } catch (updateError) {
      console.error('Error updating user profile:', updateError);
      throw updateError; // Пробрасываем ошибку дальше для обработки
    }
    
    console.log(`Subscription activated for user ${telegramId} until ${subscription_expired_at}`);
    
    // Отправляем подтверждение пользователю
    await sendSubscriptionConfirmation(telegramId, env);
    
    return new Response(JSON.stringify({
      success: true,
      message: "Subscription activated successfully",
      subscription_expired_at: subscription_expired_at,
      next_lesson_access_at: next_lesson_access_at
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Error processing subscription:', error);
    return new Response(JSON.stringify({
      success: false,
      error: "Database error: " + error.message
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Отправляем подтверждение подписки через Telegram
async function sendSubscriptionConfirmation(chatId, env) {
  const message = "🎉 Your weekly subscription has been activated! You now have access to personalized English lessons for the next 7 days.";
  
  const keyboard = {
    inline_keyboard: [
      [{ text: "Start Lesson Now", callback_data: "lesson:start" }]
    ]
  };
  
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      reply_markup: keyboard
    })
  });
}
