// telegram-webhook/worker.js with Tribute.tg integration
// Receives every Telegram update on /tg and routes it to TEST or LESSON0

export default {
  async fetch(request, env) {
    // Просто логируем все доступные ключи в env для диагностики
    console.log(`[DEBUG] All available env keys:`, Object.keys(env || {}).join(', '));
    
    // Логируем DEV_MODE для диагностики
    console.log(`[DEBUG] DEV_MODE value:`, env.DEV_MODE, `(type: ${typeof env.DEV_MODE})`);
    
    // Удаляем глобальную переменную и просто логируем сервисы
    console.log(`[DEBUG] Available services in env:`, 
                Object.keys(env || {})
                .filter(key => ['TEST', 'LESSON0', 'MAIN_LESSON'].includes(key))
                .join(', '));
    
    try {
      const { pathname } = new URL(request.url);

      // Handle Tribute webhook
      if (pathname === '/tribute-webhook') {
        return await handleTributeWebhook(request, env);
      }
      
      // Handle test subscription webhook for dev environment only
      if (pathname === '/test-subscription' && env.DEV_MODE === 'true') {
        return await handleTestSubscription(request, env);
      }
      
      if (pathname !== '/tg') return new Response('Not found', { status: 404 });

      // 0. parse safely
      let update = {};
      try { 
        update = await request.json(); 
        console.log(`Received update: ${JSON.stringify(update).substring(0, 200)}...`);
      } catch (e) { 
        console.error("JSON parse error:", e);
        return new Response('Bad request', { status: 200 }); // Return 200 to Telegram even for bad requests
      }

      const chatId = update.message?.chat?.id
                  || update.callback_query?.message?.chat?.id;
      if (!chatId) return new Response('OK');

      // Handle /help command, unknown commands, and regular text messages
const supportedCommands = ['/start', '/profile', '/lesson', '/talk', '/help'];

if (update.message?.text) {
  if (update.message.text === '/help' || 
      !supportedCommands.some(cmd => update.message.text.startsWith(cmd))) {
    await sendMessageWithSubscriptionCheck(chatId, 
      '🤖 *LinguaPulse Bot Commands:*\n\n' +
      '*/start* - Begin the language placement test or see your profile\n' +
      '*/profile* - View your language level and progress\n' +
      '*/lesson* - Access your lessons and subscription status\n' +
      '*/talk* - Start today\'s lesson (for subscribers)\n' +
      '*/help* - Show this help message\n\n' +
      '💡 *Did you know?* Just 10-15 minutes of conversation practice daily can improve your English skills more than years of study without regular speaking practice!\n\n' +
      '• Send voice messages during the lesson to practice speaking\n' +
      '• The AI tutor may take a few seconds to think and respond\n' +
      '• Lessons end automatically\n' +
      '• You\'ll receive personalized grammar and vocabulary feedback after each lesson', 
      env,
      { parse_mode: 'Markdown' });
    return new Response('OK');
  }
}

      // Handle /talk command - route to main-lesson
      if (update.message?.text === '/talk') {
        console.log(`🎯 [${chatId}] /talk command received`);
        console.log(`🔍 [${chatId}] Checking MAIN_LESSON worker availability...`);
        console.log(`🔍 [${chatId}] env.MAIN_LESSON exists:`, !!env.MAIN_LESSON);
        console.log(`🔍 [${chatId}] env.MAIN_LESSON type:`, typeof env.MAIN_LESSON);
        
        // Check if the MAIN_LESSON worker is available
        if (!env.MAIN_LESSON) {
          console.error(`❌ [${chatId}] MAIN_LESSON worker is undefined, cannot forward /talk command`);
          console.error(`❌ [${chatId}] Available env services:`, Object.keys(env).filter(key => key.includes('LESSON') || key.includes('TEST')));
          
          // Check if user has completed the test
          if (await hasCompletedTest(chatId, env)) {
            // Get user subscription status
            const { results } = await env.USER_DB
              .prepare('SELECT subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            
            const now = new Date();
            const hasActiveSubscription = results.length > 0 && 
                                         results[0].subscription_expired_at && 
                                         (new Date(results[0].subscription_expired_at) > now);
            
            if (hasActiveSubscription) {
                      // If they have an active subscription but worker is unavailable
        await sendMessageViaTelegram(chatId, 
          "❌ *Sorry, the lesson service is temporarily unavailable.* Please try again later.", env, { parse_mode: 'Markdown' });
            } else {
                        // If they don't have an active subscription, show subscription option
          await sendTributeChannelLink(chatId, env);
            }
          } else {
                      // If they haven't completed the test
          await sendMessageViaTelegram(chatId, 
            "📝 *You need to complete the placement test first.* Use /start to begin.", env, { parse_mode: 'Markdown' });
          }
          return new Response('OK');
        }
        
        // Forward directly to main-lesson worker if available
        console.log(`📤 [${chatId}] MAIN_LESSON worker found, attempting to forward /talk command`);
        console.log(`📤 [${chatId}] Forward payload:`, JSON.stringify(update).substring(0, 200));
        
        try {
          const forwardResult = forward(env.MAIN_LESSON, update);
          console.log(`✅ [${chatId}] Forward call completed`);
          return forwardResult;
        } catch (forwardError) {
          console.error(`❌ [${chatId}] Error in forward function:`, forwardError);
          await sendMessageViaTelegram(chatId, 
            "❌ *Sorry, there was an error starting your lesson.* Please try again.", env, { parse_mode: 'Markdown' });
          return new Response('OK');
        }
      }

      // Handle /profile command - show user-friendly profile data
      if (update.message?.text === '/profile') {
        const { results } = await env.USER_DB
          .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        const profile = results[0] || {};
        
        if (!profile.eng_level) {
          await sendMessageWithSubscriptionCheck(chatId, 
            '📝 *You haven\'t taken the placement test yet.* Use /start to begin.', env, { parse_mode: 'Markdown' });
        } else {
          // Basic profile info
          const testedAt = profile.tested_at ? new Date(profile.tested_at).toLocaleDateString() : 'N/A';
          const lessonsTotal = profile.number_of_lessons || 0;
          const lessonsStreak = profile.lessons_in_row || 0;
          
          // Check subscription status (simple version)
          const now = new Date();
          const hasActiveSubscription = profile.subscription_expired_at && 
                                      (new Date(profile.subscription_expired_at) > now);
          const subscriptionStatus = hasActiveSubscription ? 'Active' : 'Inactive - Subscribe to continue learning';
          
          let message = `📊 *Your Language Profile*\n\n` +
            `🎯 *Level:* ${profile.eng_level}\n` +
            `💳 *Subscription:* ${subscriptionStatus}\n` +
            `📚 *Total lessons:* ${lessonsTotal}\n` +
            `🔥 *Current streak:* ${lessonsStreak} days\n\n`;
          
          // Show profile with appropriate options based on subscription status
          await sendMessageWithSubscriptionCheck(chatId, message, env, { parse_mode: 'Markdown' });
        }
        
        return new Response('OK');
      }

      // Handle /lesson command - same as /start for users who completed the test
if (update.message?.text === '/lesson' || 
(update.message?.text === '/start' && await hasCompletedTest(chatId, env))) {
try {
console.log(`Calling handleLessonCommand for user ${chatId}`);
await handleLessonCommand(chatId, env);
} catch (error) {
console.error(`Error handling /lesson command for user ${chatId}:`, error);
// Fallback response in case of error
try {
  await sendMessageWithSubscriptionCheck(chatId, 
    "Sorry, there was an error processing your command. Please try again later or contact support.", 
    env);
} catch (sendError) {
  console.error("Failed to send error message:", sendError);
}
}
return new Response('OK');
}
      
      // Modified /start command to check for welcome parameter
      if (update.message?.text?.startsWith('/start')) {
        // Check if this is a return from subscription
        const isWelcomeBack = update.message.text.includes('welcome');
        
        if (isWelcomeBack) {
          // This is a user returning from subscribing
          const { results } = await env.USER_DB
            .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          if (results.length > 0) {
            const profile = results[0];
            const now = new Date();
            
            // Check if subscription is active
            const hasActiveSubscription = profile.subscription_expired_at && 
                                        (new Date(profile.subscription_expired_at) > now);
            
            if (hasActiveSubscription) {
              // Subscription is active, check if lesson is available
              if (profile.next_lesson_access_at && (new Date(profile.next_lesson_access_at) <= now)) {
                // Lesson is available, offer to start it
                await sendMessageWithSubscriptionCheck(chatId,
                  "🎉 Welcome back! Your subscription is active and your lesson is ready. Would you like to start it now?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] }});
                return new Response('OK');
              }
            } else {
              // Subscription inactive or expired, offer to subscribe
              const channelLink = env.TRIBUTE_CHANNEL_LINK;
              if (channelLink) {
                await sendMessageWithSubscriptionCheck(chatId,
                  "Welcome back! Your subscription has expired. Subscribe again to continue learning.",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Subscribe for €2/week", url: channelLink }]] }});
                return new Response('OK');
              }
            }
          }
        }
        
        // Check if user has completed test already
        if (await hasCompletedTest(chatId, env)) {
          await handleLessonCommand(chatId, env);
          return new Response('OK');
        }
        
        // Check if user is new or needs to register first
        const { results } = await env.USER_DB
          .prepare('SELECT telegram_id FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        if (results.length === 0) {
          // New user - create initial record in database
          const startAt = new Date().toISOString();
          await env.USER_DB
            .prepare(
              `INSERT INTO user_profiles (telegram_id, start_test_at)
               VALUES (?, ?)
               ON CONFLICT(telegram_id) DO UPDATE
                 SET start_test_at = excluded.start_test_at`
            )
            .bind(parseInt(chatId, 10), startAt)
            .run();
        }
        
        // Forward to TEST bot for test generation and question flow
        console.log("Forwarding /start command to TEST bot");
        return forward(env.TEST, update);
      }

      // Handle voice messages with improved routing
      if (update.message?.voice) {
        try {
          console.log(`=== VOICE MESSAGE HANDLING START ===`);
          console.log(`Received voice message from chat ${chatId}, message ID: ${update.message.message_id}`);
          console.log(`Available services:`, Object.keys(env).filter(key => ['TEST', 'LESSON0', 'MAIN_LESSON'].includes(key)));
          
          // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Проверяем доступность CHAT_KV
          if (!env.CHAT_KV) {
            console.error(`CHAT_KV is not available! Available env keys:`, Object.keys(env));
            
            // Если нет CHAT_KV, используем TEST_KV как резервный вариант
            if (env.TEST_KV) {
              console.log(`Using TEST_KV as fallback for session storage`);
              
              // Проверяем сессии в TEST_KV
              const lesson0SessionKey = `session:${chatId}`;
              const lesson0Session = await env.TEST_KV.get(lesson0SessionKey);
              
              if (lesson0Session) {
                console.log(`Found lesson0 session in TEST_KV (${lesson0Session}), forwarding to LESSON0`);
                return forward(env.LESSON0, update);
              }
            }
            
            // Если нет активной сессии нигде, проверим статус пользователя в DB
            console.log(`No active session found, checking user status in database`);
            const { results } = await env.USER_DB
              .prepare('SELECT eng_level, pass_lesson0_at FROM user_profiles WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            
            if (results.length > 0) {
              // КРИТИЧЕСКАЯ ПРОВЕРКА: Пользователь должен сначала пройти placement test
              if (!results[0].eng_level) {
                console.log(`User hasn't completed placement test, directing to /start`);
                await sendMessageViaTelegram(chatId, 
                  "Please start by taking our placement test. Type /start to begin.",
                  env
                );
                return new Response('OK');
              }
              
              if (!results[0].pass_lesson0_at) {
                console.log(`User has completed test but hasn't taken free lesson, suggesting free lesson`);
                await sendMessageViaTelegram(chatId, 
                  "Would you like to try our free English conversation lesson?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Free Lesson", callback_data: "lesson:free" }]] } }
                );
              } else {
                console.log(`User has completed free lesson, suggesting subscription`);
                await sendTributeChannelLink(chatId, env);
              }
            } else {
              console.log(`User not found in database, suggesting /start`);
              await sendMessageViaTelegram(chatId, 
                "Please start by taking our placement test. Type /start to begin.",
                env
              );
            }
            return new Response('OK');
          }
          
          // First check if it's a main lesson session
          const mainSessionKey = `main_session:${chatId}`;
          let mainSession = null;
          
          console.log(`🔍 [${chatId}] Checking CHAT_KV for ${mainSessionKey}`);
          mainSession = await env.CHAT_KV.get(mainSessionKey);
          
          if (mainSession) {
            console.log(`✅ [${chatId}] Found active main-lesson session (${mainSession}), forwarding voice message to MAIN_LESSON`);
            console.log(`📤 [${chatId}] Forwarding voice message to MAIN_LESSON worker`);
            return forward(env.MAIN_LESSON, update);
          } else {
            console.log(`❌ [${chatId}] No main-lesson session found in CHAT_KV`);
          }
          
          // If not found in main session, check for lesson0 session directly in CHAT_KV
          const lesson0SessionKey = `session:${chatId}`;
          const lesson0Session = await env.CHAT_KV.get(lesson0SessionKey);
          
          if (lesson0Session) {
            console.log(`Found active lesson0 session (${lesson0Session}), forwarding voice message to LESSON0`);
            return forward(env.LESSON0, update);
          }
          
          console.log(`=== NO ACTIVE SESSION FOUND ===`);
          console.log(`Checking for orphaned history data...`);
          
          // ДОБАВЛЕНА ПРОВЕРКА: Если у пользователя нет активной сессии, но есть история в KV,
          // это может означать, что сессия была некорректно очищена
          const histKey = `hist:${chatId}`;
          const histData = await env.CHAT_KV.get(histKey);
          
          if (histData) {
            try {
              // Пробуем восстановить сессию для lesson0
              const hist = JSON.parse(histData);
              if (Array.isArray(hist) && hist.length > 0) {
                console.log(`Found orphaned history (${hist.length} messages), recreating lesson0 session`);
                // Создаем новый ID сессии и сохраняем его
                const newSessionId = Date.now().toString();
                await env.CHAT_KV.put(`session:${chatId}`, newSessionId);
                console.log(`Recreated lesson0 session (${newSessionId}), forwarding to LESSON0`);
                return forward(env.LESSON0, update);
              } else {
                console.log(`Found empty or invalid history, cleaning up`);
                await env.CHAT_KV.delete(histKey);
              }
            } catch (e) {
              console.error("Error parsing history data:", e);
              // Очищаем поврежденные данные
              await env.CHAT_KV.delete(histKey);
            }
          }
          
          console.log(`=== CHECKING USER STATUS IN DATABASE ===`);
          // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Если нет активной сессии, проверим в базе данных,
          // выполнил ли пользователь бесплатный урок, чтобы понять какое действие выполнить
          try {
            const { results } = await env.USER_DB
              .prepare('SELECT eng_level, pass_lesson0_at, subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            
            if (results.length > 0) {
              console.log(`User found in database, eng_level: ${!!results[0].eng_level}, pass_lesson0_at: ${!!results[0].pass_lesson0_at}`);
              
              // КРИТИЧЕСКАЯ ПРОВЕРКА: Пользователь должен сначала пройти placement test  
              if (!results[0].eng_level) {
                console.log(`User ${chatId} hasn't completed placement test, directing to test`);
                message += 'You need to complete the placement test first to determine your English level.';
                await sendMessageWithSubscriptionCheck(chatId, message, env);
                return;
              }
              
              // Если у пользователя уже пройден бесплатный урок
              if (results[0].pass_lesson0_at) {
                const now = new Date();
                const hasActiveSubscription = results[0].subscription_expired_at && 
                                             (new Date(results[0].subscription_expired_at) > now);
                
                console.log(`User has completed free lesson, active subscription: ${hasActiveSubscription}`);
                
                if (hasActiveSubscription) {
                  // Если есть активная подписка, предложить начать урок
                  await sendMessageViaTelegram(chatId, 
                    "Your previous lesson has ended. Would you like to start a new lesson?",
                    env,
                    { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] } }
                  );
                } else {
                  // Если нет активной подписки, предложить подписку
                  console.log(`Sending subscription offer`);
                  await sendTributeChannelLink(chatId, env);
                }
              } else {
                console.log(`User has completed test but hasn't taken free lesson, suggesting free lesson`);
                // Если пользователь не проходил бесплатный урок, предложить его пройти
                await sendMessageViaTelegram(chatId, 
                  "Would you like to try our free English conversation lesson?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Free Lesson", callback_data: "lesson:free" }]] } }
                );
              }
            } else {
              console.log(`User not found in database, suggesting /start`);
              // Если пользователя нет в базе, предложить начать с /start
              await sendMessageViaTelegram(chatId, 
                "Please start by taking our placement test. Type /start to begin.",
                env
              );
            }
          } catch (dbError) {
            console.error("Error checking user status:", dbError);
            // В случае ошибки базы данных, отправляем общее сообщение о необходимости начать сначала
            await sendMessageViaTelegram(chatId, 
              "I couldn't find your active lesson. Please use /start to begin.",
              env
            );
          }
          
          console.log(`=== VOICE MESSAGE HANDLING COMPLETE ===`);
          return new Response('OK');
        } catch (error) {
          console.error("Error handling voice message:", error);
          // Return OK to Telegram even if we have an error
          return new Response('OK');
        }
      }

      // Handle regular text messages outside of sessions
      if (update.message?.text && !update.message.text.startsWith('/')) {
        // Check if user has an active session
        let activeSession = false;
        
        if (env.CHAT_KV) {
          const mainSession = await env.CHAT_KV.get(`main_session:${chatId}`);
          const lesson0Session = await env.CHAT_KV.get(`session:${chatId}`);
          
          if (mainSession || lesson0Session) {
            activeSession = true;
          }
        }
        
        // If no active session, provide info about next lesson or subscription
        if (!activeSession) {
          const { results } = await env.USER_DB
            .prepare('SELECT subscription_expired_at, next_lesson_access_at, eng_level FROM user_profiles WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          // If user hasn't taken the test yet
          if (!results.length || !results[0].eng_level) {
            await sendMessageWithSubscriptionCheck(chatId, 
              "Please use /start to begin the placement test so I can determine your English level.", 
              env);
            return new Response('OK');
          }
          
          const profile = results[0];
          const now = new Date();
          
          // Check if subscription is active
          const hasActiveSubscription = profile.subscription_expired_at && 
                                       (new Date(profile.subscription_expired_at) > now);
          
          if (hasActiveSubscription) {
            // Check when next lesson is available
            if (profile.next_lesson_access_at) {
              const nextLessonAt = new Date(profile.next_lesson_access_at);
              
              if (nextLessonAt > now) {
                // Next lesson in the future - tell user when it will be available
                const timeUntil = formatTimeUntil(nextLessonAt);
                await sendMessageWithSubscriptionCheck(chatId,
                  `Your next lesson will be available in ${timeUntil}. You can use /profile to see your progress.`,
                  env);
                return new Response('OK');
              } else {
                // Lesson is available now - suggest starting it
                await sendMessageWithSubscriptionCheck(chatId,
                  "Your next lesson is available now! Would you like to start?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] }});
                return new Response('OK');
              }
            }
          } else {
            // No active subscription - send message with subscription button
            await sendMessageWithSubscriptionCheck(chatId,
              "To continue with your English lessons, you need an active subscription. Subscribe now for daily speaking practice!",
              env);
            return new Response('OK');
          }
        }
      }

      // 2. handle lesson buttons
      if (update.callback_query?.data === 'lesson:free' || 
          update.callback_query?.data === 'lesson:start') {
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        // If this is the free lesson, handle it as before
        if (update.callback_query?.data === 'lesson:free') {
          // Убираем отправку дублирующего сообщения
          // await sendMessageViaTelegram(chatId, 'Starting audio lesson…', env);

          // mark lesson in progress - проверяем наличие USER_PROFILE или используем TEST_KV
          if (env.USER_PROFILE) {
            await env.USER_PROFILE.put(`lesson:${chatId}`, 'in_progress');
          } else if (env.TEST_KV) {
            console.log("USER_PROFILE not found, using TEST_KV as fallback for lesson state");
            await env.TEST_KV.put(`lesson:${chatId}`, 'in_progress');
          } else {
            console.warn("No KV storage available for lesson state");
          }

          // forward the start payload to lesson0-bot
          console.log("Forwarding lesson:free action to LESSON0");
          return forward(env.LESSON0, {
            user_id: chatId,
            action : 'start_free'
          });
        } 
        // If this is the main lesson (from subscription)
        else if (update.callback_query?.data === 'lesson:start') {
          console.log(`🎯 [${chatId}] lesson:start button pressed`);
          console.log(`🔍 [${chatId}] Checking MAIN_LESSON worker availability...`);
          console.log(`🔍 [${chatId}] env.MAIN_LESSON exists:`, !!env.MAIN_LESSON);
          
          if (!env.MAIN_LESSON) {
            console.error(`❌ [${chatId}] MAIN_LESSON worker is undefined for lesson:start`);
            await sendMessageViaTelegram(chatId, 
              "❌ *Sorry, the lesson service is temporarily unavailable.* Please try again later.", env, { parse_mode: 'Markdown' });
            return new Response('OK');
          }
          
          // Forward to the main-lesson worker with appropriate action
          console.log(`📤 [${chatId}] MAIN_LESSON worker found, forwarding lesson:start action`);
          const payload = {
            user_id: chatId,
            action : 'start_lesson'
          };
          console.log(`📤 [${chatId}] Forward payload:`, JSON.stringify(payload));
          
          try {
            const forwardResult = forward(env.MAIN_LESSON, payload);
            console.log(`✅ [${chatId}] lesson:start forward call completed`);
            return forwardResult;
          } catch (forwardError) {
            console.error(`❌ [${chatId}] Error forwarding lesson:start:`, forwardError);
            await sendMessageViaTelegram(chatId, 
              "❌ *Sorry, there was an error starting your lesson.* Please try again.", env, { parse_mode: 'Markdown' });
            return new Response('OK');
          }
        }
      }
      
      // 2.1 handle subscription button - UPDATED FOR TRIBUTE
      if (update.callback_query?.data === 'subscribe:weekly') {
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        // Check current subscription status
        const { results } = await env.USER_DB
          .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        if (!results.length) {
          await sendMessageWithSubscriptionCheck(chatId, 
            'You need to take the placement test first. Use /start to begin.', env);
          return new Response('OK');
        }
        
        const profile = results[0];
        const now = new Date();
        
        // Check subscription status
        const subExpiredAt = profile.subscription_expired_at ? new Date(profile.subscription_expired_at) : null;
        
        if (!subExpiredAt || subExpiredAt.getTime() < now.getTime()) {
          // If we get here, user doesn't have an active subscription or it has expired
          // UPDATED: Redirect to Tribute channel subscription
          await sendTributeChannelLink(chatId, env);
          return new Response('OK');
        }
        
        // If we get here, user has an active subscription
        // UPDATED: Redirect to Tribute channel subscription
        await sendTributeChannelLink(chatId, env);
        return new Response('OK');
      }

      // 2.2 handle TEST PAYMENT button (DEV ONLY)
      if (update.callback_query?.data === 'test:payment' && env.DEV_MODE === 'true') {
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        console.log(`TEST PAYMENT button pressed by user ${chatId} in DEV mode`);
        
        // Simulate successful payment by calling internal test webhook
        return await simulateSuccessfulPayment(chatId, env);
      }

      // 4. receive end-of-lesson notification (if you choose to send it)
      if (update.lesson_done) {
        // проверяем наличие USER_PROFILE или используем TEST_KV
        if (env.USER_PROFILE) {
          await env.USER_PROFILE.put(`lesson:${chatId}`, 'finished', { expirationTtl: 86400 });
        } else if (env.TEST_KV) {
          console.log("USER_PROFILE not found, using TEST_KV as fallback for lesson state");
          await env.TEST_KV.put(`lesson:${chatId}`, 'finished', { expirationTtl: 86400 });
        } else {
          console.warn("No KV storage available for lesson state");
        }
        return new Response('OK');
      }

      // 5. everything else goes to test-bot
      console.log("Forwarding to TEST bot as default action");
      return forward(env.TEST, update);
    } catch (error) {
      console.error("Unhandled error in telegram-webhook:", error);
      // Always return 200 OK to Telegram webhook to avoid retries
      return new Response('OK');
    }
  }
};

// UPDATED: Handle Tribute webhook for subscription notifications
async function handleTributeWebhook(request, env) {
  try {
    console.log('==== TRIBUTE WEBHOOK RECEIVED ====');
    
    // Ensure this is a POST request
    if (request.method !== 'POST') {
      console.log('Method not allowed, expected POST, got:', request.method);
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Log headers for debugging
    console.log('Request headers:');
    const headersObj = {};
    for (const [key, value] of request.headers.entries()) {
      headersObj[key] = value;
      console.log(`${key}: ${value}`);
    }
    
    // Get the signature if available (for verification)
    const signature = request.headers.get('trbt-signature');
    if (signature) {
      console.log('Provided signature:', signature);
    }
    
    // Get the raw payload
    const payload = await request.text();
    console.log('Tribute webhook payload:', payload);
    
    // Try to parse the payload
    let event;
    try {
      event = JSON.parse(payload);
      console.log('Parsed event:', JSON.stringify(event));
    } catch (parseError) {
      console.error('Failed to parse payload as JSON:', parseError);
      return new Response('Invalid JSON payload', { status: 400 });
    }
    
    // CRITICAL: Extract telegram_user_id from the correct location in the structure
    let userId = null;
    
    // Look for telegram_user_id in the payload object (actual Tribute structure)
    if (event.payload && event.payload.telegram_user_id) {
      userId = event.payload.telegram_user_id;
      console.log(`Found telegram_user_id in event.payload: ${userId}`);
    }
    // Fallback: Check for user_id directly in the event
    else if (event.telegram_user_id) {
      userId = event.telegram_user_id;
      console.log(`Found telegram_user_id directly in event: ${userId}`);
    }
    // Fallback: Check for user_id in various other locations
    else if (event.user_id) {
      userId = event.user_id;
      console.log(`Found user_id directly in event: ${userId}`);
    }
    else if (event.payload && event.payload.user_id) {
      userId = event.payload.user_id;
      console.log(`Found user_id in event.payload: ${userId}`);
    }
    else {
      console.error('Could not find telegram_user_id or user_id in webhook payload');
      console.log('Full event structure:', JSON.stringify(event));
      return new Response('Missing user ID in webhook payload', { status: 400 });
    }
    
    console.log(`Using user_id: ${userId}`);
    
    // Extract subscription information
    let isNewSubscription = false;
    let expiryDate = null;
    
    // Check if this is a new subscription by looking at the name field (Tribute specific)
    if (event.name === 'new_subscription') {
      isNewSubscription = true;
      console.log('Identified as new subscription from event.name');
    }
    
    // Extract expiry date from the correct location (Tribute specific)
    if (event.payload && event.payload.expires_at) {
      expiryDate = new Date(event.payload.expires_at);
      console.log(`Found expires_at in event.payload: ${event.payload.expires_at}`);
    }
    else if (event.expires_at) {
      expiryDate = new Date(event.expires_at);
      console.log(`Found expires_at directly in event: ${event.expires_at}`);
    }
    
    // Validate expiry date
    if (expiryDate && isNaN(expiryDate.getTime())) {
      console.warn('Invalid expiry date format detected');
      expiryDate = null;
    }
    
    // If no valid date found, use default (7 days)
    if (!expiryDate) {
      console.log('Using default expiry date (7 days from now)');
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);
    }
    
    console.log('Expiry date:', expiryDate.toISOString());
    
    // Process subscription if it's new or we're forcing an update
    if (isNewSubscription) {
      // Calculate dates for subscription
      const now = new Date();
      const subscribed_at = now.toISOString();
      const subscription_expired_at = expiryDate.toISOString();
      
      // For new subscriptions, make next lesson immediately available
      const nextLessonDate = new Date(now);
      nextLessonDate.setTime(now.getTime() - 60000); // 1 minute ago to ensure availability
      const next_lesson_access_at = nextLessonDate.toISOString();
      
      // Update user profile with subscription info
      try {
        // Check if user exists in our database
        console.log(`Checking if user ${userId} exists in database...`);
        const { results, success, error } = await env.USER_DB
          .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(userId, 10))
          .all();
        
        if (!success) {
          console.error('Database query error:', error);
          throw new Error('Database query failed: ' + (error || 'Unknown error'));
        }
        
        if (results.length === 0) {
          console.error(`User ${userId} not found in database`);
          return new Response(`User ${userId} not found in database. Please complete the placement test first.`, { 
            status: 404, 
            headers: { 'Content-Type': 'text/plain' } 
          });
        }
        
        console.log(`User ${userId} found, updating subscription...`);
        
        // Update subscription info
        const updateResult = await env.USER_DB
          .prepare(`
            UPDATE user_profiles
            SET subscribed_at = ?,
                subscription_expired_at = ?,
                next_lesson_access_at = ?
            WHERE telegram_id = ?
          `)
          .bind(
            subscribed_at,
            subscription_expired_at,
            next_lesson_access_at,
            parseInt(userId, 10)
          )
          .run();
        
        console.log('Database update result:', updateResult);
        
        if (!updateResult.success) {
          console.error('Database update error:', updateResult.error);
          throw new Error('Failed to update subscription: ' + (updateResult.error || 'Unknown error'));
        }
        
        // Double-check that the update was successful
        const { results: verifyResults } = await env.USER_DB
          .prepare('SELECT subscribed_at, subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(userId, 10))
          .all();
        
        if (verifyResults.length > 0) {
          console.log('Subscription successfully updated:', {
            user_id: userId,
            subscribed_at: verifyResults[0].subscribed_at,
            subscription_expired_at: verifyResults[0].subscription_expired_at
          });
        }
        
        // Notify user about successful subscription
        try {
          console.log(`Sending notification to user ${userId}`);
          await sendMessageWithSubscriptionCheck(userId,
            "🎉 *Your subscription has been activated!* You now have access to daily personalized English lessons.",
            env,
            { 
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: [[{ text: "Start Lesson Now", callback_data: "lesson:start" }]] } 
            }
          );
          console.log(`Notification sent to user ${userId}`);
        } catch (msgError) {
          console.error('Error sending subscription notification:', msgError);
          // Continue even if notification fails
        }
        
        console.log('==== TRIBUTE WEBHOOK PROCESSING COMPLETED SUCCESSFULLY ====');
        
        return new Response(JSON.stringify({ 
          status: 'success',
          message: 'Subscription activated successfully',
          user_id: userId,
          expiry_date: subscription_expired_at
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.error('Error processing subscription:', error);
        return new Response(JSON.stringify({ 
          status: 'error', 
          message: 'Database error: ' + error.message 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      console.log('Not identified as a new subscription event, skipping processing');
      return new Response(JSON.stringify({
        status: 'success',
        message: 'Event received but not processed (not identified as a new subscription)'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
  } catch (error) {
    console.error('Unhandled error in handleTributeWebhook:', error);
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'Internal server error: ' + error.message 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Verify Tribute webhook signature
async function verifyTributeSignature(payload, signature, apiKey) {
  if (!payload || !signature || !apiKey) {
    throw new Error('Missing required parameters for signature verification');
  }

  try {
    // Tribute uses standard HMAC-SHA256 for signature verification
    // 1. Create a crypto key from the API key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    
    // 2. Calculate HMAC of the payload
    const payloadData = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      payloadData
    );
    
    // 3. Convert to hex
    const calculatedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // 4. Compare with the provided signature
    // Note: Depending on how Tribute formats their signature, you might need to adjust this comparison
    // Some services use base64 encoding, others use hex
    console.log('Calculated signature:', calculatedSignature);
    console.log('Provided signature:', signature);
    
    return calculatedSignature === signature;
  } catch (error) {
    console.error('Error during signature verification:', error);
    throw new Error('Signature verification failed: ' + error.message);
  }
}

// Handle test subscription for dev environment
async function handleTestSubscription(request, env) {
  try {
    // Additional security check - only allow in dev mode
    if (env.DEV_MODE !== 'true') {
      console.log('Test subscription endpoint called but DEV_MODE is not enabled');
      return new Response('Not found', { status: 404 });
    }
    
    console.log('==== TEST SUBSCRIPTION WEBHOOK RECEIVED (DEV MODE) ====');
    
    // Ensure this is a POST request
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Get the payload
    const payload = await request.text();
    console.log('Test subscription payload:', payload);
    
    let event;
    try {
      event = JSON.parse(payload);
      console.log('Parsed test subscription event:', JSON.stringify(event));
    } catch (parseError) {
      console.error('Failed to parse test subscription payload:', parseError);
      return new Response('Invalid JSON payload', { status: 400 });
    }
    
    // Extract user ID
    const userId = event.user_id || event.telegram_id;
    if (!userId) {
      console.error('Missing user_id in test subscription payload');
      return new Response('Missing user_id', { status: 400 });
    }
    
    console.log(`Processing test subscription for user: ${userId}`);
    
    // Calculate subscription dates
    const now = new Date();
    const subscribed_at = now.toISOString();
    
    // Set expiry to 7 days from now
    const expiryDate = new Date(now);
    expiryDate.setDate(expiryDate.getDate() + 7);
    const subscription_expired_at = expiryDate.toISOString();
    
    // Make next lesson immediately available
    const nextLessonDate = new Date(now);
    nextLessonDate.setTime(now.getTime() - 60000); // 1 minute ago
    const next_lesson_access_at = nextLessonDate.toISOString();
    
    // Update user profile
    try {
      // Check if user exists
      const { results } = await env.USER_DB
        .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
        .bind(parseInt(userId, 10))
        .all();
      
      if (results.length === 0) {
        return new Response(`User ${userId} not found in database`, { status: 404 });
      }
      
      // Update subscription
      const updateResult = await env.USER_DB
        .prepare(`
          UPDATE user_profiles
          SET subscribed_at = ?,
              subscription_expired_at = ?,
              next_lesson_access_at = ?
          WHERE telegram_id = ?
        `)
        .bind(
          subscribed_at,
          subscription_expired_at,
          next_lesson_access_at,
          parseInt(userId, 10)
        )
        .run();
      
      if (!updateResult.success) {
        throw new Error('Failed to update subscription: ' + updateResult.error);
      }
      
      console.log('Test subscription updated successfully for user:', userId);
      
      // Notify user
      await sendMessageWithSubscriptionCheck(userId,
        "🎉 *Test subscription activated!* (Dev Environment)\n\n" +
        "Your 7-day test subscription is now active. You have access to daily personalized English lessons.",
        env,
        { 
          parse_mode: 'Markdown',
          reply_markup: { 
            inline_keyboard: [[{ text: "Start Lesson Now", callback_data: "lesson:start" }]] 
          }
        }
      );
      
      return new Response(JSON.stringify({ 
        status: 'success',
        message: 'Test subscription activated',
        user_id: userId,
        expiry_date: subscription_expired_at
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
      
    } catch (error) {
      console.error('Error processing test subscription:', error);
      return new Response(JSON.stringify({ 
        status: 'error', 
        message: error.message 
      }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
  } catch (error) {
    console.error('Unhandled error in handleTestSubscription:', error);
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'Internal server error: ' + error.message 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Simulate successful payment (DEV ONLY)
async function simulateSuccessfulPayment(chatId, env) {
  try {
    console.log(`=== SIMULATING SUCCESSFUL PAYMENT FOR USER ${chatId} ===`);
    
    // Create fake Tribute webhook payload  
    const fakeWebhookPayload = {
      name: "new_subscription",
      payload: {
        telegram_user_id: chatId,
        subscription_id: `test_sub_${Date.now()}`,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days from now
        amount: 200,
        currency: "EUR",
        created_at: new Date().toISOString(),
        status: "active"
      },
      timestamp: Math.floor(Date.now() / 1000),
      webhook_id: `webhook_test_${Date.now()}`
    };
    
    console.log('Simulating Tribute webhook payload:', JSON.stringify(fakeWebhookPayload));
    
    // Create fake request object
    const fakeRequest = {
      method: 'POST',
      headers: new Map([
        ['content-type', 'application/json'],
        ['trbt-signature', `test_signature_${Date.now()}`]
      ]),
      text: async () => JSON.stringify(fakeWebhookPayload)
    };
    
    // Call the actual webhook handler
    const response = await handleTributeWebhook(fakeRequest, env);
    
    console.log(`Simulated payment webhook response status: ${response.status}`);
    
    if (response.status === 200) {
      console.log(`✅ Payment simulation successful for user ${chatId}`);
      
      // После успешной активации тестовой подписки открываем канал (как делает настоящий Tribute)
      setTimeout(async () => {
        try {
          await sendMessageViaTelegram(chatId, 
            "🎯 *Welcome to the LinguaPulse community!*\n\n" +
            "Join our Telegram channel to stay updated with English learning tips and connect with other learners:",
            env,
            { 
              parse_mode: 'Markdown',
              reply_markup: { 
                inline_keyboard: [[{ text: "📢 Join Channel", url: "https://t.me/lingua_pulse" }]] 
              }
            }
          );
        } catch (channelError) {
          console.error('Error sending channel invitation:', channelError);
        }
      }, 2000); // Отправляем через 2 секунды после уведомления о подписке
      
    } else {
      console.error(`❌ Payment simulation failed for user ${chatId}`);
    }
    
    return new Response('OK');
    
  } catch (error) {
    console.error('Error in simulateSuccessfulPayment:', error);
    
    // Send error message to user
    await sendMessageViaTelegram(chatId, 
      `❌ *Payment simulation failed* (Dev Mode)\n\nError: ${error.message}`, 
      env, 
      { parse_mode: 'Markdown' }
    );
    
    return new Response('OK');
  }
}

// Function to send Tribute channel link for subscription
async function sendTributeChannelLink(chatId, env) {
  console.log(`[DEBUG] sendTributeChannelLink called for user ${chatId}`);
  
  // Сначала проверяем специальную ссылку на приложение Tribute
  let tributeAppLink = env.TRIBUTE_APP_LINK;
  
  // Если нет специальной ссылки, проверяем обычную ссылку на канал
  if (!tributeAppLink || tributeAppLink.trim() === '') {
    console.log(`[DEBUG] TRIBUTE_APP_LINK not found, checking TRIBUTE_CHANNEL_LINK`);
    tributeAppLink = env.TRIBUTE_CHANNEL_LINK;
  }
  
  // Если обе переменные отсутствуют, используем запасную ссылку
  if (!tributeAppLink || tributeAppLink.trim() === '') {
    console.warn(`[DEBUG] No Tribute links found in environment, using fallback link`);
    tributeAppLink = "https://t.me/tribute/app?startapp=svwW"; // Запасная ссылка на Tribute
  }
  
  // Проверяем, что ссылка имеет корректный формат
  if (tributeAppLink && !tributeAppLink.match(/^https?:\/\//)) {
    console.warn(`[DEBUG] Tribute link doesn't start with http:// or https://, fixing: ${tributeAppLink}`);
    tributeAppLink = "https://" + tributeAppLink.replace(/^[\/\\]+/, '');
  }

  const message = "🔑 *To unlock premium lessons, please subscribe:*\n\n" +
                 "1️⃣ Click the button below to open the subscription page\n" +
                 "2️⃣ Complete the payment process *(€2/week)*\n" +
                 "3️⃣ After payment, you'll receive a confirmation message from the bot\n\n" +
                 "🎯 *Your subscription will give you access to daily personalized English lessons!*";
  
  // Prepare buttons array
  const buttons = [];
  
  // Always add the real subscription button if link is available
  if (tributeAppLink) {
    buttons.push([{ text: "Subscribe for €2/week", url: tributeAppLink }]);
  }
  
  // Add test payment button ONLY in dev mode
  if (env.DEV_MODE === 'true') {
    buttons.push([{ text: "🧪 TEST PAYMENT (Dev Only)", callback_data: "test:payment" }]);
  }
  
  // Send message with appropriate buttons
  if (buttons.length > 0) {
    await sendMessageViaTelegram(chatId, message, env, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
  } else {
    await sendMessageViaTelegram(chatId, message, env, { parse_mode: 'Markdown' });
  }
}

// KV prefix for transient test state
const STATE_PREFIX = 'state:';

/* ──── helper: send a text via Telegram Bot API ──── */
async function sendMessageViaTelegram(chatId, text, env, options = null) {
  try {
    console.log(`[DEBUG] sendMessageViaTelegram for user ${chatId}:`, text.substring(0, 50) + (text.length > 50 ? "..." : ""));
    
    const payload = { chat_id: chatId, text };
    
    if (options) {
      console.log(`[DEBUG] Message options type:`, typeof options);
      
      // Handle parse_mode option first (always check for it)
      if (options.parse_mode) {
        payload.parse_mode = options.parse_mode;
      }
      
      // If options already has a reply_markup
      if (options.reply_markup) {
        console.log(`[DEBUG] reply_markup found:`, JSON.stringify(options.reply_markup).substring(0, 200));
        payload.reply_markup = options.reply_markup;
      }
      // DEPRECATED: If options is directly a keyboard (for backward compatibility)
      else if (options.inline_keyboard) {
        console.log(`[DEBUG] Direct inline_keyboard found - DEPRECATED FORMAT:`, JSON.stringify(options).substring(0, 200));
        console.warn(`DEPRECATED: Passing inline_keyboard directly is deprecated. Use reply_markup.inline_keyboard instead.`);
        // Convert to correct format
        payload.reply_markup = { inline_keyboard: options.inline_keyboard };
      }
    }
    
    console.log(`[DEBUG] Final payload for Telegram API:`, JSON.stringify(payload).substring(0, 400));
    
    const response = await callTelegram('sendMessage', payload, env);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG] Telegram API error:`, errorText);
      throw new Error(`Telegram API error: ${errorText}`);
    }
    
    console.log(`[DEBUG] Message sent successfully to ${chatId}`);
    return response;
  } catch (error) {
    console.error(`[DEBUG] Error sending message to ${chatId}:`, error);
    throw error; // Re-throw to handle at the caller level
  }
}

/* ──── helper: add subscription button to message if user has no active subscription ──── */
async function sendMessageWithSubscriptionCheck(chatId, text, env, options = null) {
  try {
    console.log(`[DEBUG] sendMessageWithSubscriptionCheck for user ${chatId}, text: ${text.substring(0, 30)}...`);
    
    // Всегда проверяем активную подписку
    const isSubscribed = await hasActiveSubscription(chatId, env);
    console.log(`[DEBUG] User ${chatId} is subscribed: ${isSubscribed}`);
    
    // Сначала проверяем специальную ссылку на приложение Tribute
    let tributeAppLink = env.TRIBUTE_APP_LINK;
    
    // Если нет специальной ссылки, проверяем обычную ссылку на канал
    if (!tributeAppLink || tributeAppLink.trim() === '') {
      console.log(`[DEBUG] TRIBUTE_APP_LINK not found, checking TRIBUTE_CHANNEL_LINK`);
      tributeAppLink = env.TRIBUTE_CHANNEL_LINK;
    }
    
    // Если обе переменные отсутствуют, используем запасную ссылку
    if (!tributeAppLink || tributeAppLink.trim() === '') {
      console.warn(`[DEBUG] No Tribute links found in environment, using fallback link`);
      tributeAppLink = "https://t.me/tribute/app?startapp=svwW"; // Запасная ссылка на Tribute
    }
    
    // Проверяем, что ссылка имеет корректный формат и начинается с https:// или http://
    if (tributeAppLink && !tributeAppLink.match(/^https?:\/\//)) {
      console.warn(`[DEBUG] Tribute link doesn't start with http:// or https://, fixing: ${tributeAppLink}`);
      tributeAppLink = "https://" + tributeAppLink.replace(/^[\/\\]+/, '');
    }
    
    console.log(`[DEBUG] Using tribute link: ${tributeAppLink}`);
    
    // Если нет активной подписки и есть ссылка - добавляем кнопку
    if (!isSubscribed && tributeAppLink) {
      // Создаем безопасную копию опций или инициализируем, если их нет
      let messageOptions;
      
      try {
        if (options) {
          messageOptions = JSON.parse(JSON.stringify(options));
        } else {
          messageOptions = {};
        }
      } catch (error) {
        console.error(`[DEBUG] Error cloning options, creating new object:`, error);
        messageOptions = {};
        
        // Переносим базовые свойства вручную, если клонирование не удалось
        if (options) {
          if (options.parse_mode) messageOptions.parse_mode = options.parse_mode;
          
          // Безопасно скопировать reply_markup, если он есть
          if (options.reply_markup) {
            messageOptions.reply_markup = { inline_keyboard: [] };
            
            // Копируем существующую клавиатуру, если она есть
            if (options.reply_markup.inline_keyboard && Array.isArray(options.reply_markup.inline_keyboard)) {
              options.reply_markup.inline_keyboard.forEach(row => {
                if (Array.isArray(row)) {
                  const newRow = [];
                  row.forEach(button => {
                    newRow.push({...button});
                  });
                  messageOptions.reply_markup.inline_keyboard.push(newRow);
                }
              });
            }
          }
        }
      }
      
      console.log(`[DEBUG] Original message options:`, JSON.stringify(messageOptions));
      
      // Добавляем или объединяем reply_markup с кнопкой подписки
      if (!messageOptions.reply_markup) {
        // Нет кнопок - создаем новую клавиатуру
        messageOptions.reply_markup = {
          inline_keyboard: [[{ text: "Subscribe for €2/week", url: tributeAppLink }]]
        };
      } else {
        // Уже есть кнопки
        if (!messageOptions.reply_markup.inline_keyboard) {
          // Нет именно inline_keyboard, создаем ее
          messageOptions.reply_markup.inline_keyboard = [[{ text: "Subscribe for €2/week", url: tributeAppLink }]];
        } else {
          // Есть inline_keyboard, добавляем новую строку с кнопкой
          messageOptions.reply_markup.inline_keyboard.push([{ text: "Subscribe for €2/week", url: tributeAppLink }]);
        }
      }
      
      // Add test payment button ONLY in dev mode
      if (env.DEV_MODE === 'true') {
        if (!messageOptions.reply_markup.inline_keyboard) {
          messageOptions.reply_markup.inline_keyboard = [];
        }
        messageOptions.reply_markup.inline_keyboard.push([{ text: "🧪 TEST PAYMENT (Dev Only)", callback_data: "test:payment" }]);
        console.log(`[DEBUG] Added test payment button for dev mode`);
      }
      
      console.log(`[DEBUG] Final message options with subscription button:`, JSON.stringify(messageOptions));
      return await sendMessageViaTelegram(chatId, text, env, messageOptions);
    }
    
    // Пользователь подписан или нет ссылки на канал - отправляем обычное сообщение
    console.log(`[DEBUG] Sending regular message without subscription button`);
    return await sendMessageViaTelegram(chatId, text, env, options);
  } catch (error) {
    console.error(`Error in sendMessageWithSubscriptionCheck for user ${chatId}:`, error);
    // Обработка ошибок и возврат к обычной отправке сообщения
    return await sendMessageViaTelegram(chatId, text, env, options);
  }
}

/* ──── helper: call any Telegram API method ──── */
async function callTelegram(method, payload, env) {
  try {
    console.log(`[DEBUG] Calling Telegram API ${method} with payload:`, JSON.stringify(payload).substring(0, 300));
    
    if (!env.BOT_TOKEN) {
      console.error(`[DEBUG] Missing BOT_TOKEN in environment`);
      throw new Error("Missing BOT_TOKEN");
    }
    
    const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
    console.log(`[DEBUG] API URL:`, apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log(`[DEBUG] Telegram API ${method} response status:`, response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG] Telegram API ${method} error:`, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        console.error(`[DEBUG] Telegram API error details:`, JSON.stringify(errorJson));
      } catch (e) {
        // Ignore if not JSON
      }
    } else {
      console.log(`[DEBUG] Telegram API ${method} call successful`);
    }
    
    return response;
  } catch (error) {
    console.error(`[DEBUG] Error calling Telegram API ${method}:`, error);
    throw error;
  }
}

/* ──── helper: proxy payload to another Worker ──── */
function forward(service, payload) {
  // Добавляем подробное логирование
  console.log(`🔄 [FORWARD] Attempting to forward request to service:`, service ? 'Service exists' : 'Service is undefined');
  console.log(`🔄 [FORWARD] Service type:`, typeof service);
  console.log(`🔄 [FORWARD] Payload:`, JSON.stringify(payload).substring(0, 300));
  
  if (!service) {
    console.error(`❌ [FORWARD] Service binding is undefined`);
    throw new Error('Service binding is undefined');
  }
  
  if (typeof service.fetch !== 'function') {
    console.error(`❌ [FORWARD] Service doesn't have fetch method, available methods:`, Object.keys(service));
    throw new Error('Service does not have a fetch method');
  }
  
  try {
    console.log(`🚀 [FORWARD] Calling service.fetch...`);
    const result = service.fetch('https://internal/', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify(payload)
    });
    console.log(`✅ [FORWARD] service.fetch call successful`);
    return result;
  } catch (error) {
    console.error(`❌ [FORWARD] Error forwarding request:`, error);
    console.error(`❌ [FORWARD] Error stack:`, error.stack);
    throw error;
  }
}

/* ──── helper: check if user has completed test ──── */
async function hasCompletedTest(chatId, env) {
  const { results } = await env.USER_DB
    .prepare('SELECT eng_level FROM user_profiles WHERE telegram_id = ?')
    .bind(parseInt(chatId, 10))
    .all();
  
  return results[0]?.eng_level ? true : false;
}

/* ──── helper: handle lesson command ──── */
async function handleLessonCommand(chatId, env) {
  try {
    console.log(`handleLessonCommand started for user ${chatId}`);
    
    // Get user profile with all necessary fields
    console.log(`Querying database for user ${chatId}`);
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    console.log(`Database query results for user ${chatId}:`, results.length ? "Found" : "Not found");
    
    if (!results.length) {
      console.log(`User ${chatId} not found, sending test message`);
      await sendMessageWithSubscriptionCheck(chatId, 
        'You need to take the placement test first. Use /start to begin.', env);
      return;
    }
    
    const profile = results[0];
    console.log(`User ${chatId} profile:`, {
      eng_level: profile.eng_level,
      pass_lesson0_at: !!profile.pass_lesson0_at,
      subscription_expired_at: profile.subscription_expired_at,
      next_lesson_access_at: profile.next_lesson_access_at
    });
    
    // Basic profile info
    const testedAt = profile.tested_at ? new Date(profile.tested_at).toLocaleDateString() : 'N/A';
    const lessonsTotal = profile.number_of_lessons || 0;
    const lessonsStreak = profile.lessons_in_row || 0;
    
    // Check subscription status (simple version)
    const now = new Date();
    const hasActiveSubscription = profile.subscription_expired_at && 
                                (new Date(profile.subscription_expired_at) > now);
    const subscriptionStatus = hasActiveSubscription ? 'Active' : 'Inactive - Subscribe to continue learning';
    
    let message = `📊 *Your Language Profile*\n\n` +
      `🎯 *Level:* ${profile.eng_level}\n` +
      `💳 *Subscription:* ${subscriptionStatus}\n` +
      `📚 *Total lessons:* ${lessonsTotal}\n` +
      `🔥 *Current streak:* ${lessonsStreak} days\n\n`;
    
    // Check pass_lesson0_at first
    if (!profile.pass_lesson0_at) {
      console.log(`User ${chatId} hasn't taken free lesson, checking if test completed first`);
      
      // КРИТИЧЕСКАЯ ПРОВЕРКА: Пользователь должен сначала пройти placement test  
      if (!profile.eng_level) {
        console.log(`User ${chatId} hasn't completed placement test, directing to test`);
        message += 'You need to complete the placement test first to determine your English level.';
        await sendMessageWithSubscriptionCheck(chatId, message, env, { parse_mode: 'Markdown' });
        return;
      }
      
      // Free lesson not taken yet - show button
      console.log(`User ${chatId} has completed test, showing free lesson button`);
      message += 'You haven\'t taken your free introductory lesson yet.';
      await sendMessageWithSubscriptionCheck(chatId, message, env, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: 'Free audio lesson', callback_data: 'lesson:free' }]]
        }
      });
      return;
    }
    
    // Check subscription status
    const subExpiredAt = profile.subscription_expired_at ? new Date(profile.subscription_expired_at) : null;
    
    if (!subExpiredAt || subExpiredAt.getTime() < now.getTime()) {
      console.log(`User ${chatId} subscription expired or not present, showing subscribe button`);
      // No active subscription or it's expired - show subscribe button to Tribute channel
      message += 'Your subscription has expired or you haven\'t subscribed yet.';
      await sendMessageWithSubscriptionCheck(chatId, message, env, { parse_mode: 'Markdown' });
      return;
    }
    
    // Active subscription - show next lesson access time
    const nextLessonAt = profile.next_lesson_access_at ? new Date(profile.next_lesson_access_at) : null;
    
    if (nextLessonAt && nextLessonAt.getTime() > now.getTime()) {
      console.log(`User ${chatId} lesson not yet available, showing wait message`);
      // Format the time until next lesson
      const timeUntil = formatTimeUntil(nextLessonAt);
      message += `Your next lesson will be available in *${timeUntil}*.`;
      await sendMessageWithSubscriptionCheck(chatId, message, env, { parse_mode: 'Markdown' });
      return;
    }
    
    console.log(`User ${chatId} lesson available now, showing start lesson button`);
    // Lesson is available now
    message += '*Your next lesson is available now!*';
    await sendMessageWithSubscriptionCheck(chatId, message, env, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Start lesson', callback_data: 'lesson:start' }]]
      }
    });
    
    console.log(`handleLessonCommand completed successfully for user ${chatId}`);
  } catch (error) {
    console.error(`Error in handleLessonCommand for user ${chatId}:`, error);
    // Try to send a fallback message
    try {
      await sendMessageWithSubscriptionCheck(chatId, 
        "Sorry, there was an error processing your command. Please try again later or contact support.", 
        env);
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }
  }
}

/* ──── helper: format time until date in human-readable form ──── */
function formatTimeUntil(date) {
  const now    = Date.now();
  const diffMs = date.getTime() - now;
  if (diffMs <= 0) return 'now';

  const diffSec  = Math.floor(diffMs / 1000);
  const diffMin  = Math.floor(diffSec / 60);
  const diffHr   = Math.floor(diffMin / 60);
  const remMin   = diffMin % 60;

  if (diffHr > 0) {
    if (remMin > 0) {
      return `${diffHr}h ${remMin}m`;
    }
    return `${diffHr}h`;
  }
  // less than 1 hour
  if (diffMin > 0) return `${diffMin}m`;
  return `${diffSec}s`;
}

/* ──── helper: check if user has active subscription ──── */
async function hasActiveSubscription(chatId, env) {
  try {
    console.log(`[DEBUG] Checking subscription status for user ${chatId}`);
    
    const { results } = await env.USER_DB
      .prepare('SELECT subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    console.log(`[DEBUG] Database query results for subscription check:`, JSON.stringify(results));
    
    if (results.length === 0) {
      console.log(`[DEBUG] User ${chatId} not found in database, subscription status: false`);
      return false;
    }
    
    const now = new Date();
    const subExpiredAt = results[0].subscription_expired_at ? new Date(results[0].subscription_expired_at) : null;
    
    const isActive = subExpiredAt && subExpiredAt > now;
    console.log(`[DEBUG] User ${chatId} subscription status: ${isActive}, expiry date: ${subExpiredAt ? subExpiredAt.toISOString() : 'none'}`);
    
    return isActive;
  } catch (error) {
    console.error(`Error checking subscription status for user ${chatId}:`, error);
    return false; // If we can't verify, assume no subscription
  }
}
