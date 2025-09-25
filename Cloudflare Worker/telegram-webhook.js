// telegram-webhook/worker.js with Tribute.tg integration
// Receives every Telegram update on /tg and handles onboarding and lesson routing
// Force redeploy: fixing CI/CD env webhook issue
// CI/CD workflow fixed with new GitHub token - 2025-09-25

// Import funnel logging helper
// const { safeLogBeginnerFunnelStep } = require('./funnel-logger.js'); // Commented out - file doesn't exist

export default {
  async fetch(request, env, ctx) {
    // Просто логируем все доступные ключи в env для диагностики
    console.log(`[DEBUG] All available env keys:`, Object.keys(env || {}).join(', '));
    
    // Логируем DEV_MODE для диагностики
    console.log(`[DEBUG] DEV_MODE value:`, env.DEV_MODE, `(type: ${typeof env.DEV_MODE})`);
    
    // Удаляем глобальную переменную и просто логируем сервисы
    console.log(`[DEBUG] Available services in env:`, 
                Object.keys(env || {})
                .filter(key => ['NEWBIES_FUNNEL', 'LESSON0', 'MAIN_LESSON'].includes(key))
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
        console.log(`📥 WEBHOOK RECEIVED: ${JSON.stringify(update).substring(0, 200)}...`);
      } catch (e) { 
        console.error("JSON parse error:", e);
        return new Response('Bad request', { status: 200 }); // Return 200 to Telegram even for bad requests
      }

      const chatId = update.message?.chat?.id
                  || update.callback_query?.message?.chat?.id;
      
      console.log(`👤 Processing update for chatId: ${chatId}`);
      console.log(`📝 Update type:`, {
        hasMessage: !!update.message,
        hasCallbackQuery: !!update.callback_query,
        messageText: update.message?.text,
        callbackData: update.callback_query?.data
      });
      
      if (!chatId) {
        console.log(`❌ No chatId found, ignoring update`);
        return new Response('OK');
      }

      // Handle /help command, unknown commands, and regular text messages
const supportedCommands = ['/start', '/profile', '/lesson', '/talk', '/help', '/feedback', '/mode'];

// Handle /feedback command
if (update.message?.text === '/feedback') {
  try {
    console.log(`💬 [${chatId}] Processing /feedback command`);
    
    // Получаем язык интерфейса пользователя
    let userLang = 'ru';
    try {
      const profileResponse = await callLambdaFunction('onboarding', {
        user_id: chatId,
        action: 'get_profile'
      }, env);
      
      if (profileResponse && profileResponse.success) {
        userLang = profileResponse.user_data.interface_language || 'ru';
      }
      } catch (error) {
      console.error(`⚠️ [${chatId}] Could not get user language for /feedback:`, error);
    }
    
    // Устанавливаем состояние ожидания фидбэка
    await env.USER_MODES.put(`feedback_waiting:${chatId}`, 'true', { expirationTtl: 3600 }); // 1 час
    
    const feedbackMessage = userLang === 'en' 
      ? "💬 **Leave your feedback in the next message. For your FIRST feedback, we give free lessons 🎁**\n\nShare your thoughts, suggestions, or experience with LinguaPulse:"
      : "💬 **Оставьте свой отзыв в ответном сообщении. За *ПЕРВЫЙ* фидбэк мы дарим бесплатные уроки 🎁**\n\nПоделитесь своими мыслями, предложениями или опытом использования LinguaPulse:";
    
    await sendMessageViaTelegram(chatId, feedbackMessage, env, {
      parse_mode: 'Markdown'
    });
    
  } catch (error) {
    console.error(`❌ [${chatId}] Error in /feedback command:`, error);
    const errorText = "❌ Произошла ошибка. Попробуйте еще раз.";
    await sendMessageViaTelegram(chatId, errorText, env);
    }
    
    return new Response('OK');
}

// ВРЕМЕННО УДАЛЕНО - старая логика обработки /help команд
// (удалено, чтобы не нарушать try-catch структуру)

      // Handle /talk command - route to main-lesson
      if (update.message?.text === '/talk') {
        console.log(`🎯 [${chatId}] /talk command received`);
        
        // Helper functions for /talk localization
        async function getUserLanguageForTalk() {
          try {
            const { results } = await env.USER_DB
              .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            return results.length > 0 ? results[0].interface_language : 'en';
          } catch (error) {
            console.error('Error getting user language for /talk:', error);
            return 'en';
          }
        }
        
        const talkTexts = {
          en: {
            needOnboarding: "📝 *You need to complete the onboarding first.* Use /start to begin.",
            serviceUnavailable: "❌ *Sorry, the lesson service is temporarily unavailable.* Please try again later.",
            errorStarting: "❌ *Sorry, there was an error starting your lesson.* Please try again."
          },
          ru: {
            needOnboarding: "📝 *Сначала нужно пройти регистрацию.* Используйте /start для начала.",
            serviceUnavailable: "❌ *Извините, сервис уроков временно недоступен.* Попробуйте позже.",
            errorStarting: "❌ *Извините, произошла ошибка при запуске урока.* Попробуйте еще раз."
          }
        };
        
        function getTalkText(lang, key) {
          return talkTexts[lang]?.[key] || talkTexts.en[key] || key;
        }
        
        console.log(`🔍 [${chatId}] Checking MAIN_LESSON worker availability...`);
        console.log(`🔍 [${chatId}] env.MAIN_LESSON exists:`, !!env.MAIN_LESSON);
        console.log(`🔍 [${chatId}] env.MAIN_LESSON type:`, typeof env.MAIN_LESSON);
        
        // Check if the MAIN_LESSON worker is available
        if (!env.MAIN_LESSON) {
          console.error(`❌ [${chatId}] MAIN_LESSON worker is undefined, cannot forward /talk command`);
          console.error(`❌ [${chatId}] Available env services:`, Object.keys(env).filter(key => key.includes('LESSON') || key.includes('TEST')));
          
          // Check if user has completed the survey
          const { results: surveyCheck } = await env.USER_DB
            .prepare('SELECT completed_at FROM user_survey WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          if (surveyCheck.length > 0 && surveyCheck[0].completed_at) {
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
              const userLang = await getUserLanguageForTalk();
              await sendMessageViaTelegram(chatId, 
                getTalkText(userLang, 'serviceUnavailable'), env, { parse_mode: 'Markdown' });
            } else {
                        // If they don't have an active subscription, show subscription option
              await sendTributeChannelLink(chatId, env);
            }
          } else {
                      // If they haven't completed the survey
            const userLang = await getUserLanguageForTalk();
            await sendMessageViaTelegram(chatId, 
              getTalkText(userLang, 'needOnboarding'), env, { parse_mode: 'Markdown' });
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
          const userLang = await getUserLanguageForTalk();
          await sendMessageViaTelegram(chatId, 
            getTalkText(userLang, 'errorStarting'), env, { parse_mode: 'Markdown' });
          return new Response('OK');
        }
      }

      // Handle /profile command - show user-friendly profile data
      if (update.message?.text === '/profile') {
        try {
          console.log(`🔍 [${chatId}] Getting profile data from Lambda`);
          
          // Получаем данные профиля через Lambda
          const profileResponse = await callLambdaFunction('onboarding', {
            user_id: chatId,
            action: 'get_profile'
          }, env);
          
          if (!profileResponse || !profileResponse.success) {
            const errorText = "❌ Профиль не найден. Пожалуйста, начните с команды /start";
            await sendMessageViaTelegram(chatId, errorText, env);
            return new Response('OK');
          }
          
          const userData = profileResponse.user_data;
          const hasAudioAccess = profileResponse.has_audio_access;
          const hasTextAccess = profileResponse.has_text_access;
          const accessDate = profileResponse.access_date;
          
          // Определяем язык интерфейса
          const userLang = userData.interface_language || 'ru';
          
          // Локализованные тексты
        const texts = userLang === 'ru' ? {
            profileTitle: '👤 *Ваш профиль*',
            username: '📝 *Имя:*',
          level: '🎯 *Уровень:*',
            lessonsLeft: '📚 *Аудио-уроков осталось:*',
            accessUntil: '⏰ *Доступ до:*',
            totalLessons: '🎓 *Всего аудио-уроков пройдено:*',
          currentStreak: '🔥 *Текущая серия:*',
          days: 'дней',
            startAudioLesson: '🎤 Начать аудио-урок',
            buyAudioLessons: '💰 Купить аудио-уроки',
            startTextDialog: '💬 Начать текстовый диалог',
            buyPremium: '⭐ Купить премиум',
            chooseAIMode: '🤖 Выбрать режим ИИ',
            comingSoon: 'Функционал скоро будет доступен! Всем желающим будет предоставлен бесплатный триал.',
            noAccess: 'Нет доступа'
          } : {
            profileTitle: '👤 *Your Profile*',
            username: '📝 *Name:*',
          level: '🎯 *Level:*',
            lessonsLeft: '📚 *Audio lessons left:*',
            accessUntil: '⏰ *Access until:*',
            totalLessons: '🎓 *Total audio lessons completed:*',
          currentStreak: '🔥 *Current streak:*',
          days: 'days',
            startAudioLesson: '🎤 Start Audio Lesson',
            buyAudioLessons: '💰 Buy Audio Lessons',
            startTextDialog: '💬 Start Text Dialog',
            buyPremium: '⭐ Buy Premium',
            chooseAIMode: '🤖 Choose AI Mode',
            comingSoon: 'This feature will be available soon! Everyone interested will get a free trial.',
            noAccess: 'No access'
          };
          
          // Формируем сообщение профиля
          const username = userData.username || `User ${chatId}`;
          const currentLevel = userData.current_level || 'Intermediate';
          const lessonsLeft = userData.lessons_left || 0;
          const totalLessonsCompleted = userData.total_lessons_completed || 0;
          const currentStreak = userData.current_streak || 0;
          
          // Форматируем дату доступа
          let accessDateText = texts.noAccess;
          if (accessDate) {
            // Lambda уже возвращает дату в правильном формате (DD.MM.YYYY)
            accessDateText = accessDate;
          }
        
        let message = `${texts.profileTitle}\n\n` +
            `${texts.username} ${username}\n` +
            `${texts.level} ${currentLevel}\n` +
            `${texts.lessonsLeft} ${lessonsLeft}\n` +
            `${texts.accessUntil} ${accessDateText}\n` +
            `${texts.totalLessons} ${totalLessonsCompleted}\n` +
            `${texts.currentStreak} ${currentStreak} ${texts.days}\n`;
          
          // Создаем кнопки в зависимости от доступа
          const buttons = [];
          
          // Кнопка 1: Аудио-урок или покупка аудио-уроков
          if (hasAudioAccess && lessonsLeft > 0) {
            buttons.push([{ text: texts.startAudioLesson, callback_data: "profile:start_audio" }]);
        } else {
            buttons.push([{ text: texts.buyAudioLessons, callback_data: "profile:buy_audio" }]);
          }
          
          // Кнопка 2: Текстовый диалог или покупка премиума
          if (hasTextAccess) {
            buttons.push([{ text: texts.startTextDialog, callback_data: "ai_mode:text_dialog" }]);
          } else {
            buttons.push([{ text: texts.buyPremium, callback_data: "profile:buy_premium" }]);
          }
          
          // Кнопка 3: Выбор режима ИИ
          buttons.push([{ text: texts.chooseAIMode, callback_data: "text_helper:start" }]);
          
          await sendMessageViaTelegram(chatId, message, env, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: buttons }
          });
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error in /profile command:`, error);
          const errorText = "❌ Произошла ошибка при получении профиля. Попробуйте позже.";
          await sendMessageViaTelegram(chatId, errorText, env);
        }
        
        return new Response('OK');
      }

      // Handle /mode command - show AI mode selection
      if (update.message?.text === '/mode') {
        try {
          console.log(`🤖 [${chatId}] Processing /mode command`);
          
          // Получаем язык интерфейса пользователя
          let userLang = 'ru';
          try {
            const profileResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'get_profile'
            }, env);
            
            if (profileResponse && profileResponse.success) {
              userLang = profileResponse.user_data.interface_language || 'ru';
            }
          } catch (error) {
            console.error(`⚠️ [${chatId}] Could not get user language for /mode:`, error);
            // Продолжаем с русским по умолчанию
          }
          
          // Создаем кнопки выбора режима
          const modeButtons = userLang === 'en' 
            ? [
                [{ text: "📝 Text Translation", callback_data: "ai_mode:translation" }],
                [{ text: "📚 Grammar", callback_data: "ai_mode:grammar" }],
                [{ text: "💬 Text Dialog", callback_data: "ai_mode:text_dialog" }],
                [{ text: "🎤 Audio Dialog", callback_data: "ai_mode:audio_dialog" }]
              ]
            : [
                [{ text: "📝 Перевод текста", callback_data: "ai_mode:translation" }],
                [{ text: "📚 Грамматика", callback_data: "ai_mode:grammar" }],
                [{ text: "💬 Текстовый диалог", callback_data: "ai_mode:text_dialog" }],
                [{ text: "🎤 Аудио-диалог", callback_data: "ai_mode:audio_dialog" }]
              ];
          
          const modeMessage = userLang === 'en' 
            ? "🤖 **Choose AI Mode:**\n\nSelect the mode that best fits your learning needs:"
            : "🤖 **Выберите режим ИИ:**\n\nВыберите режим, который лучше всего подходит для ваших целей обучения:";
          
          await sendMessageViaTelegram(chatId, modeMessage, env, {
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: modeButtons }
          });
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error in /mode command:`, error);
          const errorText = "❌ Произошла ошибка. Попробуйте еще раз.";
          await sendMessageViaTelegram(chatId, errorText, env);
        }
        
        return new Response('OK');
      }

      // Handle /lesson command - same as /start for users who completed onboarding
      if (update.message?.text === '/lesson') {
        try {
          console.log(`Calling handleLessonCommand for user ${chatId}`);
          await handleLessonCommand(chatId, env);
        } catch (error) {
          console.error(`Error handling /lesson command for user ${chatId}:`, error);
          // Fallback response in case of error
          try {
            await sendMessageViaTelegram(chatId, 
              "Sorry, there was an error processing your command. Please try again later or contact support.", 
              env);
          } catch (sendError) {
            console.error("Failed to send error message:", sendError);
          }
        }
        return new Response('OK');
      }
      
      // Handle /start command to check for welcome parameter
      if (update.message?.text?.startsWith('/start')) {
        console.log(`🚀 [${chatId}] Processing /start command`);
        
        try {
          // 1. Проверяем существование пользователя в Supabase через Lambda
          console.log(`📤 [${chatId}] Checking if user exists in Supabase`);
          const checkResponse = await callLambdaFunction('onboarding', {
            user_id: chatId,
            action: 'check_user'
          }, env);
          
          const checkBody = checkResponse;
          console.log(`✅ [${chatId}] User check response:`, checkBody);
          
          if (checkBody.success && checkBody.user_exists) {
            // Пользователь существует - показываем приветствие
            console.log(`✅ [${chatId}] User exists, showing welcome message`);
            
            // Получаем информацию о пользователе из ответа Lambda
            const userData = checkBody.user_data;
            const welcomeMessage = userData.interface_language === 'ru' 
              ? `👋 Добро пожаловать обратно, ${userData.username}! Ваш профиль уже настроен. Используйте /lesson для доступа к урокам.`
              : `👋 Welcome back, ${userData.username}! Your profile is already set up. Use /lesson to access your lessons.`;
            
            await sendMessageViaTelegram(chatId, welcomeMessage, env);
            return new Response('OK');
          } else {
            // Пользователь не существует - показываем выбор языка
            console.log(`🆕 [${chatId}] New user, showing language selection`);
                  await sendMessageViaTelegram(chatId,
              "👋 Добро пожаловать в LinguaPulse! Давайте настроим ваш профиль.\n\nВыберите язык интерфейса:", 
              env,
              {
                reply_markup: {
                  inline_keyboard: [
                    [
                      { text: "🇷🇺 Русский", callback_data: "language:ru" },
                      { text: "🇺🇸 English", callback_data: "language:en" }
                    ]
                  ]
                }
              }
            );
                  return new Response('OK');
          }
        } catch (lambdaError) {
          console.error(`❌ [${chatId}] Lambda check failed:`, lambdaError);
          // Fallback - показываем выбор языка
              await sendMessageViaTelegram(chatId, 
            "👋 Добро пожаловать в LinguaPulse! Давайте настроим ваш профиль.\n\nВыберите язык интерфейса:", 
            env,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: "🇷🇺 Русский", callback_data: "language:ru" },
                    { text: "🇺🇸 English", callback_data: "language:en" }
                  ]
                ]
              }
            }
          );
          return new Response('OK');
        }
        
      }

      // Handle voice messages with improved routing
      if (update.message?.voice) {
        try {
          console.log(`=== VOICE MESSAGE HANDLING START ===`);
          console.log(`Received voice message from chat ${chatId}, message ID: ${update.message.message_id}`);
          
          // Check for duplicate message processing
          const messageId = update.message.message_id;
          const processingKey = `processing_msg:${chatId}:${messageId}`;
          
          if (env.USER_MODES) {
            const alreadyProcessed = await env.USER_MODES.get(processingKey);
            if (alreadyProcessed) {
              console.log(`❌ Message ${messageId} already processed, skipping duplicate`);
              return new Response('OK - duplicate message skipped');
            }
            
            // Mark message as being processed (expire in 5 minutes)
            await env.USER_MODES.put(processingKey, Date.now().toString(), { expirationTtl: 300 });
            console.log(`✅ Message ${messageId} marked as processing`);
          }
          
          console.log(`Available services:`, Object.keys(env).filter(key => ['NEWBIES_FUNNEL', 'LESSON0', 'MAIN_LESSON'].includes(key)));
          
          // FIRST: Check for active lesson sessions
          console.log(`=== CHECKING ACTIVE SESSIONS ===`);
          
          // FIRST: Check for audio_dialog mode (NEW AUDIO SYSTEM)
          const currentMode = await env.CHAT_KV.get(`ai_mode:${chatId}`);
          console.log(`Current AI mode for user ${chatId}: ${currentMode}`);
          
          if (currentMode === 'audio_dialog') {
              console.log(`🎤 [${chatId}] Processing voice message in audio_dialog mode`);
              
              // Process voice message in audio_dialog mode
              try {
                // 1. Download and transcribe voice message
                const voiceFileId = update.message.voice.file_id;
                console.log(`🎤 [${chatId}] Transcribing voice message: ${voiceFileId}`);
                
                // Get file URL from Telegram
                const fileResponse = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${voiceFileId}`);
                const fileData = await fileResponse.json();
                
                if (!fileData.ok) {
                  throw new Error(`Failed to get file info: ${fileData.description}`);
                }
                
                const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${fileData.result.file_path}`;
                
                // Download voice file
                const voiceResponse = await fetch(fileUrl);
                const voiceBuffer = await voiceResponse.arrayBuffer();
                
                // Transcribe with OpenAI Whisper
                const transcriptionResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${env.OPENAI_KEY}`,
                  },
                  body: (() => {
                    const formData = new FormData();
                    formData.append('file', new File([voiceBuffer], 'voice.ogg', { type: 'audio/ogg' }));
                    formData.append('model', 'whisper-1');
                    formData.append('language', 'en');
                    return formData;
                  })()
                });
                
                const transcriptionData = await transcriptionResponse.json();
                
                if (!transcriptionResponse.ok) {
                  throw new Error(`Transcription failed: ${transcriptionData.error?.message || 'Unknown error'}`);
                }
                
                const userText = transcriptionData.text;
                console.log(`🎤 [${chatId}] Transcribed text: "${userText}"`);
                
                // Check if user wants to end dialog (exact phrases only)
                const userTextLower = userText.toLowerCase().trim();
                const endPhrases = [
                  'end dialog', 'end lesson', 'stop dialog', 'stop lesson',
                  'завершить диалог', 'завершить урок', 'стоп диалог', 'стоп урок',
                  'конец диалога', 'конец урока', 'хватит диалога', 'хватит урока'
                ];
                const userWantsToEnd = endPhrases.some(phrase => userTextLower.includes(phrase));
                
                // Check AUDIO message count limit (15 AUDIO messages from bot max)
                const audioCountKey = `audio_dialog_audio_count:${chatId}`;
                let audioMessageCount = parseInt(await env.CHAT_KV.get(audioCountKey) || '0');
                console.log(`🔢 [${chatId}] Current AUDIO message count: ${audioMessageCount}/15`);
                
                // Increment AUDIO message count FIRST (only for actual audio responses)
                audioMessageCount++;
                await env.CHAT_KV.put(audioCountKey, audioMessageCount.toString());
                console.log(`📈 [${chatId}] Incremented AUDIO message count to: ${audioMessageCount}/15`);
                
                // ANTI-ABUSE: Mark lesson as used after 5 AUDIO bot messages (but continue dialog)
                const lessonUsedKey = `audio_lesson_used:${chatId}`;
                const lessonAlreadyUsed = await env.CHAT_KV.get(lessonUsedKey);
                
                if (audioMessageCount >= 5 && !lessonAlreadyUsed) {
                  console.log(`🛡️ [${chatId}] ANTI-ABUSE: 5+ AUDIO messages reached, marking lesson as USED (dialog continues)`);
                  
                  // Mark lesson as used to prevent multiple decreases
                  await env.CHAT_KV.put(lessonUsedKey, 'true');
                  
                  // Decrease lessons_left immediately (anti-abuse) - but dialog continues!
                  try {
                    console.log(`📉 [${chatId}] ANTI-ABUSE: Decreasing lessons_left by 1 (5+ AUDIO messages used, dialog continues)`);
                    await callLambdaFunction('onboarding', {
              user_id: chatId,
                      action: 'decrease_lessons_left'
                    }, env);
                  } catch (error) {
                    console.error(`❌ [${chatId}] Error decreasing lessons_left (anti-abuse):`, error);
                  }
                }
                
                // Dialog ends ONLY at 15 AUDIO messages OR user request
                if (audioMessageCount >= 15 || userWantsToEnd) {
                  // End dialog and provide final feedback
                  const endReason = userWantsToEnd ? 'user request' : '15 message limit';
                  console.log(`🏁 [${chatId}] Audio dialog ending (${endReason}), completing lesson`);
                  
                  // Clear session data
                  await env.CHAT_KV.delete(audioCountKey);
                  await env.CHAT_KV.delete(`ai_mode:${chatId}`);
                  
                  // Send farewell message
                  const farewellText = "That's all for today's audio lesson! You did great. Let's continue our practice tomorrow. Have a wonderful day!";
                  await safeSendTTS(chatId, farewellText, env);
                  
                  // DECREASE lessons_left by 1 (lesson completed) - ONLY if not already decreased by anti-abuse
                  const lessonUsedKey = `audio_lesson_used:${chatId}`;
                  const lessonAlreadyUsed = await env.CHAT_KV.get(lessonUsedKey);
                  
                  if (!lessonAlreadyUsed) {
                    try {
                      console.log(`📉 [${chatId}] Decreasing lessons_left by 1 (audio lesson completed, not yet used)`);
                      await callLambdaFunction('onboarding', {
                user_id: chatId,
                        action: 'decrease_lessons_left'
                      }, env);
                    } catch (error) {
                      console.error(`❌ [${chatId}] Error decreasing lessons_left:`, error);
                    }
                  } else {
                    console.log(`✅ [${chatId}] Lesson already marked as used by anti-abuse, skipping decrease`);
                  }
                  
                  // Clean up lesson used flag
                  await env.CHAT_KV.delete(lessonUsedKey);
                  
                  // Generate final feedback via Lambda (AUDIO dialog)
                  try {
                    const feedbackResponse = await callLambdaFunction('onboarding', {
                      user_id: chatId,
                      action: 'generate_dialog_feedback',
                      mode: 'audio_dialog',
                      user_lang: 'ru'  // TODO: get from user profile
                    }, env);
                    
                    if (feedbackResponse?.success && feedbackResponse.feedback) {
                      await sendMessageViaTelegram(chatId, feedbackResponse.feedback, env);
                    }
                  } catch (error) {
                    console.error(`❌ [${chatId}] Error generating final feedback:`, error);
                  }
                  
                  // Update streak for audio lesson completion
                  try {
                    await callLambdaFunction('onboarding', {
                      user_id: chatId,
                      action: 'update_audio_lesson_streak'
                    }, env);
                  } catch (error) {
                    console.error(`❌ [${chatId}] Error updating audio lesson streak:`, error);
                  }
                  
                  // Show mode selection buttons
                  await sendMessageViaTelegram(chatId, 'Выберите режим ИИ:', env, {
                    reply_markup: {
                      inline_keyboard: [[
                        { text: '🔤 Перевод', callback_data: 'ai_mode:translation' },
                        { text: '📝 Грамматика', callback_data: 'ai_mode:grammar' }
                      ], [
                        { text: '💬 Текстовый диалог', callback_data: 'ai_mode:text_dialog' },
                        { text: '🎤 Аудио-диалог', callback_data: 'ai_mode:audio_dialog' }
                      ]]
                    }
                  });
                  
                  return new Response('OK');
                }
                
                // 2. Get AI response via direct OpenAI API (like main-lesson.js - NO FEEDBACK)
                const aiText = await generateSimpleConversationResponse(userText, chatId, env);
                console.log(`🤖 [${chatId}] AI response: "${aiText}"`);
                  
                // 3. Convert AI response to voice and send
                const success = await safeSendTTS(chatId, aiText, env);
                
                if (!success) {
                  // Fallback to text if TTS fails
                  await sendMessageViaTelegram(chatId, `❌ Ошибка аудио-системы. Текстовый ответ:\n\n${aiText}`, env);
                }
                
                console.log(`✅ [${chatId}] Audio dialog voice message processed successfully`);
                return new Response('OK');
                
              } catch (error) {
                console.error(`❌ [${chatId}] Error processing audio dialog voice message:`, error);
                await sendMessageViaTelegram(chatId, '❌ Произошла ошибка при обработке голосового сообщения. Попробуйте еще раз.', env);
                return new Response('OK');
              }
          }
          
          if (env.USER_MODES) {
            // Check lesson0 session (LEGACY)
            const lesson0Session = await env.USER_MODES.get(`session:${chatId}`);
            const lesson0History = await env.USER_MODES.get(`hist:${chatId}`);
            
            console.log(`Lesson0 session exists: ${!!lesson0Session}`);
            console.log(`Lesson0 history exists: ${!!lesson0History}`);
            
            if (lesson0Session || lesson0History) {
              console.log(`✅ Active lesson0 session found, forwarding voice message to LESSON0`);
              return forward(env.LESSON0, update);
            }
            
            // Check main_lesson session (LEGACY)
            const mainLessonSession = await env.USER_MODES.get(`main_session:${chatId}`);
            const mainLessonHistory = await env.USER_MODES.get(`main_hist:${chatId}`);
            
            console.log(`Main lesson session exists: ${!!mainLessonSession}`);
            console.log(`Main lesson history exists: ${!!mainLessonHistory}`);
            
            if (mainLessonSession || mainLessonHistory) {
              console.log(`✅ Active main lesson session found, forwarding voice message to MAIN_LESSON`);
              return forward(env.MAIN_LESSON, update);
            }
          }
          
          console.log(`❌ No active lesson sessions found`);
          
          // If no active session, check user status in database
          console.log(`=== CHECKING USER STATUS IN DATABASE ===`);
          try {
            const { results } = await env.USER_DB
              .prepare('SELECT pass_lesson0_at, subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            
            if (results.length > 0) {
              console.log(`User found in database, pass_lesson0_at: ${!!results[0].pass_lesson0_at}`);
              
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
                console.log(`User hasn't taken free lesson yet, suggesting free lesson`);
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
                "Please start by completing our quick setup. Type /start to begin.",
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

      // Handle regular text messages - OpenAI integration for text helper

      if (update.message?.text && !update.message.text.startsWith('/')) {
        console.log(`💬 TEXT MESSAGE: "${update.message.text}" from user ${chatId}`);
        
        try {
          // FIRST: Check for audio_dialog mode (NEW AUDIO SYSTEM)
          let currentMode = await env.CHAT_KV.get(`ai_mode:${chatId}`);
          console.log(`Current AI mode for user ${chatId}: ${currentMode}`);
          
          if (currentMode === 'audio_dialog') {
            console.log(`🎤 [${chatId}] Processing text message in audio_dialog mode`);
            
            // Process text message in audio_dialog mode
            try {
              // Get AI response via Lambda
              const aiResponse = await callLambdaFunction('onboarding', {
                user_id: chatId,
                action: 'process_text_message',
                message: update.message.text,
                mode: 'audio_dialog'
              }, env);
              
              if (aiResponse?.success && aiResponse.reply) {
                const aiText = aiResponse.reply;
                console.log(`🤖 [${chatId}] AI response: "${aiText}"`);
                
                // Convert AI response to voice and send
                const success = await safeSendTTS(chatId, aiText, env);
                
                if (!success) {
                  // Fallback to text if TTS fails
                  await sendMessageViaTelegram(chatId, `❌ Ошибка аудио-системы. Текстовый ответ:\n\n${aiText}`, env);
                }
              } else {
                throw new Error('Failed to get AI response');
              }
              
              console.log(`✅ [${chatId}] Audio dialog text message processed successfully`);
              return new Response('OK');
              
            } catch (error) {
              console.error(`❌ [${chatId}] Error processing audio dialog text message:`, error);
              await sendMessageViaTelegram(chatId, '❌ Произошла ошибка при обработке сообщения. Попробуйте еще раз.', env);
            return new Response('OK');
            }
          }
          
          // Проверяем, ожидаем ли мы feedback от пользователя
          const feedbackWaiting = await env.USER_MODES.get(`feedback_waiting:${chatId}`);
          if (feedbackWaiting === 'true') {
            console.log(`💬 [${chatId}] Processing feedback: "${update.message.text}"`);
            
            // Удаляем состояние ожидания
            await env.USER_MODES.delete(`feedback_waiting:${chatId}`);
            
            // Сохраняем feedback через Lambda
            try {
              const feedbackResponse = await callLambdaFunction('onboarding', {
                user_id: chatId,
                action: 'save_feedback',
                feedback_text: update.message.text
              }, env);
              
              if (feedbackResponse && feedbackResponse.success) {
                console.log(`✅ [${chatId}] Feedback saved successfully`);
                
                // Получаем язык интерфейса для ответа
                let userLang = 'ru';
                try {
                  const profileResponse = await callLambdaFunction('onboarding', {
                    user_id: chatId,
                    action: 'get_profile'
                  }, env);
                  
                  if (profileResponse && profileResponse.success) {
                    userLang = profileResponse.user_data.interface_language || 'ru';
                  }
                } catch (error) {
                  console.error(`⚠️ [${chatId}] Could not get user language for feedback response:`, error);
                }
                
                // Формируем ответ в зависимости от того, первый ли это фидбэк
                let responseMessage;
                if (feedbackResponse.is_first_feedback && feedbackResponse.starter_pack_granted) {
                  responseMessage = userLang === 'en' 
                    ? "🎉 **Thank you for your feedback!**\n\nAs a thank you, we've added free lessons to your account. Additional premium access has been granted! 🎁"
                    : "🎉 **Спасибо за ваш отзыв!**\n\nВ благодарность мы добавили бесплатные уроки на ваш аккаунт. Дополнительный премиум доступ предоставлен! 🎁";
                } else if (feedbackResponse.is_first_feedback) {
                  responseMessage = userLang === 'en' 
                    ? "🎉 **Thank you for your first feedback!**\n\nWe appreciate your input and will use it to improve LinguaPulse."
                    : "🎉 **Спасибо за ваш первый отзыв!**\n\nМы ценим ваше мнение и используем его для улучшения LinguaPulse.";
              } else {
                  responseMessage = userLang === 'en' 
                    ? "💬 **Thank you for your feedback!**\n\nWe appreciate your continued input."
                    : "💬 **Спасибо за ваш отзыв!**\n\nМы ценим ваше постоянное участие.";
                }
                
                // Кнопка выбора режима ИИ
                const modeButtonText = userLang === 'en' ? "🤖 Choose AI Mode" : "🤖 Выбрать режим ИИ";
                
                await sendMessageViaTelegram(chatId, responseMessage, env, {
                  parse_mode: 'Markdown',
                  reply_markup: {
                    inline_keyboard: [[{ text: modeButtonText, callback_data: "text_helper:start" }]]
                  }
                });
                
          } else {
                console.error(`❌ [${chatId}] Failed to save feedback:`, feedbackResponse);
                const errorText = "❌ Произошла ошибка при сохранении отзыва. Попробуйте позже.";
                await sendMessageViaTelegram(chatId, errorText, env);
              }
              
            } catch (feedbackError) {
              console.error(`❌ [${chatId}] Error saving feedback:`, feedbackError);
              const errorText = "❌ Произошла ошибка при сохранении отзыва. Попробуйте позже.";
              await sendMessageViaTelegram(chatId, errorText, env);
            }
            
            return new Response('OK');
          }
          // Получаем сохраненный режим из KV storage
          // Режим уже определен выше, не переопределяем
          if (!currentMode) {
            currentMode = 'translation'; // по умолчанию
          }
          
          try {
            console.log(`📖 [${chatId}] Getting AI mode from Supabase...`);
            
            const modeResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'get_ai_mode'
            }, env);
            
            if (modeResponse && modeResponse.success && modeResponse.ai_mode) {
              currentMode = modeResponse.ai_mode;
              console.log(`📖 [${chatId}] Using saved AI mode from Supabase: ${currentMode}`);
            } else {
              console.log(`📖 [${chatId}] No saved mode in Supabase, analyzing message content...`);
              // Fallback: определяем режим по содержимому сообщения
              const message = update.message.text.toLowerCase();
              if (message.includes('грамматик') || message.includes('grammar') || 
                  message.includes('артикль') || message.includes('article') ||
                  message.includes('время') || message.includes('tense') ||
                  message.includes('правило') || message.includes('rule') ||
                  message.includes('разница между') || message.includes('difference between') ||
                  message.includes('объясни') || message.includes('explain') ||
                  message.includes('условные') || message.includes('conditional')) {
                currentMode = 'grammar';
                console.log(`🎯 [${chatId}] Detected GRAMMAR mode from message content`);
              } else {
                currentMode = 'translation';
                console.log(`🔄 [${chatId}] Using default TRANSLATION mode`);
              }
            }
          } catch (error) {
            console.error(`❌ [${chatId}] Error getting AI mode from Supabase:`, error);
            // В случае ошибки анализируем сообщение
            const message = update.message.text.toLowerCase();
            if (message.includes('грамматик') || message.includes('grammar') || 
                message.includes('артикль') || message.includes('article') ||
                message.includes('время') || message.includes('tense') ||
                message.includes('правило') || message.includes('rule') ||
                message.includes('разница между') || message.includes('difference between') ||
                message.includes('условные') || message.includes('conditional')) {
              currentMode = 'grammar';
              console.log(`🎯 [${chatId}] Error fallback: detected GRAMMAR mode from message content`);
            } else {
              currentMode = 'translation';
              console.log(`🔄 [${chatId}] Error fallback: using default TRANSLATION mode`);
            }
          }
          
          // Отправляем сообщение в Lambda для обработки через OpenAI
          console.log(`🔄 [LAMBDA] Processing text message for user ${chatId} in mode: ${currentMode}`);
          const aiResponse = await callLambdaFunction('onboarding', {
            user_id: chatId,
            action: 'process_text_message',
            message: update.message.text,
            mode: currentMode
          }, env);
          
          if (aiResponse && aiResponse.success) {
            console.log(`✅ [${chatId}] AI response received`);

            // Получаем язык интерфейса пользователя для кнопки
            const userResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'check_user'
            }, env);

            const userLang = userResponse?.user_data?.interface_language || 'ru';
            const changeModeButtonText = userLang === 'en' ? "🔄 Change AI Mode" : "🔄 Сменить Режим ИИ";

            // Разбиваем длинный ответ на части (лимит Telegram ~4096 символов)
            const maxLength = 4000; // Оставляем запас для кнопок
            const reply = aiResponse.reply;
            
            // Для текстового диалога - разделяем на два сообщения
            if (currentMode === 'text_dialog' && reply.includes('---SPLIT---')) {
              console.log(`💬 [${chatId}] Splitting text_dialog response into two messages`);
              
              const parts = reply.split('---SPLIT---');
              const feedbackMessage = parts[0].trim();
              const dialogMessage = parts[1].trim();
              
              // Отправляем сначала feedback
              if (feedbackMessage) {
                await sendMessageViaTelegram(chatId, feedbackMessage, env, {
                  parse_mode: 'Markdown'
                });
                
                // Небольшая задержка между сообщениями
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
              
              // Затем отправляем основной диалог с переводом
              let processedDialog = dialogMessage;
              let parseMode = 'Markdown';
              
              // Убираем служебный маркер ---END_DIALOG--- из пользовательского интерфейса
              processedDialog = processedDialog.replace(/---END_DIALOG---/g, '').trim();
              
              if (dialogMessage.includes('||')) {
                processedDialog = processedDialog.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
                processedDialog = processedDialog.replace(/\*([^*]+)\*/g, '<b>$1</b>');
                parseMode = 'HTML';
              }
              
              // Проверяем, нужно ли завершить диалог
              if (reply.includes('---END_DIALOG---')) {
                console.log(`🏁 [${chatId}] Dialog ending detected!`);
                
                // Отправляем основной диалог БЕЗ кнопки смены режима
                await sendMessageViaTelegram(chatId, processedDialog, env, {
                  parse_mode: parseMode
                });
                
                // Небольшая задержка перед финальным фидбэком
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Обновляем streak за завершение текстового диалога
                try {
                  console.log(`📈 [${chatId}] Updating text dialog streak`);
                  const streakResponse = await callLambdaFunction('onboarding', {
                    user_id: chatId,
                    action: 'update_text_dialog_streak'
                  }, env);
                  
                  if (streakResponse && streakResponse.success) {
                    console.log(`✅ [${chatId}] Streak updated: ${streakResponse.new_streak} (updated: ${streakResponse.streak_updated})`);
                  } else {
                    console.error(`❌ [${chatId}] Failed to update streak:`, streakResponse);
                  }
                } catch (streakError) {
                  console.error(`❌ [${chatId}] Error updating streak:`, streakError);
                }
                
                // Получаем финальный фидбэк
                const feedbackResponse = await callLambdaFunction('onboarding', {
                  user_id: chatId,
                  action: 'generate_dialog_feedback',
                  user_lang: userLang
                }, env);
                
                if (feedbackResponse && feedbackResponse.feedback) {
                  await sendMessageViaTelegram(chatId, feedbackResponse.feedback, env, {
                    parse_mode: 'Markdown'
                  });
                }
                
                // Небольшая задержка перед показом кнопок
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Показываем кнопки выбора режима
                const modeButtons = userLang === 'en' ? [
                  [{ text: "📝 Text Translation", callback_data: "ai_mode:translation" }],
                  [{ text: "📚 Grammar", callback_data: "ai_mode:grammar" }],
                  [{ text: "💬 Text Dialog", callback_data: "ai_mode:text_dialog" }],
                  [{ text: "🎤 Audio Dialog", callback_data: "ai_mode:audio_dialog" }]
                ] : [
                  [{ text: "📝 Перевод текста", callback_data: "ai_mode:translation" }],
                  [{ text: "📚 Грамматика", callback_data: "ai_mode:grammar" }],
                  [{ text: "💬 Текстовый диалог", callback_data: "ai_mode:text_dialog" }],
                  [{ text: "🎤 Аудио-диалог", callback_data: "ai_mode:audio_dialog" }]
                ];
                
                const modeSelectionText = userLang === 'en' 
                  ? "Please select your AI mode:" 
                  : "Выберите режим ИИ:";
                
                await sendMessageViaTelegram(chatId, modeSelectionText, env, {
                  reply_markup: { inline_keyboard: modeButtons }
                });
                
              } else {
                // Обычный диалог - показываем кнопку смены режима
                await sendMessageViaTelegram(chatId, processedDialog, env, {
                  parse_mode: parseMode,
                  reply_markup: {
                    inline_keyboard: [[{ text: changeModeButtonText, callback_data: "text_helper:start" }]]
                  }
                });
              }
              
            } else if (reply.length <= maxLength) {
              // Короткое сообщение - отправляем как есть
              let processedReply = reply;
              let parseMode = 'Markdown';
              
              // Если есть спойлеры, используем HTML (проверенно работает!)
              if (reply.includes('||')) {
                console.log(`🔒 [${chatId}] Found spoilers! Converting to HTML`);
                // Конвертируем ||spoiler|| в <tg-spoiler>spoiler</tg-spoiler>
                processedReply = reply.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
                // Конвертируем *bold* в <b>bold</b>  
                processedReply = processedReply.replace(/\*([^*]+)\*/g, '<b>$1</b>');
                parseMode = 'HTML';
                console.log(`🔒 [${chatId}] Converted to HTML - spoilers should work!`);
              } else {
                console.log(`📝 [${chatId}] No spoilers found, using Markdown`);
              }
              
              await sendMessageViaTelegram(chatId, processedReply, env, {
                parse_mode: parseMode,
                reply_markup: {
                  inline_keyboard: [[{ text: changeModeButtonText, callback_data: "text_helper:start" }]]
                }
              });
            } else {
              // Длинное сообщение - разбиваем на части
              console.log(`📏 [${chatId}] Long message (${reply.length} chars), splitting...`);
              
              const parts = [];
              let currentPart = '';
              const sentences = reply.split('\n\n'); // Разбиваем по абзацам
              
              for (const sentence of sentences) {
                if ((currentPart + sentence + '\n\n').length <= maxLength) {
                  currentPart += sentence + '\n\n';
                } else {
                  if (currentPart) {
                    parts.push(currentPart.trim());
                    currentPart = sentence + '\n\n';
                  } else {
                    // Если один абзац слишком длинный, разбиваем по предложениям
                    parts.push(sentence.substring(0, maxLength));
                    currentPart = sentence.substring(maxLength) + '\n\n';
                  }
                }
              }
              if (currentPart.trim()) {
                parts.push(currentPart.trim());
              }
              
              // Отправляем части
              for (let i = 0; i < parts.length; i++) {
                const isLast = i === parts.length - 1;
                let processedPart = parts[i];
                let parseMode = 'Markdown';
                
                // Если есть спойлеры в этой части, конвертируем в HTML
                if (parts[i].includes('||')) {
                  processedPart = parts[i].replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
                  processedPart = processedPart.replace(/\*([^*]+)\*/g, '<b>$1</b>');
                  parseMode = 'HTML';
                }
                
                const options = isLast ? {
                  parse_mode: parseMode,
                  reply_markup: {
                    inline_keyboard: [[{ text: changeModeButtonText, callback_data: "text_helper:start" }]]
                  }
                } : {
                  parse_mode: parseMode
                };
                
                await sendMessageViaTelegram(chatId, processedPart, env, options);
                
                // Небольшая задержка между сообщениями
                if (!isLast) {
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
            }
          } else {
            console.error(`❌ [${chatId}] AI processing failed:`, aiResponse);
            const errorText = aiResponse?.error || "❌ Произошла ошибка при обработке сообщения.";
            await sendMessageViaTelegram(chatId, errorText, env);
          }
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error processing text message:`, error);
                await sendMessageViaTelegram(chatId,
            "❌ Произошла ошибка. Попробуйте еще раз.", env);
        }
        
                return new Response('OK');
          }
          
      // 1.5. handle language selection and survey callbacks
      if (update.callback_query?.data?.startsWith('language:') ||
          update.callback_query?.data?.startsWith('survey:')) {
        
        console.log(`🌍 LANGUAGE/SURVEY CALLBACK: "${update.callback_query.data}" from user ${chatId}`);
        
        try {
          // Acknowledge callback
          await callTelegram('answerCallbackQuery', {
            callback_query_id: update.callback_query.id
          }, env);
          
          if (update.callback_query.data.startsWith('language:')) {
            // Обработка выбора языка
            const selectedLanguage = update.callback_query.data.split(':')[1];
            console.log(`🌍 [${chatId}] User selected language: ${selectedLanguage}`);
            
            // Получаем username из Telegram данных
            const telegramUser = update.callback_query.from;
            const username = telegramUser.username 
              ? `@${telegramUser.username}` 
              : telegramUser.first_name 
                ? `${telegramUser.first_name}${telegramUser.last_name ? ' ' + telegramUser.last_name : ''}`
                : `user_${chatId}`;
            
            console.log(`👤 [${chatId}] User info:`, {
              username: telegramUser.username,
              first_name: telegramUser.first_name,
              last_name: telegramUser.last_name,
              final_username: username
            });
            
            // Создаем пользователя в Supabase через Lambda
            const createResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'start_survey',
              interface_language: selectedLanguage,
              username: username
            }, env);
            
            const createBody = createResponse;
            console.log(`✅ [${chatId}] User creation response:`, createBody);
            
            if (createBody.success) {
              // Получаем первый вопрос опросника из Lambda
              const questionResponse = await callLambdaFunction('onboarding', {
                action: 'get_survey_question',
                question_type: 'language_level',
                language: selectedLanguage
              }, env);
              
              const questionBody = questionResponse;
              
              if (questionBody.success) {
                const keyboard = questionBody.options.map(option => [
                  { text: option, callback_data: `survey:language_level:${option}:${selectedLanguage}` }
                ]);
                
                await sendMessageViaTelegram(chatId, questionBody.question, env, {
                  reply_markup: { inline_keyboard: keyboard }
                });
              } else {
          await sendMessageViaTelegram(chatId, 
                  "❌ Произошла ошибка при загрузке опросника. Попробуйте еще раз.", env);
              }
              } else {
                await sendMessageViaTelegram(chatId,
                "❌ Произошла ошибка при создании профиля. Попробуйте еще раз.", env);
            }
            
          } else if (update.callback_query.data.startsWith('survey:')) {
            // Обработка ответов опросника
            const parts = update.callback_query.data.split(':');
            const questionType = parts[1];
            const answer = parts[2]; // Для language_level это текст, для остальных - индекс (не важно)
            
            console.log(`📝 [${chatId}] Survey answer: ${questionType} = ${answer}`);
            
            // Извлекаем language_level и interface_language
            let languageLevel = null;
            let interfaceLanguage = 'ru'; // дефолт
            
            if (questionType === 'language_level') {
              // Первый вопрос - сохраняем ответ как language_level
              languageLevel = answer;
              // Извлекаем interface_language из callback data
              const callbackParts = update.callback_query.data.split(':');
              if (callbackParts.length > 3) {
                interfaceLanguage = callbackParts[3];
            }
          } else {
              // Последующие вопросы - извлекаем из callback data
              const callbackParts = update.callback_query.data.split(':');
              if (callbackParts.length > 3) {
                languageLevel = callbackParts[3];
              }
              if (callbackParts.length > 4) {
                interfaceLanguage = callbackParts[4];
              }
            }
            
            // Определяем следующий вопрос
            const nextQuestion = getNextQuestion(questionType);
            
            if (nextQuestion) {
              // Есть следующий вопрос - показываем его
              const questionResponse = await callLambdaFunction('onboarding', {
                action: 'get_survey_question',
                question_type: nextQuestion,
                language: interfaceLanguage // Используем выбранный язык интерфейса
              }, env);
              
              const questionBody = questionResponse;
              
              if (questionBody.success) {
                const keyboard = questionBody.options.map((option, index) => [
                  { text: option, callback_data: `survey:${nextQuestion}:${index}:${languageLevel || ''}:${interfaceLanguage}` }
                ]);
                
                await sendMessageViaTelegram(chatId, questionBody.question, env, {
                  reply_markup: { inline_keyboard: keyboard }
                });
                
                // Состояние не сохраняем - маркетинговые вопросы
              } else {
          await sendMessageViaTelegram(chatId, 
                  "❌ Произошла ошибка при загрузке следующего вопроса. Попробуйте еще раз.", env);
              }
            } else {
              // Опросник завершен - сохраняем только language_level
              const completeResponse = await callLambdaFunction('onboarding', {
                user_id: chatId,
                action: 'complete_survey',
                language_level: languageLevel // Только уровень языка
              }, env);
              
              const completeBody = completeResponse;
              console.log(`✅ [${chatId}] Survey completion response:`, completeBody);
              
              if (completeBody.success) {
                // Показываем сообщение о подборе плана
                const loadingText = interfaceLanguage === 'en'
                    ? "⏳ Finding the perfect learning plan for you..."
                    : "⏳ Подбираем идеальный план обучения для вас...";

                await sendMessageViaTelegram(chatId, loadingText, env);
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Финальное сообщение с информацией о текстовом помощнике и предзаписи на аудио-практику
                const successText = interfaceLanguage === 'en' 
                  ? `🎉 Done!
Today you have access to a *free English text assistant*. Ask questions: grammar, vocabulary, translations, text corrections, interview preparation.

🚀 Very soon we're launching *audio practice* — real speech training with AI that helps overcome language barriers and start speaking fluently.

The first users who sign up for the list will get a series of audio lessons for free. Limited spots available — be among the first.`
                  : `🎉 Готово!
Сегодня у тебя есть доступ к *бесплатному текстовому помощнику по английскому*. Задавай вопросы: грамматика, лексика, переводы, правка текстов, подготовка к собеседованию.

🚀 Совсем скоро мы запускаем *аудио-практику* — это реальная тренировка речи с ИИ, которая помогает преодолеть языковой барьер и начать свободно говорить.

Первые пользователи, кто запишется в список, получат серию аудио-уроков бесплатно. Количество мест ограничено — будь среди первых.`;

                const audioPracticeButtonText = interfaceLanguage === 'en' ? "Want audio practice" : "Хочу аудио-практику";
                const askQuestionButtonText = interfaceLanguage === 'en' ? "Ask AI" : "Спросить ИИ";
                
                const buttons = [
                  [{ text: audioPracticeButtonText, callback_data: "audio_practice:signup" }],
                  [{ text: askQuestionButtonText, callback_data: "text_helper:start" }]
                ];
                
                await sendMessageViaTelegram(chatId, successText, env, {
                  reply_markup: { inline_keyboard: buttons },
                  parse_mode: 'Markdown'
                });
              } else {
                const errorText = interfaceLanguage === 'en' 
                  ? "❌ Error saving data. Please try again."
                  : "❌ Произошла ошибка при сохранении данных. Попробуйте еще раз.";
                await sendMessageViaTelegram(chatId, errorText, env);
              }
            }
          }
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error handling callback:`, error);
          await sendMessageViaTelegram(chatId, 
            "❌ Произошла ошибка. Попробуйте еще раз.", env);
        }
        
          return new Response('OK');
        }
        
      // 1.6. Handle profile callback buttons
      if (update.callback_query?.data?.startsWith('profile:')) {
        console.log(`🎯 PROFILE CALLBACK: "${update.callback_query.data}" from user ${chatId}`);
        
        try {
          await callTelegram('answerCallbackQuery', {
            callback_query_id: update.callback_query.id
          }, env);
          
          const action = update.callback_query.data.split(':')[1];
          
          if (action === 'start_audio') {
            // Проверяем доступ к аудио-урокам (та же логика что и в ai_mode:audio_dialog)
            console.log(`🎤 [${chatId}] Checking audio access for profile start_audio`);
            
            try {
              const accessResponse = await callLambdaFunction('onboarding', {
                user_id: chatId,
                action: 'check_audio_access'
              }, env);
              
              console.log(`🔍 LAMBDA ОТВЕТ:`, JSON.stringify(accessResponse, null, 2));
              
              if (accessResponse && accessResponse.success) {
                const { has_access, lessons_left, package_expires_at, interface_language, has_lessons, has_active_subscription } = accessResponse;
                
                console.log(`🔍 ДЕТАЛИ ДОСТУПА: has_access=${has_access}, lessons=${lessons_left}, expires=${package_expires_at}, has_lessons=${has_lessons}, has_subscription=${has_active_subscription}`);
                
                if (has_access) {
                  console.log(`✅ [${chatId}] Audio access confirmed, switching to audio_dialog mode`);
                  
                  // 0. KILL PREVIOUS SESSION - Clear all old audio dialog data
                  console.log(`🧹 [${chatId}] Cleaning up any previous audio dialog session`);
                  await env.CHAT_KV.delete(`audio_dialog_count:${chatId}`); // Old counter
                  await env.CHAT_KV.delete(`audio_dialog_audio_count:${chatId}`); // New counter
                  await env.CHAT_KV.delete(`audio_lesson_used:${chatId}`); // Anti-abuse flag
                  console.log(`✅ [${chatId}] Previous session data cleared`);
                  
                  // 1. Сохраняем режим в KV и Supabase
                  await env.CHAT_KV.put(`ai_mode:${chatId}`, 'audio_dialog');
                  console.log(`💾 [${chatId}] Audio dialog mode saved to KV`);
                  
                  await callLambdaFunction('onboarding', {
                    user_id: chatId,
                    action: 'set_ai_mode',
                    mode: 'audio_dialog'
                  }, env);
                  console.log(`💾 [${chatId}] Audio dialog mode saved to Supabase`);
                  
                  // 2. Отправляем сообщение о начале урока
                  const startMessage = interface_language === 'en' 
                    ? `🎤 Your audio lesson is starting...`
                    : `🎤 Ваш аудио-урок начинается...`;
                  
                  await sendMessageViaTelegram(chatId, startMessage, env, {
                    parse_mode: 'Markdown'
                  });
                  
                  // 3. Генерируем первое аудио-приветствие
                  console.log(`🤖 [${chatId}] Generating first audio greeting`);
                  
                  try {
                    // Получаем уровень пользователя
                    const levelResponse = await callLambdaFunction('onboarding', {
                      telegram_id: chatId,
                      action: 'get_user_level'
                    }, env);
                    
                    const userLevel = levelResponse?.level || 'Intermediate';
                    console.log(`👤 [${chatId}] User level: ${userLevel}`);
                    
                    // Генерируем приветствие через Lambda
                    const greetingResponse = await callLambdaFunction('onboarding', {
                      user_id: chatId,
                      action: 'process_text_message',
                      message: '---START_AUDIO_DIALOG---',
                      mode: 'audio_dialog',
                      user_level: userLevel
                    }, env);
                    
                    if (greetingResponse?.success && greetingResponse.reply) {
                      const greetingText = greetingResponse.reply;
                      console.log(`🤖 [${chatId}] First greeting generated: "${greetingText.substring(0, 100)}..."`);
                      
                      // Отправляем как голосовое сообщение
                      const ttsSuccess = await safeSendTTS(chatId, greetingText, env);
                      
                      if (ttsSuccess) {
                        console.log(`🎉 [${chatId}] Audio greeting sent successfully!`);
                      } else {
                        console.log(`❌ [${chatId}] TTS failed for greeting`);
                        await sendMessageViaTelegram(chatId, "❌ Ошибка аудио-системы. Попробуйте позже.", env, {
                          reply_markup: {
                            inline_keyboard: [[
                              { text: "🔄 Сменить режим ИИ", callback_data: "text_helper:start" }
                            ]]
                          }
                        });
                      }
                    } else {
                      console.error(`❌ [${chatId}] Failed to generate greeting:`, greetingResponse);
                      await sendMessageViaTelegram(chatId, "❌ Ошибка генерации приветствия. Попробуйте позже.", env);
                    }
                  } catch (error) {
                    console.error(`❌ [${chatId}] Error generating audio greeting:`, error);
                    await sendMessageViaTelegram(chatId, "❌ Ошибка аудио-системы. Попробуйте позже.", env);
                  }
                } else {
                  // Нет доступа - показываем детальную информацию
                  const expireDate = package_expires_at ? new Date(package_expires_at).toLocaleDateString('ru-RU') : 'не активна';
                  
                  const message = interface_language === 'en' 
                    ? `🎤 **Audio Lesson**\n\n❌ **No audio lessons available**\n\n📊 **Current status:**\n• Audio lessons left: ${lessons_left}\n• Subscription expires: ${expireDate}\n\nTo access audio lessons, you need both active lessons and an active subscription.`
                    : `🎤 **Аудио-урок**\n\n❌ **Нет доступных аудио-уроков**\n\n📊 **Текущее состояние:**\n• Осталось аудио-уроков: ${lessons_left}\n• Подписка истекает: ${expireDate}\n\nДля доступа к аудио-урокам нужны и активные уроки, и активная подписка.`;
                  
                  await sendMessageViaTelegram(chatId, message, env, {
                    parse_mode: 'Markdown',
                    reply_markup: {
                      inline_keyboard: [
                        [{ 
                          text: interface_language === 'en' ? "🛒 Add Lessons" : "🛒 Добавить уроки", 
                          url: "https://linguapulse.ai/paywall" 
                        }],
                        [{ text: interface_language === 'en' ? "🔄 Back to Profile" : "🔄 Назад к профилю", callback_data: "profile:show" }]
                      ]
                    }
                  });
                }
              } else {
                // Ошибка при проверке доступа
                console.error(`❌ [${chatId}] Failed to check audio access:`, accessResponse);
                const message = interface_language === 'en' 
                  ? `🎤 **Audio Lesson**\n\n❌ Unable to check access. Please try again later.`
                  : `🎤 **Аудио-урок**\n\n❌ Не удалось проверить доступ. Попробуйте позже.`;
                
                await sendMessageViaTelegram(chatId, message, env);
              }
            } catch (error) {
              console.error(`❌ [${chatId}] Error checking audio access:`, error);
              const message = `🎤 **Аудио-урок**\n\n❌ Техническая ошибка. Попробуйте позже.`;
              
              await sendMessageViaTelegram(chatId, message, env);
            }
            
          } else if (action === 'show') {
            // Показать профиль - ТОЧНО ТА ЖЕ ЛОГИКА что и команда /profile
            console.log(`🔍 [${chatId}] Getting profile data from Lambda`);
            
            const profileResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'get_profile'
            }, env);
            
            if (!profileResponse || !profileResponse.success) {
              const errorText = "❌ Профиль не найден. Пожалуйста, начните с команды /start";
              await sendMessageViaTelegram(chatId, errorText, env);
              return;
            }
            
            const userData = profileResponse.user_data;
            const hasAudioAccess = profileResponse.has_audio_access;
            const hasTextAccess = profileResponse.has_text_access;
            const accessDate = profileResponse.access_date;
            
            // Определяем язык интерфейса
            const userLang = userData.interface_language || 'ru';
            
            // Локализованные тексты
            const texts = userLang === 'ru' ? {
              profileTitle: '👤 *Ваш профиль*',
              username: '📝 *Имя:*',
              level: '🎯 *Уровень:*',
              lessonsLeft: '📚 *Аудио-уроков осталось:*',
              accessUntil: '⏰ *Доступ до:*',
              totalCompleted: '🎓 *Всего аудио-уроков пройдено:*',
              currentStreak: '🔥 *Текущая серия:*',
              days: 'дней',
              startAudio: '🎤 Начать аудио-урок',
              buyAudio: '🛒 Купить аудио-уроки',
              startText: '💬 Начать текстовый диалог',
              buyPremium: '💎 Купить премиум',
              chooseMode: '🤖 Выбрать режим ИИ'
            } : {
              profileTitle: '👤 *Your Profile*',
              username: '📝 *Name:*',
              level: '🎯 *Level:*',
              lessonsLeft: '📚 *Audio lessons left:*',
              accessUntil: '⏰ *Access until:*',
              totalCompleted: '🎓 *Total audio lessons completed:*',
              currentStreak: '🔥 *Current streak:*',
              days: 'days',
              startAudio: '🎤 Start Audio Lesson',
              buyAudio: '🛒 Buy Audio Lessons',
              startText: '💬 Start Text Dialog',
              buyPremium: '💎 Buy Premium',
              chooseMode: '🤖 Choose AI Mode'
            };
            
            // Формируем сообщение профиля
            const profileMessage = `${texts.profileTitle}\n\n${texts.username} ${userData.username}\n${texts.level} ${userData.current_level}\n${texts.lessonsLeft} ${userData.lessons_left}\n${texts.accessUntil} ${accessDate}\n${texts.totalCompleted} ${userData.total_lessons_completed}\n${texts.currentStreak} ${userData.current_streak} ${texts.days}\n`;
            
            // Формируем кнопки
            const buttons = [];
            
            // Кнопка аудио-урока
            if (hasAudioAccess) {
              buttons.push([{ text: texts.startAudio, callback_data: "profile:start_audio" }]);
            } else {
              buttons.push([{ text: texts.buyAudio, callback_data: "profile:buy_audio" }]);
            }
            
            // Кнопка текстового диалога
            if (hasTextAccess) {
              buttons.push([{ text: texts.startText, callback_data: "ai_mode:text_dialog" }]);
            } else {
              buttons.push([{ text: texts.buyPremium, callback_data: "profile:buy_premium" }]);
            }
            
            // Кнопка выбора режима ИИ
            buttons.push([{ text: texts.chooseMode, callback_data: "text_helper:start" }]);
            
            await sendMessageViaTelegram(chatId, profileMessage, env, {
              parse_mode: 'Markdown',
              reply_markup: { inline_keyboard: buttons }
            });
            
          } else if (action === 'buy_audio' || action === 'buy_premium') {
            // Перенаправляем на покупку
            const userLang = 'ru'; // Можно получить из профиля
            const buttonText = userLang === 'ru' ? 'Купить подписку' : 'Buy Subscription';
            
            let tributeAppLink = env.TRIBUTE_APP_LINK || env.TRIBUTE_CHANNEL_LINK || "https://t.me/tribute/app?startapp=swvs";
            if (tributeAppLink && !tributeAppLink.match(/^https?:\/\//)) {
              tributeAppLink = "https://" + tributeAppLink.replace(/^[\/\\]+/, '');
            }
            
            const message = userLang === 'ru' 
              ? "💰 Для доступа к полному функционалу необходима подписка:"
              : "💰 A subscription is required for full functionality:";
            
            await sendMessageViaTelegram(chatId, message, env, {
              reply_markup: {
                inline_keyboard: [[{ text: buttonText, url: tributeAppLink }]]
              }
            });
          }
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error handling profile callback:`, error);
          const errorText = "❌ Произошла ошибка. Попробуйте еще раз.";
          await sendMessageViaTelegram(chatId, errorText, env);
        }
        
        return new Response('OK');
      }

      // 1.7. Handle audio practice waitlist and text helper buttons
      if (update.callback_query?.data === 'audio_practice:signup' || 
          update.callback_query?.data === 'text_helper:start') {
        
        console.log(`🎯 NEW FEATURE CALLBACK: "${update.callback_query.data}" from user ${chatId}`);
        
        try {
          // Acknowledge callback
          await callTelegram('answerCallbackQuery', {
            callback_query_id: update.callback_query.id
          }, env);
          
          if (update.callback_query.data === 'audio_practice:signup') {
            // Записать пользователя в waitlist для аудио-практики
            console.log(`🚀 [${chatId}] Adding to audio practice waitlist`);
            
            const waitlistResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'add_to_waitlist'
            }, env);
            
            if (waitlistResponse && waitlistResponse.success) {
              console.log(`✅ [${chatId}] Added to waitlist successfully`);
              
              // Определяем язык интерфейса пользователя
              const userLang = waitlistResponse.user_data?.interface_language || 'ru';
              
              const waitlistMessage = userLang === 'en' 
                ? `You're on the list of first participants 🚀
As soon as we open audio lessons — we'll send an invitation.`
                : `Ты в списке первых участников 🚀
Как только откроем аудио-уроки — пришлём приглашение.`;

              const askAIButtonText = userLang === 'en' ? "Ask AI" : "Спросить ИИ";
              const askAIButton = [{ text: askAIButtonText, callback_data: "text_helper:start" }];
              
              await sendMessageViaTelegram(chatId, waitlistMessage, env, {
                reply_markup: { inline_keyboard: [askAIButton] }
              });
            } else {
              console.error(`❌ [${chatId}] Failed to add to waitlist:`, waitlistResponse);
              const errorText = "❌ Произошла ошибка. Попробуйте еще раз.";
              await sendMessageViaTelegram(chatId, errorText, env);
            }
            
          } else if (update.callback_query.data === 'text_helper:start') {
            // Показать выбор режимов ИИ
            console.log(`💬 [${chatId}] Showing AI mode selection`);
            
            // Получаем язык интерфейса пользователя
            const userResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'check_user'
            }, env);
            
            const userLang = userResponse?.user_data?.interface_language || 'ru';
            
            const modeMessage = userLang === 'en' 
              ? `🤖 Choose AI mode:`
              : `🤖 Выберите режим ИИ:`;
            
            // Создаем кнопки для выбора режима
            const modeButtons = userLang === 'en' 
              ? [
                  [{ text: "📝 Text Translation", callback_data: "ai_mode:translation" }],
                  [{ text: "📚 Grammar", callback_data: "ai_mode:grammar" }],
                  [{ text: "💬 Text Dialog", callback_data: "ai_mode:text_dialog" }],
                  [{ text: "🎤 Audio Dialog", callback_data: "ai_mode:audio_dialog" }]
                ]
              : [
                  [{ text: "📝 Перевод текста", callback_data: "ai_mode:translation" }],
                  [{ text: "📚 Грамматика", callback_data: "ai_mode:grammar" }],
                  [{ text: "💬 Текстовый диалог", callback_data: "ai_mode:text_dialog" }],
                  [{ text: "🎤 Аудио-диалог", callback_data: "ai_mode:audio_dialog" }]
                ];
            
            await sendMessageViaTelegram(chatId, modeMessage, env, {
              reply_markup: { inline_keyboard: modeButtons }
            });
          }
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error handling new feature callback:`, error);
          await sendMessageViaTelegram(chatId, 
            "❌ Произошла ошибка. Попробуйте еще раз.", env);
        }
        
          return new Response('OK');
        }
        
      // 1.7. Handle AI mode selection
      if (update.callback_query?.data?.startsWith('ai_mode:')) {
        console.log(`🤖 AI MODE SELECTION: "${update.callback_query.data}" from user ${chatId}`);
        
        try {
          // Acknowledge callback
          await callTelegram('answerCallbackQuery', {
            callback_query_id: update.callback_query.id
          }, env);
          
          const mode = update.callback_query.data.split(':')[1]; // Извлекаем режим из callback_data
          console.log(`🎯 [${chatId}] Selected AI mode: ${mode}`);
          
          // Получаем язык интерфейса пользователя
          const userResponse = await callLambdaFunction('onboarding', {
            user_id: chatId,
            action: 'check_user'
          }, env);
          
          const userLang = userResponse?.user_data?.interface_language || 'ru';
          
          // Формируем сообщение в зависимости от выбранного режима
          let instructionMessage = '';
          let changeModeButtonText = userLang === 'en' ? "🔄 Change AI Mode" : "🔄 Сменить Режим ИИ";
          
          // Инициализируем modeButtons заранее
          let modeButtons = [
            [{ text: changeModeButtonText, callback_data: "text_helper:start" }]
          ];
          
          switch (mode) {
            case 'translation':
              instructionMessage = userLang === 'en' 
                ? `📝 **Translation Mode**\n\nJust send me any text in Russian or English, and I'll automatically translate it to the other language.`
                : `📝 **Режим перевода**\n\nПросто отправь мне любой текст на русском или английском, и я автоматически переведу его на другой язык.`;
              break;
            case 'grammar':
              instructionMessage = userLang === 'en' 
                ? `📚 **Grammar Mode**\n\nAsk me about English grammar: tenses, articles, word order, conditionals, and more. I'll give you structured explanations with examples and practice questions.`
                : `📚 **Режим грамматики**\n\nСпрашивай меня о грамматике английского: времена, артикли, порядок слов, условные предложения и многое другое. Я дам структурированные объяснения с примерами и упражнениями.`;
              break;
            case 'text_dialog':
              instructionMessage = userLang === 'en' 
                ? `💬 **Text Dialog Mode**\n\nLet's have a conversation in English! I'll help you practice while chatting naturally.`
                : `💬 **Режим текстового диалога**\n\nДавай поговорим на английском! Я помогу тебе практиковаться в естественном общении.`;
              break;
            case 'audio_dialog':
              // Проверяем доступ к аудио-урокам
              console.log(`🎤 [${chatId}] Checking audio access for user`);
              
              try {
                const accessResponse = await callLambdaFunction('onboarding', {
                  user_id: chatId,
                  action: 'check_audio_access'
                }, env);
                
                if (accessResponse && accessResponse.success) {
                  const { has_access, lessons_left, package_expires_at, interface_language } = accessResponse;
                  
                  if (has_access) {
                    // 0. KILL PREVIOUS SESSION - Clear all old audio dialog data
                    console.log(`🧹 [${chatId}] Cleaning up any previous audio dialog session`);
                    await env.CHAT_KV.delete(`audio_dialog_count:${chatId}`); // Old counter
                    await env.CHAT_KV.delete(`audio_dialog_audio_count:${chatId}`); // New counter
                    await env.CHAT_KV.delete(`audio_lesson_used:${chatId}`); // Anti-abuse flag
                    console.log(`✅ [${chatId}] Previous session data cleared`);
                    
                    // СОХРАНЯЕМ РЕЖИМ В KV И SUPABASE!
                    await env.CHAT_KV.put(`ai_mode:${chatId}`, 'audio_dialog');
                    console.log(`💾 [${chatId}] Audio dialog mode saved to KV from ai_mode callback`);
                    
                    // Сохраняем в Supabase
                    console.log(`💾 [${chatId}] Saving AI mode 'audio_dialog' to Supabase...`);
                    await callLambdaFunction('onboarding', {
                      user_id: chatId,
                      action: 'set_ai_mode',
                      mode: 'audio_dialog'
                    }, env);
                    console.log(`✅ [${chatId}] AI mode 'audio_dialog' saved to Supabase successfully`);
                    
                    // ЗАПУСКАЕМ АУДИО-УРОК (ТА ЖЕ ЛОГИКА ЧТО И В profile:start_audio)
                    const startMessage = interface_language === 'en' 
                      ? `🎤 Your audio lesson is starting...`
                      : `🎤 Ваш аудио-урок начинается...`;
                    
                    await sendMessageViaTelegram(chatId, startMessage, env, {
                      parse_mode: 'Markdown'
                    });
                    
                    // Генерируем первое аудио-приветствие
                    console.log(`🤖 [${chatId}] Generating first audio greeting`);
                    
                    // Получаем уровень пользователя
                    const levelResponse = await callLambdaFunction('onboarding', {
                      telegram_id: chatId,
                      action: 'get_user_level'
                    }, env);
                    
                    const userLevel = levelResponse?.level || 'Intermediate';
                    console.log(`👤 [${chatId}] User level: ${userLevel}`);
                    
                    // Генерируем приветствие через Lambda
                    const greetingResponse = await callLambdaFunction('onboarding', {
                      user_id: chatId,
                      action: 'process_text_message',
                      message: '---START_AUDIO_DIALOG---',
                      mode: 'audio_dialog',
                      user_level: userLevel
                    }, env);
                    
                    if (greetingResponse && greetingResponse.success) {
                      const greetingText = greetingResponse.reply;
                      console.log(`🤖 [${chatId}] First greeting generated: "${greetingText.substring(0, 100)}..."`);
                      
                      // Отправляем аудио-приветствие
                      const success = await safeSendTTS(chatId, greetingText, env);
                      
                      if (success) {
                        console.log(`🎉 [${chatId}] Audio greeting sent successfully!`);
                        // НЕ ОТПРАВЛЯЕМ instructionMessage - урок уже начался!
                        instructionMessage = null; // Устанавливаем null чтобы не отправлять сообщение
                      } else {
                        console.error(`❌ [${chatId}] Failed to send audio greeting`);
                        instructionMessage = interface_language === 'en' 
                          ? `🎤 **Audio Dialog Mode**\n\n❌ Audio system error. Please try again later.`
                          : `🎤 **Режим аудио-диалога**\n\n❌ Ошибка аудио-системы. Попробуйте позже.`;
                      }
                    } else {
                      console.error(`❌ [${chatId}] Failed to generate greeting:`, greetingResponse);
                      instructionMessage = interface_language === 'en' 
                        ? `🎤 **Audio Dialog Mode**\n\n❌ Failed to generate greeting. Please try again later.`
                        : `🎤 **Режим аудио-диалога**\n\n❌ Ошибка генерации приветствия. Попробуйте позже.`;
                    }
                    
                    // При наличии доступа - только кнопка смены режима (без дополнительных кнопок)
                    modeButtons = [
                      [{ text: changeModeButtonText, callback_data: "text_helper:start" }]
                    ];
                  } else {
                    // Нет доступа - показываем детальную информацию
                    const expireDate = package_expires_at ? new Date(package_expires_at).toLocaleDateString('ru-RU') : 'не активна';
                    
                    instructionMessage = interface_language === 'en' 
                      ? `🎤 **Audio Dialog Mode**\n\n❌ **No audio lessons available**\n\n📊 **Current status:**\n• Audio lessons left: ${lessons_left}\n• Subscription expires: ${expireDate}\n\nTo access audio lessons, you need both active lessons and an active subscription.`
                      : `🎤 **Режим аудио-диалога**\n\n❌ **Нет доступных аудио-уроков**\n\n📊 **Текущее состояние:**\n• Осталось аудио-уроков: ${lessons_left}\n• Подписка истекает: ${expireDate}\n\nДля доступа к аудио-урокам нужны и активные уроки, и активная подписка.`;
                    
                    // Изменяем кнопки для случая отсутствия доступа
                    modeButtons = [
                      [{ 
                        text: interface_language === 'en' ? "🛒 Add Lessons" : "🛒 Добавить уроки", 
                        url: "https://linguapulse.ai/paywall" 
                      }],
                      [{ text: changeModeButtonText, callback_data: "text_helper:start" }]
                    ];
                  }
                } else {
                  // Ошибка при проверке доступа
                  console.error(`❌ [${chatId}] Failed to check audio access:`, accessResponse);
                  instructionMessage = userLang === 'en' 
                    ? `🎤 **Audio Dialog Mode**\n\n❌ Unable to check access. Please try again later.`
                    : `🎤 **Режим аудио-диалога**\n\n❌ Не удалось проверить доступ. Попробуйте позже.`;
                }
              } catch (error) {
                console.error(`❌ [${chatId}] Error checking audio access:`, error);
                instructionMessage = userLang === 'en' 
                  ? `🎤 **Audio Dialog Mode**\n\n❌ Technical error. Please try again later.`
                  : `🎤 **Режим аудио-диалога**\n\n❌ Техническая ошибка. Попробуйте позже.`;
              }
              break;
            default:
              instructionMessage = userLang === 'en' 
                ? `❓ Unknown mode selected.`
                : `❓ Выбран неизвестный режим.`;
          }
          
          // Отправляем инструкцию с кнопкой смены режима
          // modeButtons уже инициализирована выше и может быть изменена в switch case

          // Для audio_dialog кнопки уже настроены в switch case выше
          // (либо кнопка "Добавить уроки" при отсутствии доступа, либо без дополнительных кнопок при наличии доступа)

          // Отправляем сообщение только если instructionMessage не null (для audio_dialog может быть null если урок уже начался)
          if (instructionMessage) {
            await sendMessageViaTelegram(chatId, instructionMessage, env, {
              reply_markup: { 
                inline_keyboard: modeButtons
              },
              parse_mode: 'Markdown'
            });
          }
          
          // Для text_dialog отправляем начальное сообщение от бота
          if (mode === 'text_dialog') {
            // Небольшая задержка для лучшего UX
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const startMessage = userLang === 'en' 
              ? "Hello! I'm excited to practice English with you! 😊 What would you like to talk about today? Here are some ideas: daily routine, hobbies, food, travel, or anything else! ||Привет! Я рад практиковать английский с тобой! 😊 О чем хочешь поговорить сегодня? Вот несколько идей: распорядок дня, хобби, еда, путешествия, или что-то другое!||"
              : "Hello! I'm excited to practice English with you! 😊 What would you like to talk about today? Here are some ideas: daily routine, hobbies, food, travel, or anything else! ||Привет! Я рад практиковать английский с тобой! 😊 О чем хочешь поговорить сегодня? Вот несколько идей: распорядок дня, хобби, еда, путешествия, или что-то другое!||";
            
            // Конвертируем спойлеры для HTML
            let processedStartMessage = startMessage;
            let parseMode = 'Markdown';
            
            if (startMessage.includes('||')) {
              processedStartMessage = startMessage.replace(/\|\|([^|]+)\|\|/g, '<tg-spoiler>$1</tg-spoiler>');
              parseMode = 'HTML';
            }
            
            await sendMessageViaTelegram(chatId, processedStartMessage, env, {
              parse_mode: parseMode,
              reply_markup: { 
                inline_keyboard: modeButtons
              }
            });
          }
          
          // Сохраняем выбранный режим в Supabase через Lambda
          try {
            console.log(`💾 [${chatId}] Saving AI mode '${mode}' to Supabase...`);
            
            const saveResponse = await callLambdaFunction('onboarding', {
              user_id: chatId,
              action: 'set_ai_mode',
              mode: mode
            }, env);
            
            if (saveResponse && saveResponse.success) {
              console.log(`✅ [${chatId}] AI mode '${mode}' saved to Supabase successfully`);
            } else {
              console.error(`❌ [${chatId}] Failed to save AI mode to Supabase:`, saveResponse);
            }
          } catch (error) {
            console.error(`❌ [${chatId}] Error saving AI mode to Supabase:`, error);
          }
          
        } catch (error) {
          console.error(`❌ [${chatId}] Error handling AI mode selection:`, error);
          await sendMessageViaTelegram(chatId, 
            "❌ Произошла ошибка. Попробуйте еще раз.", env);
        }
        
        return new Response('OK');
      }

      // 2. handle lesson buttons
      if (update.callback_query?.data === 'lesson:free' || 
          update.callback_query?.data === 'lesson:start') {
        
        console.log(`🎯 CALLBACK RECEIVED: "${update.callback_query.data}" from user ${chatId}`);
        console.log(`📊 Full callback query:`, JSON.stringify(update.callback_query));
        
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        console.log(`✅ Callback query acknowledged for: ${update.callback_query.data}`);
        
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
          
          // CRITICAL: Anti-duplication check for lesson:start button
          const lessonStartLockKey = `lesson_start_lock:${chatId}`;
          
          // Check if we have KV storage available for the lock
          let kvStorage = env.USER_MODES || env.USER_PROFILE || env.TEST_KV;
          if (!kvStorage) {
            console.error(`❌ [${chatId}] No KV storage available for duplication protection`);
            // Continue without lock as fallback
          } else {
            try {
              const existingLock = await kvStorage.get(lessonStartLockKey);
              
              if (existingLock) {
                const lockTime = parseInt(existingLock, 10);
                const now = Date.now();
                
                // If lock is less than 30 seconds old, reject duplicate request
                if (now - lockTime < 30000) {
                  console.log(`🚫 [${chatId}] DUPLICATE lesson:start request blocked (lock age: ${now - lockTime}ms)`);
                  return new Response('OK');
                }
              }
              
              // Set lock for 60 seconds
              await kvStorage.put(lessonStartLockKey, Date.now().toString(), { expirationTtl: 60 });
              console.log(`🔒 [${chatId}] lesson:start lock set in telegram-webhook`);
            } catch (lockError) {
              console.error(`❌ [${chatId}] Error with lesson:start lock:`, lockError);
              // Continue without lock as fallback
            }
          }
          
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
          await sendMessageViaTelegram(chatId, 
            'You need to complete the onboarding first. Use /start to begin.', env);
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
          callback_query_id: update.callback_query.id,
          text: "Test payment activated!"
        }, env);
        
        console.log(`TEST PAYMENT button pressed by user ${chatId} in DEV mode`);
        
        // Immediately activate subscription in database
        try {
          const now = new Date();
          const subscribed_at = now.toISOString();
          const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
          const subscription_expired_at = expiry.toISOString();
          
          // Make next lesson immediately available
          const nextLessonDate = new Date(now.getTime() - 60000); // 1 minute ago
          const next_lesson_access_at = nextLessonDate.toISOString();
          
          // Update user profile with subscription info
          await env.USER_DB
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
              parseInt(chatId, 10)
            )
            .run();
          
          console.log(`✅ Test subscription activated in database for user ${chatId}`);
          
          // Send success message after activation
          await sendMessageViaTelegram(
            chatId,
            "🎉 *Test subscription activated successfully!* (Dev Environment)\n\n" +
            "Your 7-day test subscription is now active. You can now start your daily English lessons!",
            env,
            { 
              parse_mode: 'Markdown',
              reply_markup: { 
                inline_keyboard: [
                  [{ text: "Start Lesson Now", callback_data: "lesson:start" }]
                ]
              }
            }
          );
          
        } catch (error) {
          console.error('Error activating test subscription:', error);
          
          // Send error message
          await sendMessageViaTelegram(
            chatId, 
            `❌ *Test payment failed* (Dev Mode)\n\nError: ${error.message}`, 
            env, 
            { parse_mode: 'Markdown' }
          );
        }
        
        return new Response('OK');
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

      // 5. everything else - send help message
      console.log("Unknown message type, sending help");
      await sendMessageViaTelegram(chatId, 
        "👋 Добро пожаловать в LinguaPulse! Используйте /start для начала.", 
        env);
      return new Response('OK');
    } catch (error) {
      console.error("Unhandled error in telegram-webhook:", error, error.stack);
      
      // Try to inform the user about the error
      try {
        const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
        if (chatId) {
          await sendMessageViaTelegram(chatId, 
            "⚙️ Sorry, a technical error occurred. Please try your request again in a moment. If the problem persists, you can use /start to begin again.", 
            env);
        }
      } catch (sendError) {
        console.error("Fatal: Failed to send error message to user:", sendError);
      }
      
      // Always return 200 OK to Telegram to avoid retries and getting banned
      return new Response('OK');
    }
  }
};

// Порядок вопросов опросника (должен совпадать с Lambda)
const QUESTION_ORDER = [
  'language_level',
  'study_goal', 
  'gender',
  'age',
  'telegram_preference',
  'voice_usage'
];

function getNextQuestion(currentQuestion) {
  const currentIndex = QUESTION_ORDER.indexOf(currentQuestion);
  if (currentIndex === -1 || currentIndex >= QUESTION_ORDER.length - 1) {
    return null; // No more questions
  }
  return QUESTION_ORDER[currentIndex + 1];
}

// Ensure a base row exists in user_profiles for the given telegram_id
async function ensureUserProfileExists(db, chatId) {
  try {
    await db
      .prepare(
        `INSERT INTO user_profiles (telegram_id, created_at)
         VALUES (?, datetime('now'))
         ON CONFLICT(telegram_id) DO NOTHING`
      )
      .bind(parseInt(chatId, 10))
      .run();
  } catch (e) {
    // Fallback for schemas without created_at
    try {
      await db
        .prepare(
          `INSERT INTO user_profiles (telegram_id)
           VALUES (?)
           ON CONFLICT(telegram_id) DO NOTHING`
        )
        .bind(parseInt(chatId, 10))
        .run();
    } catch (inner) {
      console.error('ensureUserProfileExists failed:', inner);
      throw inner;
    }
  }
}

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
    const signature = request.headers.get('trbt-signature') || request.headers.get('X-Tribute-Signature');
    if (signature) {
      console.log('Provided signature:', signature);
    }
    
    // Check if this is a dev mode test webhook
    const isDevModeTest = env.DEV_MODE === 'true' && signature === 'test_signature_dev_mode';
    if (isDevModeTest) {
      console.log('🧪 Processing as DEV MODE test webhook');
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
    // OR if this is a dev mode test with status "completed"
    if (event.name === 'new_subscription' || (isDevModeTest && event.status === 'completed')) {
      isNewSubscription = true;
      console.log('Identified as new subscription');
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
    // For dev mode test, calculate expiry based on subscription_duration_days
    else if (isDevModeTest && event.subscription_duration_days) {
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + event.subscription_duration_days);
      console.log(`Dev mode: calculated expiry date from duration (${event.subscription_duration_days} days)`);
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
          return new Response(`User ${userId} not found in database. Please complete the onboarding first.`, { 
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
          await sendMessageViaTelegram(userId,
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
      await sendMessageViaTelegram(userId,
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

// Function to send Tribute channel link for subscription
async function sendTributeChannelLink(chatId, env) {
  console.log(`[DEBUG] sendTributeChannelLink called for user ${chatId}`);
  
  // Helper function for localization in sendTributeChannelLink
  async function getUserLanguageForTribute() {
    try {
      const { results } = await env.USER_DB
        .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
        .bind(parseInt(chatId, 10))
        .all();
      return results.length > 0 ? results[0].interface_language : 'en';
    } catch (error) {
      console.error('Error getting user language for tribute:', error);
      return 'en';
    }
  }

  const tributeTexts = {
    en: {
      title: "🔑 *To unlock premium lessons, please subscribe:*",
      step1: "1️⃣ Click the button below to open the subscription page",
      step2: "2️⃣ Complete the payment process",
      step3: "3️⃣ After payment, you'll receive a confirmation message from the bot",
      benefit: "🎯 *Your subscription will give you access to daily personalized English lessons!*",
      subscribeButton: "Subscribe for 600₽/month",
      testButton: "🧪 TEST PAYMENT (Dev Only)"
    },
    ru: {
      title: "🔑 *Для доступа к премиум урокам, пожалуйста, подпишитесь:*",
      step1: "1️⃣ Нажмите кнопку ниже, чтобы открыть страницу подписки",
      step2: "2️⃣ Завершите процесс оплаты",
      step3: "3️⃣ После оплаты вы получите подтверждающее сообщение от бота",
      benefit: "🎯 *Ваша подписка даст вам доступ к ежедневным персонализированным урокам английского!*",
      subscribeButton: "Подписаться за 600₽/месяц",
      testButton: "🧪 ТЕСТОВАЯ ОПЛАТА (Только разработка)"
    }
  };

  function getTributeText(lang, key) {
    return tributeTexts[lang]?.[key] || tributeTexts.en[key] || key;
  }

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
          tributeAppLink = "https://t.me/tribute/app?startapp=swvs"; // Запасная ссылка на Tribute
  }
  
  // Проверяем, что ссылка имеет корректный формат
  if (tributeAppLink && !tributeAppLink.match(/^https?:\/\//)) {
    console.warn(`[DEBUG] Tribute link doesn't start with http:// or https://, fixing: ${tributeAppLink}`);
    tributeAppLink = "https://" + tributeAppLink.replace(/^[\/\\]+/, '');
  }

  const userLang = await getUserLanguageForTribute();
  const message = `${getTributeText(userLang, 'title')}\n\n` +
                 `${getTributeText(userLang, 'step1')}\n` +
                 `${getTributeText(userLang, 'step2')}\n` +
                 `${getTributeText(userLang, 'step3')}\n\n` +
                 `${getTributeText(userLang, 'benefit')}`;
  
  // Prepare buttons array
  const buttons = [];
  
  // Always add the real subscription button if link is available
  if (tributeAppLink) {
    buttons.push([{ text: getTributeText(userLang, 'subscribeButton'), url: tributeAppLink }]);
  }
  
  // Add test payment button ONLY in dev mode
  if (env.DEV_MODE === 'true') {
    buttons.push([{ text: getTributeText(userLang, 'testButton'), callback_data: "test:payment" }]);
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

/* ──── helper: escape MarkdownV2 special characters ──── */
function escapeMarkdownV2(text) {
  // Экранируем только самые проблемные символы для MarkdownV2
  // НЕ трогаем * (жирный) и | (для спойлеров)
  return text.replace(/([_\[\]()~`>#+={}\.!-])/g, '\\$1');
}

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
    console.log(`[DEBUG] parse_mode in payload:`, payload.parse_mode);
    
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
    
    // Get user language for subscription button localization
    let userLang = 'en';
    try {
      const { results } = await env.USER_DB
        .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
        .bind(parseInt(chatId, 10))
        .all();
      userLang = results.length > 0 ? results[0].interface_language : 'en';
    } catch (error) {
      console.error('Error getting user language for subscription button:', error);
    }
    
    const subscribeButtonText = userLang === 'ru' ? 'Подписаться за 600₽/месяц' : 'Subscribe for 600₽/month';
    
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
      tributeAppLink = "https://t.me/tribute/app?startapp=swvs"; // Запасная ссылка на Tribute
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
          inline_keyboard: [[{ text: subscribeButtonText, url: tributeAppLink }]]
        };
      } else {
        // Уже есть кнопки
        if (!messageOptions.reply_markup.inline_keyboard) {
          // Нет именно inline_keyboard, создаем ее
          messageOptions.reply_markup.inline_keyboard = [[{ text: subscribeButtonText, url: tributeAppLink }]];
        } else {
          // Есть inline_keyboard, добавляем новую строку с кнопкой
          messageOptions.reply_markup.inline_keyboard.push([{ text: subscribeButtonText, url: tributeAppLink }]);
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
    
    // Determine correct bot token based on environment
    let botToken;
    if (env.DEV_MODE === 'true') {
      // Dev environment - use DEV_BOT_TOKEN
      botToken = env.DEV_BOT_TOKEN;
      if (!botToken) {
        console.error(`[DEBUG] DEV_MODE is true but DEV_BOT_TOKEN is missing`);
        throw new Error("DEV_BOT_TOKEN is required in dev environment");
      }
      console.log(`[DEBUG] Using DEV_BOT_TOKEN for dev environment`);
    } else {
      // Production environment - use BOT_TOKEN
      botToken = env.BOT_TOKEN;
      if (!botToken) {
        console.error(`[DEBUG] Production environment but BOT_TOKEN is missing`);
        throw new Error("BOT_TOKEN is required in production environment");
      }
      console.log(`[DEBUG] Using BOT_TOKEN for production environment`);
    }
    
    const apiUrl = `https://api.telegram.org/bot${botToken}/${method}`;
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

/* ──── helper: call AWS Lambda function ──── */
async function callLambdaFunction(functionName, payload, env) {
  try {
    console.log(`🔄 [LAMBDA] Calling ${functionName} with payload:`, JSON.stringify(payload).substring(0, 300));
    
    // Use environment variable for Lambda URL
    const lambdaUrl = env[`${functionName.toUpperCase()}_URL`];
    if (!lambdaUrl) {
      console.error(`❌ [LAMBDA] ${functionName === 'onboarding' ? 'ONBOARDING_URL' : `${functionName.toUpperCase()}_URL`} not found in environment`);
      throw new Error(`${functionName === 'onboarding' ? 'ONBOARDING_URL' : `${functionName.toUpperCase()}_URL`} not configured`);
    }
    
    const response = await fetch(lambdaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.AWS_LAMBDA_TOKEN || 'default-token'}`
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [LAMBDA] ${functionName} error:`, response.status, errorText);
      throw new Error(`Lambda ${functionName} error: ${response.status}`);
    }
    
    const result = await response.json();
    console.log(`✅ [LAMBDA] ${functionName} call successful`);
    return result;
  } catch (error) {
    console.error(`❌ [LAMBDA] Error calling ${functionName}:`, error);
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

/* ──── helper: handle lesson command ──── */
async function handleLessonCommand(chatId, env) {
  try {
    console.log(`handleLessonCommand started for user ${chatId}`);
    
    // Helper function for localization
    async function getUserLanguageForLessons() {
      try {
        const { results } = await env.USER_DB
          .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        return results.length > 0 ? results[0].interface_language : 'en';
      } catch (error) {
        console.error('Error getting user language for lessons:', error);
        return 'en';
      }
    }
    
    const lessonTexts = {
      en: {
        profileTitle: '📊 *Your Language Profile*',
        levelLabel: '🎯 *Level:*',
        subscriptionLabel: '💳 *Subscription:*',
        totalLessonsLabel: '📚 *Total lessons:*',
        currentStreakLabel: '🔥 *Current streak:*',
        days: 'days',
        subscriptionActive: 'Active',
        subscriptionInactive: 'Inactive - Subscribe to continue learning',
        welcomeMessage: 'Welcome! Let\'s start with a quick setup. Use /start to begin.',
        freeLessonOffer: 'You haven\'t taken your free introductory lesson yet.',
        freeLessonButton: 'Free audio lesson',
        subscriptionExpired: 'Your subscription has expired or you haven\'t subscribed yet.',
        nextLessonWait: 'Your next lesson will be available in *{time}*.',
        lessonAvailable: '*Your next lesson is available now!*',
        startLessonButton: 'Start lesson',
        errorMessage: 'Sorry, there was an error processing your command. Please try again later or contact support.'
      },
      ru: {
        profileTitle: '📊 *Ваш языковой профиль*',
        levelLabel: '🎯 *Уровень:*',
        subscriptionLabel: '💳 *Подписка:*',
        totalLessonsLabel: '📚 *Всего уроков:*',
        currentStreakLabel: '🔥 *Текущая серия:*',
        days: 'дней',
        subscriptionActive: 'Активна',
        subscriptionInactive: 'Неактивна - Подпишитесь для продолжения обучения',
        welcomeMessage: 'Добро пожаловать! Давайте начнем с быстрой настройки. Используйте /start для начала.',
        freeLessonOffer: 'Вы еще не прошли бесплатный вводный урок.',
        freeLessonButton: 'Бесплатный аудио урок',
        subscriptionExpired: 'Ваша подписка истекла или вы еще не подписались.',
        nextLessonWait: 'Ваш следующий урок будет доступен через *{time}*.',
        lessonAvailable: '*Ваш следующий урок доступен прямо сейчас!*',
        startLessonButton: 'Начать урок',
        errorMessage: 'Извините, произошла ошибка при обработке команды. Попробуйте позже или обратитесь в поддержку.'
      }
    };
    
    function getLessonText(lang, key, replacements = {}) {
      let text = lessonTexts[lang]?.[key] || lessonTexts.en[key] || key;
      // Handle replacements like {time}
      Object.keys(replacements).forEach(replaceKey => {
        text = text.replace(`{${replaceKey}}`, replacements[replaceKey]);
      });
      return text;
    }
    
    // Get user profile with all necessary fields
    console.log(`Querying database for user ${chatId}`);
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    console.log(`Database query results for user ${chatId}:`, results.length ? "Found" : "Not found");
    
    if (!results.length) {
      console.log(`User ${chatId} not found, sending onboarding message`);
      const userLang = await getUserLanguageForLessons();
      await sendMessageViaTelegram(chatId, 
        getLessonText(userLang, 'welcomeMessage'), env);
      return;
    }
    
    const profile = results[0];
    console.log(`User ${chatId} profile:`, {
      pass_lesson0_at: !!profile.pass_lesson0_at,
      subscription_expired_at: profile.subscription_expired_at,
      next_lesson_access_at: profile.next_lesson_access_at
    });
    
    // Get user's language level from survey
    const { results: surveyResults } = await env.USER_DB
      .prepare('SELECT language_level FROM user_survey WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    const userLevel = surveyResults.length > 0 ? surveyResults[0].language_level : 'Intermediate';
    console.log(`User ${chatId} language level from survey: ${userLevel}`);
    
    // Basic profile info (use survey completion date instead of legacy tested_at)
    const testedAt = surveyResults.length > 0 && surveyResults[0].completed_at
      ? new Date(surveyResults[0].completed_at).toLocaleDateString()
      : 'N/A';
    const lessonsTotal = profile.number_of_lessons || 0;
    const lessonsStreak = profile.lessons_in_row || 0;
    
    // Check subscription status (simple version)
    const now = new Date();
    const hasActiveSubscription = profile.subscription_expired_at && 
                                (new Date(profile.subscription_expired_at) > now);
    
    const userLang = await getUserLanguageForLessons();
    const subscriptionStatus = hasActiveSubscription ? 
      getLessonText(userLang, 'subscriptionActive') : 
      getLessonText(userLang, 'subscriptionInactive');
    
    let message = `${getLessonText(userLang, 'profileTitle')}\n\n` +
      `${getLessonText(userLang, 'levelLabel')} ${userLevel}\n` +
      `${getLessonText(userLang, 'subscriptionLabel')} ${subscriptionStatus}\n` +
      `${getLessonText(userLang, 'totalLessonsLabel')} ${lessonsTotal}\n` +
      `${getLessonText(userLang, 'currentStreakLabel')} ${lessonsStreak} ${getLessonText(userLang, 'days')}\n\n`;
    
    // Check pass_lesson0_at first
    if (!profile.pass_lesson0_at) {
      console.log(`User ${chatId} hasn't taken free lesson, offering free lesson`);
      
      // Free lesson not taken yet - show button
      console.log(`User ${chatId} has completed onboarding, showing free lesson button`);
      message += getLessonText(userLang, 'freeLessonOffer');
      await sendMessageViaTelegram(chatId, message, env, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: getLessonText(userLang, 'freeLessonButton'), callback_data: 'lesson:free' }]]
        }
      });
      return;
    }
    
    // Check subscription status
    const subExpiredAt = profile.subscription_expired_at ? new Date(profile.subscription_expired_at) : null;
    
    if (!subExpiredAt || subExpiredAt.getTime() < now.getTime()) {
      console.log(`User ${chatId} subscription expired or not present, showing subscribe button`);
      // No active subscription or it's expired - show subscribe button to Tribute channel
      message += getLessonText(userLang, 'subscriptionExpired');
      await sendTributeChannelLink(chatId, env);
      return;
    }
    
    // Active subscription - show next lesson access time
    const nextLessonAt = profile.next_lesson_access_at ? new Date(profile.next_lesson_access_at) : null;
    
    if (nextLessonAt && nextLessonAt.getTime() > now.getTime()) {
      console.log(`User ${chatId} lesson not yet available, showing wait message`);
      // Format the time until next lesson
      const timeUntil = formatTimeUntil(nextLessonAt);
      message += getLessonText(userLang, 'nextLessonWait', { time: timeUntil });
      // CRITICAL FIX: Use sendMessageViaTelegram because user already has active subscription
      await sendMessageViaTelegram(chatId, message, env, { parse_mode: 'Markdown' });
      return;
    }
    
    console.log(`User ${chatId} lesson available now, showing start lesson button`);
    // Lesson is available now
    message += getLessonText(userLang, 'lessonAvailable');
    
    console.log(`🎯 [${chatId}] About to send "Start lesson" button with callback_data: "lesson:start"`);
    // CRITICAL FIX: Use sendMessageViaTelegram instead of sendMessageWithSubscriptionCheck
    // because we already confirmed the user has active subscription above
    await sendMessageViaTelegram(chatId, message, env, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: getLessonText(userLang, 'startLessonButton'), callback_data: 'lesson:start' }]]
      }
    });
    console.log(`✅ [${chatId}] "Start lesson" button sent successfully`);
    
    console.log(`handleLessonCommand completed successfully for user ${chatId}`);
  } catch (error) {
    console.error(`Error in handleLessonCommand for user ${chatId}:`, error);
    // Try to send a fallback message
    try {
      const userLang = await getUserLanguageForLessons();
      await sendMessageViaTelegram(chatId, 
        getLessonText(userLang, 'errorMessage'), 
        env);
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
      // Absolute fallback in English
      try {
        await sendMessageViaTelegram(chatId, 
          "Sorry, there was an error processing your command. Please try again later or contact support.", 
          env);
      } catch (finalError) {
        console.error("Final fallback also failed:", finalError);
      }
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
// ВРЕМЕННО ЗАКОММЕНТИРОВАНО - старая логика с USER_DB
/*
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
*/

// ВРЕМЕННАЯ ЗАГЛУШКА
async function hasActiveSubscription(chatId, env) {
  console.log(`[DEBUG] hasActiveSubscription stub - returning false for user ${chatId}`);
  return false;
}
// Test comment

// ==================== AUDIO FUNCTIONS ====================
// Ported from main-lesson.js for audio dialog functionality

// Generate TTS with OpenAI
async function openaiTTS(text, env) {
  const res = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${env.OPENAI_KEY}`, 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ 
      model: 'tts-1', 
      voice: 'sage', 
      format: 'ogg_opus', 
      input: text 
    })
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`OpenAI TTS error: ${errorText}`);
  }
  
  return res.arrayBuffer();
}

// Send voice message via Telegram
async function telegramSendVoice(chatId, buf, dur, env) {
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('duration', dur);
  fd.append('voice', new File([buf], 'voice.ogg', { type: 'audio/ogg; codecs=opus' }));
  
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVoice`, 
    { method: 'POST', body: fd }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram sendVoice error: ${errorText}`);
  }
}

// Calculate audio duration (from main-lesson.js)
function calculateDuration(buf) {
  // More accurate duration calculation based on Opus encoding
  // For Opus format at speech quality, estimate roughly 20KB per second
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 20000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
}

// Generate conversation response (copied from main-lesson.js - NO FEEDBACK)
async function generateSimpleConversationResponse(userText, chatId, env) {
  try {
    // Simple conversation prompt without feedback (like main-lesson.js)
    const systemPrompt = "You are a professional English language tutor having a conversation with a paying subscriber. " +
      "Keep your responses conversational but educational, supportive, and engaging. " +
      "Ask follow-up questions that challenge the student appropriately for their level. " +
      "Your goal is to help the student practice their English in a natural way while gradually improving. " +
      "Keep responses fairly short (1-3 sentences) to maintain a flowing conversation. " +
      "Try to correct major grammar errors indirectly by rephrasing what they said correctly in your response.";
    
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText }
    ];
    
    console.log(`🤖 [${chatId}] Calling OpenAI for simple conversation response`);
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${env.OPENAI_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messages,
        temperature: 0.7,
        max_tokens: 150 // Keep responses short
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const response = j.choices[0].message.content.trim();
    console.log(`✅ [${chatId}] Simple conversation response received:`, response);
    
    return response;
  } catch (error) {
    console.error(`❌ [${chatId}] Error generating conversation response:`, error);
    return "I'm sorry, I had trouble understanding. Could you try again?";
  }
}

// Send TTS audio message safely with attempt limiting
async function safeSendTTS(chatId, text, env) {
  const t = text.trim();
  if (!t) {
    console.log(`safeSendTTS: Empty text provided for user ${chatId}`);
    return false;
  }

  console.log(`🎤 [${chatId}] Starting TTS generation for: "${t.substring(0, 50)}${t.length > 50 ? '...' : ''}"`);

  // Limit TTS attempts to 2 per text to avoid excessive costs
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`🔊 [${chatId}] TTS attempt ${attempts}/${maxAttempts}`);
    
    try {
      // Step 1: Generate TTS with OpenAI
      console.log(`🔊 [${chatId}] Step 1: Calling OpenAI TTS`);
      const rawBuf = await openaiTTS(t, env);
      console.log(`✅ [${chatId}] OpenAI TTS successful, buffer size: ${rawBuf.byteLength} bytes`);
      
      // Step 2: Convert to Telegram-compatible format with Transloadit
      console.log(`🔄 [${chatId}] Step 2: Converting audio with Transloadit`);
      const voipBuf = await encodeVoipWithTransloadit(rawBuf, env);
      console.log(`✅ [${chatId}] Transloadit conversion successful, buffer size: ${voipBuf.byteLength} bytes`);
      
      // Step 3: Calculate duration and send
      const dur = calculateDuration(voipBuf);
      console.log(`📱 [${chatId}] Step 3: Sending voice message to Telegram (duration: ${dur}s)`);
      await telegramSendVoice(chatId, voipBuf, dur, env);
      console.log(`🎉 [${chatId}] Voice message sent successfully!`);
      
      // Add a small delay after sending audio to prevent flooding
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Send text transcription under spoiler
      console.log(`📝 [${chatId}] Sending text transcription and translation`);
      
      // Send English transcription
      const transcriptionMessage = `English:\n<tg-spoiler>${t}</tg-spoiler>`;
      await sendMessageViaTelegram(chatId, transcriptionMessage, env, {
        parse_mode: 'HTML'
      });
      
      // Add small delay between messages
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Generate Russian translation via Lambda
      const translationPayload = {
        user_id: chatId,
        action: 'process_text_message',
        message: `Translate to Russian: "${t}"`,
        mode: 'translation'
      };
      
      try {
        console.log(`🔄 [${chatId}] Calling Lambda for translation:`, translationPayload);
        const translationResponse = await callLambdaFunction('onboarding', translationPayload, env);
        console.log(`📝 [${chatId}] Translation response:`, translationResponse);
        
        if (translationResponse && translationResponse.reply) {
          const russianTranslation = translationResponse.reply;
          const translationMessage = `Перевод:\n<tg-spoiler>${russianTranslation}</tg-spoiler>`;
          await sendMessageViaTelegram(chatId, translationMessage, env, {
            parse_mode: 'HTML'
          });
          console.log(`✅ [${chatId}] Transcription and translation sent successfully`);
        } else {
          console.error(`❌ [${chatId}] Invalid translation response:`, translationResponse);
        }
      } catch (error) {
        console.error(`❌ [${chatId}] Translation error:`, error);
        // Send just transcription if translation fails
        console.log(`✅ [${chatId}] Transcription sent successfully (translation failed)`);
      }
      
      return true;
    } catch (e) {
      console.error(`❌ [${chatId}] TTS attempt ${attempts} failed:`, e.message);
      
      if (attempts >= maxAttempts) {
        console.error(`🚫 [${chatId}] All TTS attempts exhausted, falling back to text`);
        
        // Fallback to text if all TTS attempts fail
        try {
          console.log(`📝 [${chatId}] Falling back to text message`);
          await sendMessageViaTelegram(chatId, "📝 " + t, {}, env);
          console.log(`✅ [${chatId}] Fallback text message sent successfully`);
          return true; // Text was sent successfully
        } catch (fallbackError) {
          console.error(`❌ [${chatId}] Fallback text message also failed:`, fallbackError);
          return false;
        }
      }
      
      // Continue to next attempt
      console.log(`🔄 [${chatId}] Retrying TTS generation...`);
    }
  }
  
  return false;
}

// Convert audio to Telegram-compatible format with Transloadit
async function encodeVoipWithTransloadit(buf, env) {
  console.log("Starting Transloadit encoding, input buffer size:", buf.byteLength);
  
  // Проверка необходимых переменных окружения
  if (!env.TRANSLOADIT_KEY || !env.TRANSLOADIT_TPL) {
    console.error("Missing Transloadit credentials. TRANSLOADIT_KEY or TRANSLOADIT_TPL not set.");
    throw new Error("Transloadit configuration missing");
  }
  
  const params = { 
    auth: { key: env.TRANSLOADIT_KEY }, 
    template_id: env.TRANSLOADIT_TPL, 
    fields: { filename: 'src.ogg' } 
  };
  
  console.log("Transloadit params:", JSON.stringify({
    template_id: env.TRANSLOADIT_TPL,
    key_length: env.TRANSLOADIT_KEY ? env.TRANSLOADIT_KEY.length : 0
  }));
  
  const fd = new FormData();
  fd.append('params', JSON.stringify(params));
  fd.append('file', new File([buf], 'src.ogg', { type: 'audio/ogg' }));
  
  console.log("Sending request to Transloadit API");
  let initResponse;
  try {
    const response = await fetch('https://api2.transloadit.com/assemblies', { 
      method: 'POST', 
      body: fd 
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error("Transloadit API response error:", response.status, errorText);
      throw new Error(`Transloadit API error: ${response.status} ${errorText}`);
    }
    
    initResponse = await response.json();
    console.log("Transloadit assembly initiated:", initResponse.assembly_id);
  } catch (error) {
    console.error("Error initiating Transloadit assembly:", error);
    throw new Error(`Transloadit assembly initiation failed: ${error.message}`);
  }
  
  try {
    console.log("Waiting for Transloadit assembly to complete...");
    const done = await waitAssembly(initResponse.assembly_ssl_url, 90000);
    
    if (!done.results || !done.results['encoded-audio'] || !done.results['encoded-audio'][0]) {
      console.error("Invalid Transloadit result structure:", JSON.stringify(done));
      throw new Error("Invalid Transloadit result");
    }
    
    const url = done.results['encoded-audio'][0].ssl_url;
    console.log("Transloadit processing complete, downloading result from:", url);
    
    const audioResponse = await fetch(url);
    if (!audioResponse.ok) {
      throw new Error(`Error downloading processed audio: ${audioResponse.status}`);
    }
    
    const audioBuffer = await audioResponse.arrayBuffer();
    console.log("Downloaded processed audio, size:", audioBuffer.byteLength);
    return audioBuffer;
  } catch (error) {
    console.error("Error in Transloadit processing:", error);
    throw new Error(`Transloadit processing failed: ${error.message}`);
  }
}

// Wait for Transloadit assembly to complete
async function waitAssembly(url, ms) {
  console.log("Polling Transloadit assembly status at:", url);
  const start = Date.now();
  let lastStatus = "";
  
  while (Date.now() - start < ms) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.error("Error fetching assembly status:", response.status);
        throw new Error(`Assembly status error: ${response.status}`);
      }
      
      const j = await response.json();
      
      // Log only if status changed
      if (j.ok !== lastStatus) {
        console.log("Transloadit assembly status:", j.ok, 
                    j.message ? `(${j.message})` : "",
                    j.error ? `ERROR: ${j.error}` : "");
        lastStatus = j.ok;
      }
      
      if (j.ok === 'ASSEMBLY_COMPLETED') {
        console.log("Transloadit assembly completed successfully");
        return j;
      }
      
      if (j.error) {
        throw new Error(`Assembly error: ${j.error}`);
      }
      
      await new Promise(r => setTimeout(r, 1000));
    } catch (error) {
      console.error("Error polling assembly status:", error);
      // Continue polling despite errors
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  throw new Error(`Transloadit timeout after ${ms}ms`);
}
