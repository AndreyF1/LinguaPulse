// linguapulse-lesson0-bot worker.js
// CONFIG:
// - D1 binding: USER_DB
// - KV binding for conversation history: CHAT_KV
// - Env vars: OPENAI_KEY, BOT_TOKEN, TRANSLOADIT_KEY, TRANSLOADIT_TPL, SYSTEM_PROMPT

// Localization texts
const TEXTS = {
  en: {
    alreadyCompleted: "You've already completed your free trial lesson. If you'd like to continue practicing English, you can subscribe for just 600₽ per month. This gives you access to one extended lesson every day with personalized feedback.",
    subscribeWeekly: "Subscribe for 600₽/month",
    welcomeMessage: "🎧 *Welcome to your free English conversation practice!* Please listen to the audio and respond with a voice message.",
    voiceInstructions: "🎤 *How to send voice messages:*\n\n• In the bottom right corner of your screen, find the rightmost icon – this could be a circle in a square (for video messages) or a microphone.\n• If you see a circle in a square, tap it once briefly to switch the icon to a microphone.\n• Now press and hold the microphone icon to start recording.\n• Speak clearly and calmly.\n• When you finish speaking, release the icon. Your message will be sent automatically.",
    startingLesson: "Starting free audio lesson…",
    historyError: "I couldn't retrieve your conversation history. Please use /lesson to start a new practice session.",
    processingError: "There was an error processing your lesson. Please use /lesson to start a new practice session.",
    sessionEnded: "It seems your previous lesson has ended. Please use /lesson to start a new practice session.",
    farewellMessage: "That concludes our English practice session for today. You've done really well! I'll analyze your speaking and provide feedback now. Thank you for practicing with me!",
    analyzingSpeaking: "🔍 *Analyzing your speaking...*",
    feedbackTitle: "📝 *Your Language Feedback*\n\nHere's a detailed analysis of your speaking during our conversation:",
    overallAssessment: "🌟 *Overall Assessment*\n\nYou demonstrated good effort in communicating in English. With continued practice, you'll see significant improvements in fluency, grammar accuracy, and vocabulary usage. I recommend practicing daily conversations like this to build confidence and speaking skills.",
    subscriptionOffer: "To unlock daily personalized audio lessons, you can subscribe for just 600₽ per month.",
    fallbackResponse: "I didn't quite catch that. Could you please repeat?",
    fallbackGreeting: "Hi there! I'm your English practice partner today. How are you feeling, and what would you like to talk about?",
    chatGptFallback: "I'd love to hear more about that. Could you tell me more?",
    analysisError: "Sorry, I couldn't analyze this particular response.",
    technicalError: "⚙️ Sorry, a technical error occurred during the free lesson. Please use /start to try again.",
    suggestionText: "You can use the following text below for your audio response. You can ignore it and come up with your own answer"
  },
  ru: {
    alreadyCompleted: "Вы уже прошли бесплатный пробный урок. Если хотите продолжить изучение английского, вы можете подписаться всего за 600₽ в месяц. Это даст вам доступ к одному расширенному уроку каждый день с персональной обратной связью.",
    subscribeWeekly: "Подписаться за 600₽/месяц",
    welcomeMessage: "🎧 *Добро пожаловать на бесплатную практику английского разговора!* Пожалуйста, прослушайте аудио и ответьте голосовым сообщением.",
    voiceInstructions: "🎤 *Как отправлять голосовые сообщения:*\n\n• В правом нижнем углу экрана найдите самую правую иконку – это может быть кружочек в квадрате (для видеосообщений) или микрофон.\n• Если вы видите кружочек в квадрате, коротко нажмите на нее один раз, чтобы иконка переключилась на микрофон.\n• Теперь нажмите и удерживайте иконку микрофона, чтобы начать запись.\n• Говорите четко и спокойно.\n• Когда закончите говорить, отпустите иконку. Ваше сообщение будет автоматически отправлено.",
    startingLesson: "Начинаем бесплатный аудио урок…",
    historyError: "Не удалось получить историю разговора. Пожалуйста, используйте /lesson чтобы начать новую практику.",
    processingError: "Произошла ошибка при обработке урока. Пожалуйста, используйте /lesson чтобы начать новую практику.",
    sessionEnded: "Кажется, ваш предыдущий урок завершился. Пожалуйста, используйте /lesson чтобы начать новую практику.",
    farewellMessage: "На этом наша практика английского языка на сегодня завершается. Вы очень хорошо поработали! Сейчас я проанализирую вашу речь и дам обратную связь. Спасибо за практику со мной!",
    analyzingSpeaking: "🔍 *Анализирую вашу речь...*",
    feedbackTitle: "📝 *Обратная связь по языку*\n\nВот подробный анализ вашей речи во время нашего разговора:",
    overallAssessment: "🌟 *Общая оценка*\n\nВы продемонстрировали хорошие усилия в общении на английском языке. При продолжении практики вы увидите значительные улучшения в беглости, грамматической точности и использовании словарного запаса. Рекомендую практиковать ежедневные разговоры, подобные этому, чтобы развить уверенность и навыки говорения.",
    subscriptionOffer: "Чтобы получить доступ к ежедневным персонализированным аудио урокам, вы можете подписаться всего за 600₽ в месяц.",
    fallbackResponse: "Я не совсем понял. Не могли бы вы повторить?",
    fallbackGreeting: "Привет! Я ваш партнер по практике английского на сегодня. Как дела, и о чем бы вы хотели поговорить?",
    chatGptFallback: "Мне бы хотелось услышать об этом больше. Не могли бы вы рассказать подробнее?",
    analysisError: "Извините, я не смог проанализировать этот конкретный ответ.",
    technicalError: "⚙️ Извините, произошла техническая ошибка во время бесплатного урока. Пожалуйста, используйте /start чтобы попробовать снова.",
    suggestionText: "Ты можешь использовать следующий текст ниже для аудио-ответа. Можешь проигнорировать и придумать свой ответ"
  }
};

// Function to get user's interface language
async function getUserLanguage(chatId, db) {
  try {
    const { results } = await db.prepare(
      `SELECT interface_language FROM user_preferences WHERE telegram_id = ?`
    )
    .bind(parseInt(chatId, 10))
    .all();
    
    return results.length > 0 ? results[0].interface_language : 'en';
  } catch (error) {
    console.error('Error getting user language:', error);
    return 'en'; // Default to English
  }
}

// Function to get user's language level from survey
async function getUserLanguageLevel(chatId, db) {
  try {
    const { results } = await db.prepare(
      `SELECT language_level FROM user_survey WHERE telegram_id = ?`
    )
    .bind(parseInt(chatId, 10))
    .all();
    
    return results.length > 0 ? results[0].language_level : null;
  } catch (error) {
    console.error('Error getting user language level:', error);
    return null;
  }
}

// Function to get localized text
function getText(language, key) {
  return TEXTS[language] && TEXTS[language][key] ? TEXTS[language][key] : TEXTS['en'][key];
}

export default {
  async fetch(request, env, ctx) {
    let raw; // Declared here to be accessible in the final catch block
    try {
      raw = await request.json();
      console.log('Lesson0-bot raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      const chatId = raw.user_id || raw.message?.chat?.id;
      if (!chatId) return new Response('OK');

      const db = env.USER_DB;
      const kv = env.CHAT_KV;
      
      // Get user's interface language
      const userLang = await getUserLanguage(chatId, db);
      console.log(`User ${chatId} interface language: ${userLang}`);

      // A) Start free lesson trigger
      if (raw.action === 'start_free') {
        // Check if the user has already completed the free lesson
        const { results } = await db.prepare(
          `SELECT eng_level, pass_lesson0_at FROM user_profiles 
           WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        // If user already completed the lesson, show subscription offer instead
        if (results.length > 0 && results[0].pass_lesson0_at) {
          await sendText(
            chatId, 
            getText(userLang, 'alreadyCompleted'),
            env,
            [[{ text: getText(userLang, 'subscribeWeekly'), callback_data: "subscribe:weekly" }]]
          );
          return new Response('OK');
        }
        
        // ИСПРАВЛЕНИЕ ПОРЯДКА: Сначала отправляем приветствие, затем начинаем урок
        // 1. Отправляем сообщение о начале урока
        await sendText(chatId, getText(userLang, 'welcomeMessage'), env);
        
        // 2-second delay before voice instructions
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // 2. Send voice instructions with GIF
        try {
          await sendGif(
            chatId, 
            "https://i.gifer.com/3OxNa.gif", 
            getText(userLang, 'voiceInstructions'), 
            env
          );
        } catch (gifError) {
          console.error("Failed to send GIF, sending text instructions only:", gifError);
          // Fallback to text-only instructions if GIF fails
          await sendText(chatId, getText(userLang, 'voiceInstructions'), env);
        }
        
        // Record lesson start in database
        const now = new Date().toISOString();
        await db.prepare(
          `INSERT INTO user_profiles(telegram_id, start_lesson0_at)
             VALUES(?, ?)
             ON CONFLICT(telegram_id) DO UPDATE
             SET start_lesson0_at=excluded.start_lesson0_at`
        )
        .bind(parseInt(chatId, 10), now)
        .run();
        
        // Initialize empty history and create a new session ID
        const history = [];
        const sessionId = Date.now().toString();
        await safeKvPut(kv, `hist:${chatId}`, JSON.stringify(history));
        await safeKvPut(kv, `session:${chatId}`, sessionId);
        
        // 5-second delay before starting lesson message
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 3. Затем отправляем "Starting free audio lesson..." и генерируем первое приветствие
        await sendText(chatId, getText(userLang, 'startingLesson'), env);
        
        // Generate first GPT greeting
        await sendFirstGreeting(chatId, history, env, kv, userLang);
        return new Response('OK');
      }

      // B) Handle user voice message during lesson
      if (raw.message?.voice) {
        // Get message ID for deduplication
        const messageId = raw.message.message_id;
        const processedKey = `processed:${chatId}:${messageId}`;
        
        // Check if this exact message was already processed
        const alreadyProcessed = await safeKvGet(kv, processedKey);
        if (alreadyProcessed) {
          console.log(`Message ${messageId} already processed, ignoring duplicate`);
          return new Response('OK');
        }
        
        // Mark this message as being processed
        await safeKvPut(kv, processedKey, "1", { expirationTtl: 3600 }); // 1 hour TTL
        
        // Get conversation history
        const histKey = `hist:${chatId}`;
        const stored = await safeKvGet(kv, histKey) || '[]';
        let hist;
        
        // ДОПОЛНИТЕЛЬНАЯ ПРОВЕРКА: Убедиться, что история корректно парсится
        try {
          hist = JSON.parse(stored);
          
          // Проверка на валидность истории (но пустая история в начале урока - это нормально)
          if (!Array.isArray(hist)) {
            console.log("Invalid history found (not an array), resetting session");
            await sendText(chatId, getText(userLang, 'historyError'), env);
            
            // Очистить данные сессии
            await safeKvDelete(kv, histKey);
            await safeKvDelete(kv, `session:${chatId}`);
            return new Response('OK');
          }
        } catch (parseError) {
          console.error("Error parsing history:", parseError);
          await sendText(chatId, getText(userLang, 'processingError'), env);
            
          // Очистить данные сессии
          await safeKvDelete(kv, histKey);
          await safeKvDelete(kv, `session:${chatId}`);
          return new Response('OK');
        }
        
        // Check current session ID to avoid mixing test sessions
        const sessionKey = `session:${chatId}`;
        const currentSession = await safeKvGet(kv, sessionKey);
        if (!currentSession) {
          console.log("No active session found, message might be from an old test session");
          await sendText(chatId, getText(userLang, 'sessionEnded'), env);
          return new Response('OK');
        }
        
        // Check if user has already spoken and we're waiting for their response
        const lastMessage = hist.length > 0 ? hist[hist.length - 1] : null;
        if (lastMessage && lastMessage.role === 'user') {
          console.log("Last message was from user, waiting for bot response. Possible race condition.");
          return new Response('OK');
        }
        
        // Set a "processing" flag to prevent concurrent processing of messages
        const processingKey = `processing:${chatId}`;
        const isProcessing = await safeKvGet(kv, processingKey);
        
        if (isProcessing) {
          console.log("Already processing a message for this user, ignoring duplicate");
          return new Response('OK');
        }
        
        // Set processing flag with at least 60-second expiration (Cloudflare minimum)
        await safeKvPut(kv, processingKey, "1", { expirationTtl: 60 });
        
        try {
          // Transcribe user voice
          const userText = await transcribeVoice(raw.message.voice.file_id, env);
          console.log(`User said: ${userText}`);
          
          // Add user message to history
          hist.push({ role: 'user', content: userText });
          
          // ДЕТАЛЬНОЕ ЛОГИРОВАНИЕ: Отладочная информация о количестве сообщений
          console.log(`=== DETAILED HISTORY ANALYSIS ===`);
          console.log(`Full history after adding user message:`, JSON.stringify(hist, null, 2));
          console.log(`History length: ${hist.length}`);
          
          // Детально анализируем каждое сообщение
          for (let i = 0; i < hist.length; i++) {
            const msg = hist[i];
            console.log(`Message ${i}: role="${msg.role}", content="${msg.content.substring(0, 50)}..."`);
          }
          
          // УЛУЧШЕННАЯ ЛОГИКА: Используем выделенную функцию для подсчета сообщений
          const { userTurns, botTurns } = countTurns(hist);
          console.log(`=== TURN COUNT ANALYSIS ===`);
          console.log(`User turns: ${userTurns}, Bot turns: ${botTurns}`);
          console.log(`Total messages in history: ${hist.length}`);
          
          // Дополнительная проверка: ручной подсчет для сравнения
          const manualUserCount = hist.filter(h => h.role === 'user').length;
          const manualBotCount = hist.filter(h => h.role === 'assistant').length;
          console.log(`Manual count - User: ${manualUserCount}, Bot: ${manualBotCount}`);
          
          // Проверяем, что автоматический и ручной подсчет совпадают
          if (userTurns !== manualUserCount || botTurns !== manualBotCount) {
            console.error(`MISMATCH! Function count vs manual count differs!`);
          }
          
          // Сохраняем новое состояние истории с добавленным сообщением пользователя
          await safeKvPut(kv, histKey, JSON.stringify(hist));
          console.log(`History saved to KV with key: ${histKey}`);
          
          // УЛУЧШЕННАЯ ЛОГИКА: Проверяем конкретное количество сообщений пользователя
          // Завершаем урок только после 4+ полноценных реплик пользователя
          console.log(`=== LESSON COMPLETION CHECK ===`);
          console.log(`Checking if userTurns (${userTurns}) >= 4`);
          
          if (userTurns >= 4) {
            console.log(`=== FREE LESSON COMPLETION PHASE START ===`);
            console.log(`Ending free lesson after ${userTurns} user messages and ${botTurns} bot messages`);
            console.log(`Full history at completion: ${JSON.stringify(hist)}`);
            
            // Farewell message
            const bye = getText(userLang, 'farewellMessage');
            hist.push({ role: 'assistant', content: bye });
            await safeKvPut(kv, histKey, JSON.stringify(hist));
            await safeSendTTS(chatId, bye, env);

            // Send a transition message
            await sendText(chatId, getText(userLang, 'analyzingSpeaking'), env);
            console.log(`=== FREE LESSON FEEDBACK PHASE START ===`);
            
            // Grammar analysis of all user utterances
            const userUtterances = hist.filter(h => h.role === 'user').map(h => h.content);
            console.log(`Analyzing user utterances: ${JSON.stringify(userUtterances)}`);
            const analyses = await analyzeLanguage(userUtterances, env, userLang);
            
            // Send simplified feedback - single consolidated message
            if (analyses.length > 0) {
              await sendText(
                chatId, 
                getText(userLang, 'feedbackTitle'), 
                env
              );
              
              // Send single consolidated feedback
              const analysis = analyses[0];
              await sendText(
                chatId,
                analysis.feedback,
                env
              );
            }

            console.log(`=== FREE LESSON SUBSCRIPTION OFFER PHASE START ===`);
            // Subscription offer - sent after all feedback messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendText(
              chatId,
              getText(userLang, 'subscriptionOffer'),
              env,
              [[{ text: getText(userLang, 'subscribeWeekly'), callback_data: "subscribe:weekly" }]]
            );

            // Record lesson completion in database
            const passAt = new Date().toISOString();
            await db.prepare(
              `INSERT INTO user_profiles(telegram_id, pass_lesson0_at)
                 VALUES(?, ?)
                 ON CONFLICT(telegram_id) DO UPDATE
                 SET pass_lesson0_at=excluded.pass_lesson0_at`
            )
            .bind(parseInt(chatId, 10), passAt)
            .run();
            
            // Notify webhook about lesson completion
            await fetch('https://internal/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lesson_done: true, user_id: chatId })
            }).catch(e => console.error("Failed to notify about lesson completion:", e));

            console.log(`=== FREE LESSON CLEANUP PHASE START ===`);
            // Clean up history and all session data
            await safeKvDelete(kv, histKey);
            await safeKvDelete(kv, `session:${chatId}`);
            // Delete all processed message markers
            const keys = await kv.list({ prefix: `processed:${chatId}:` });
            for (const key of keys.keys) {
              await safeKvDelete(kv, key.name);
            }
            console.log(`=== FREE LESSON COMPLETED SUCCESSFULLY ===`);
            return new Response('OK');
          } else {
            console.log(`=== CONTINUING FREE LESSON ===`);
            console.log(`Continuing free lesson, user turns: ${userTurns} (need 4+ to end)`);
            console.log(`This is user message #${userTurns}, will continue conversation`);
            
            // Generate GPT reply based on conversation history
            const reply = await chatGPT(hist, env, userLang);
            const safeReply = reply.trim() || getText(userLang, 'fallbackResponse');
            
            console.log(`Generated bot reply: ${safeReply}`);
            
            // Add bot response to history
            hist.push({ role: 'assistant', content: safeReply });
            await safeKvPut(kv, histKey, JSON.stringify(hist));
            
            console.log(`Updated history after bot response, new length: ${hist.length}`);
            
            // Send audio response
            await safeSendTTS(chatId, safeReply, env);
            console.log(`Sent audio response to user`);
            
            // Get user's language level and send suggestion for beginners/intermediate
            try {
              console.log(`=== SUGGESTION GENERATION PHASE START ===`);
              const userLevel = await getUserLanguageLevel(chatId, db);
              console.log(`User ${chatId} language level: ${userLevel}`);
              
              // Send suggestion only for Beginner/Начинающий and Intermediate/Средний levels
              const shouldShowSuggestion = userLevel && (
                userLevel === 'Beginner' || userLevel === 'Начинающий' ||
                userLevel === 'Intermediate' || userLevel === 'Средний'
              );
              
              console.log(`Should show suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
              
              if (shouldShowSuggestion) {
                console.log(`Generating suggestion for ${userLevel} level user`);
                const suggestion = await generateSuggestedResponse(hist, env);
                console.log(`Generated suggestion: "${suggestion}"`);
                
                const suggestionMessage = `${getText(userLang, 'suggestionText')}\n\n_${suggestion}_`;
                console.log(`Full suggestion message: "${suggestionMessage}"`);
                
                await sendText(chatId, suggestionMessage, env);
                console.log(`Successfully sent suggestion to ${userLevel} level user`);
              } else {
                console.log(`No suggestion needed for level: ${userLevel}`);
              }
            } catch (suggestionError) {
              console.error('Error generating/sending suggestion:', suggestionError);
              console.error('Suggestion error stack:', suggestionError.stack);
              // Don't fail the whole lesson if suggestion fails
            }
          }
        } finally {
          // Clear processing flag
          await safeKvDelete(kv, processingKey);
        }
      }

      return new Response('OK');
    } catch (e) {
      console.error('Error in Lesson0 bot:', e, e.stack);
      
      // Try to inform the user about the error
      try {
        const chatId = raw.user_id || raw.message?.chat?.id;
        if (chatId) {
          const userLang = await getUserLanguage(chatId, env.USER_DB);
          await sendText(
            chatId,
            getText(userLang, 'technicalError'),
            env
          );
        }
      } catch (sendError) {
        console.error('Fatal: Failed to send error message from lesson0-bot:', sendError);
      }
      
      // Return 200 OK to avoid Telegram retries
      return new Response('OK');
    }
  }
};

// Функция для подсчета количества сообщений пользователя и бота в истории
function countTurns(history) {
  if (!Array.isArray(history)) {
    console.error("Invalid history format in countTurns:", history);
    return { userTurns: 0, botTurns: 0 };
  }
  
  const userTurns = history.filter(msg => msg.role === 'user').length;
  const botTurns = history.filter(msg => msg.role === 'assistant').length;
  
  return { userTurns, botTurns };
}

// Safe KV operations with error handling
async function safeKvPut(kv, key, value, options = {}) {
  try {
    // Ensure expiration_ttl is at least 60 seconds (Cloudflare minimum)
    if (options.expirationTtl && options.expirationTtl < 60) {
      options.expirationTtl = 60;
    }
    await kv.put(key, value, options);
    return true;
  } catch (error) {
    console.error(`KV PUT error for key ${key}:`, error);
    // Try again without expiration if that was the issue
    if (options.expirationTtl) {
      try {
        await kv.put(key, value);
        return true;
      } catch (retryError) {
        console.error(`Retry KV PUT failed for key ${key}:`, retryError);
        return false;
      }
    }
    return false;
  }
}

async function safeKvGet(kv, key) {
  try {
    return await kv.get(key);
  } catch (error) {
    console.error(`KV GET error for key ${key}:`, error);
    return null;
  }
}

async function safeKvDelete(kv, key) {
  try {
    await kv.delete(key);
    return true;
  } catch (error) {
    console.error(`KV DELETE error for key ${key}:`, error);
    return false;
  }
}

// Generate first greeting using GPT
async function sendFirstGreeting(chatId, history, env, kv, language) {
  try {
    console.log(`=== GENERATING FIRST GREETING ===`);
    console.log(`Starting sendFirstGreeting for user ${chatId}`);
    console.log(`Initial history state:`, JSON.stringify(history));
    
    // ИСПРАВЛЕНИЕ ДЛИНЫ: Модифицируем промпт для более короткого приветствия
    // Приветствие всегда генерируется на английском языке, так как это урок английского
    const prompt = `
Generate a brief, friendly greeting for an English language practice session. 
Your greeting should:
1. Warmly welcome the student 
2. Very briefly mention this is to practice English speaking
3. Ask ONE simple open-ended question to start the conversation
4. Be encouraging and supportive

Keep your greeting very concise - no more than 2-3 short sentences total.
Make it simple enough for even beginner English learners to understand.
IMPORTANT: Always respond in English, as this is an English practice session.
`;
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${env.OPENAI_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        model: 'gpt-4o-mini', 
        messages: [
          { role: 'system', content: prompt }
        ], 
        temperature: 1.0, // Maximum variety
        max_tokens: 150  // Сокращаем максимальное количество токенов
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const greeting = j.choices[0].message.content.trim();
    
    console.log(`Generated greeting: "${greeting}"`);
    console.log(`Greeting length: ${greeting.length} characters`);
    
    // Add greeting to history
    history.push({ role: 'assistant', content: greeting });
    console.log(`Added greeting to history. New history:`, JSON.stringify(history));
    console.log(`History length after adding greeting: ${history.length}`);
    
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Сохраняем историю в KV *ДО* отправки сообщения
    // Это гарантирует, что история будет содержать приветствие даже если отправка сообщения не удастся
    const saveResult = await safeKvPut(kv, `hist:${chatId}`, JSON.stringify(history));
    console.log(`History saved to KV with result: ${saveResult}`);
    console.log(`Saved history content:`, JSON.stringify(history));
    
    // Проверяем, что история была сохранена корректно
    const verifyHistory = await safeKvGet(kv, `hist:${chatId}`);
    if (verifyHistory) {
      const parsedHistory = JSON.parse(verifyHistory);
      console.log(`Verified saved history length: ${parsedHistory.length}`);
      console.log(`Verified saved history:`, JSON.stringify(parsedHistory));
    } else {
      console.error(`Failed to verify saved history!`);
    }
    
    // Send greeting as voice message
    console.log(`Sending TTS greeting...`);
    await safeSendTTS(chatId, greeting, env);
    console.log(`Greeting sent successfully`);
    
    // Send suggestion for beginners/intermediate after first greeting
    try {
      console.log(`=== FIRST GREETING SUGGESTION PHASE START ===`);
      const userLevel = await getUserLanguageLevel(chatId, env.USER_DB);
      console.log(`User ${chatId} language level: ${userLevel}`);
      
      // Send suggestion only for Beginner/Начинающий and Intermediate/Средний levels
      const shouldShowSuggestion = userLevel && (
        userLevel === 'Beginner' || userLevel === 'Начинающий' ||
        userLevel === 'Intermediate' || userLevel === 'Средний'
      );
      
      console.log(`Should show first greeting suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
      
      if (shouldShowSuggestion) {
        console.log(`Generating first greeting suggestion for ${userLevel} level user`);
        const suggestion = await generateSuggestedResponse(history, env);
        console.log(`Generated first greeting suggestion: "${suggestion}"`);
        
        const userLang = language; // Use the language parameter passed to the function
        const suggestionMessage = `${getText(userLang, 'suggestionText')}\n\n_${suggestion}_`;
        console.log(`Full first greeting suggestion message: "${suggestionMessage}"`);
        
        await sendText(chatId, suggestionMessage, env);
        console.log(`Successfully sent first greeting suggestion to ${userLevel} level user`);
      } else {
        console.log(`No first greeting suggestion needed for level: ${userLevel}`);
      }
    } catch (suggestionError) {
      console.error('Error generating/sending first greeting suggestion:', suggestionError);
      console.error('First greeting suggestion error stack:', suggestionError.stack);
      // Don't fail the greeting if suggestion fails
    }
  } catch (error) {
    console.error("Error generating first greeting:", error);
    // Fallback to a simple greeting if GPT fails
    // ИСПРАВЛЕНИЕ ДЛИНЫ: Упрощаем запасное приветствие
    const fallbackGreeting = getText(language, 'fallbackGreeting');
    
    console.log(`Using fallback greeting: "${fallbackGreeting}"`);
    
    // Add fallback greeting to history
    history.push({ role: 'assistant', content: fallbackGreeting });
    console.log(`Added fallback greeting to history. New history:`, JSON.stringify(history));
    
    // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Сохраняем историю в KV *ДО* отправки сообщения
    const saveResult = await safeKvPut(kv, `hist:${chatId}`, JSON.stringify(history));
    console.log(`Fallback history saved to KV with result: ${saveResult}`);
    
    // Send fallback greeting
    console.log(`Sending fallback TTS greeting...`);
    await safeSendTTS(chatId, fallbackGreeting, env);
    console.log(`Fallback greeting sent successfully`);
    
    // Send suggestion for beginners/intermediate after fallback greeting
    try {
      console.log(`=== FALLBACK GREETING SUGGESTION PHASE START ===`);
      const userLevel = await getUserLanguageLevel(chatId, env.USER_DB);
      console.log(`User ${chatId} language level: ${userLevel}`);
      
      // Send suggestion only for Beginner/Начинающий and Intermediate/Средний levels
      const shouldShowSuggestion = userLevel && (
        userLevel === 'Beginner' || userLevel === 'Начинающий' ||
        userLevel === 'Intermediate' || userLevel === 'Средний'
      );
      
      console.log(`Should show fallback greeting suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
      
      if (shouldShowSuggestion) {
        console.log(`Generating fallback greeting suggestion for ${userLevel} level user`);
        const suggestion = await generateSuggestedResponse(history, env);
        console.log(`Generated fallback greeting suggestion: "${suggestion}"`);
        
        const userLang = language; // Use the language parameter passed to the function
        const suggestionMessage = `${getText(userLang, 'suggestionText')}\n\n_${suggestion}_`;
        console.log(`Full fallback greeting suggestion message: "${suggestionMessage}"`);
        
        await sendText(chatId, suggestionMessage, env);
        console.log(`Successfully sent fallback greeting suggestion to ${userLevel} level user`);
      } else {
        console.log(`No fallback greeting suggestion needed for level: ${userLevel}`);
      }
    } catch (suggestionError) {
      console.error('Error generating/sending fallback greeting suggestion:', suggestionError);
      console.error('Fallback greeting suggestion error stack:', suggestionError.stack);
      // Don't fail the greeting if suggestion fails
    }
  }
}

// Chat with GPT based on conversation history
async function chatGPT(history, env, language) {
  try {
    // Get system prompt from environment with added instruction for varied responses
    const systemPrompt = env.SYSTEM_PROMPT || 
      `You are a friendly English language tutor having a conversation with a student to help them practice speaking.

CONVERSATION GOALS:
1. Create a natural, engaging conversation that encourages the student to speak more
2. Introduce varied topics suitable for casual English practice
3. Model proper grammar and natural expressions
4. Ask open-ended questions to elicit longer responses
5. Occasionally encourage the student to elaborate on their answers
6. Implicitly correct grammar by using the correct form in your response

STYLE GUIDELINES:
- Keep your responses conversational, warm, and supportive
- Vary your sentence structures, question types, and expressions
- Avoid repetitive phrasing patterns across multiple interactions
- Use expressions and vocabulary that are common in everyday English
- Keep responses relatively short (2-3 sentences) to maintain conversation flow

IMPORTANT:
- Each response should feel unique and avoid formulaic patterns
- Never explicitly correct grammar errors - model correct usage instead
- Focus on maintaining an enjoyable conversation rather than formal teaching`;
    
    // Format messages for OpenAI API
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.content }))
    ];
    
    console.log("Sending conversation to GPT:", JSON.stringify(messages));
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${env.OPENAI_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        model: 'gpt-4o-mini', 
        messages, 
        temperature: 0.9, // High temperature for more variety
        max_tokens: 250 // Increased slightly to allow for more natural responses
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const response = j.choices[0].message.content.trim();
    console.log("GPT response:", response);
    return response;
  } catch (error) {
    console.error("Error in chatGPT function:", error);
    return getText(language, 'chatGptFallback');
  }
}

// Generate suggested response for beginner/intermediate users
async function generateSuggestedResponse(history, env) {
  try {
    const prompt = `
Based on this conversation history, generate a short, natural response that a beginner/intermediate English learner could use to continue the conversation. 

Conversation context:
${history.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')}

Your suggestion should:
1. Be 1-2 sentences maximum
2. Use simple vocabulary and grammar
3. Be a natural continuation of the conversation
4. Help the student practice speaking
5. Include common conversational phrases

Only provide the suggested response text, nothing else.`;

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${env.OPENAI_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        model: 'gpt-4o-mini', 
        messages: [{ role: 'system', content: prompt }], 
        temperature: 0.8,
        max_tokens: 100
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const suggestion = j.choices[0].message.content.trim();
    console.log("Generated suggestion:", suggestion);
    return suggestion;
  } catch (error) {
    console.error("Error generating suggested response:", error);
    return "I think that's interesting. Can you tell me more about it?"; // Fallback suggestion
  }
}

// Analyze user language for grammar and vocabulary feedback - simplified version
async function analyzeLanguage(utterances, env, language) {
  if (!utterances.length) return [];
  
  // Join all utterances for comprehensive analysis
  const allUtterances = utterances.join(' | ');
  
  const prompt = language === 'ru' ? `
Как эксперт-преподаватель английского языка, проанализируйте весь разговор студента и дайте максимум 3-4 самых важных замечания по приоритету:

Высказывания студента: "${allUtterances}"

ПРИОРИТЕТ ЗАМЕЧАНИЙ:
1. Грамматические ошибки (самые важные)
2. Лексические улучшения 
3. Произношение
4. Разнообразие речи (только если остальное идеально)

ФОРМАТ:
- Начните с краткого позитивного комментария
- Дайте 2-4 конкретных замечания в порядке важности
- Каждое замечание должно быть коротким и практичным
- Общий ответ не более 300 слов
- ВАЖНО: Отвечайте на русском языке
` : `
As an expert English language teacher, analyze the student's entire conversation and provide maximum 3-4 most important observations by priority:

Student utterances: "${allUtterances}"

PRIORITY ORDER:
1. Grammar errors (most important)
2. Vocabulary improvements
3. Pronunciation 
4. Speech variety (only if everything else is perfect)

FORMAT:
- Start with brief positive comment
- Give 2-4 specific observations in order of importance
- Each observation should be short and practical
- Total response under 300 words
- IMPORTANT: Respond in English
`;
  
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        Authorization: `Bearer ${env.OPENAI_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({ 
        model: 'gpt-4o-mini', 
        messages: [{ role: 'system', content: prompt }], 
        temperature: 0.3,
        max_tokens: 400
      })
    });
    
    if (!res.ok) {
      console.error("OpenAI API error in analyzeLanguage:", await res.text());
      return [];
    }
    
    const j = await res.json();
    const feedback = j.choices[0].message.content.trim();
    
    // Return single consolidated feedback
    return [{ feedback }];
  } catch (error) {
    console.error("Error in comprehensive language analysis:", error);
    return [];
  }
}

// Send TTS audio message safely
async function safeSendTTS(chatId, text, env) {
  const t = text.trim();
  if (!t) return;
  
  try {
    console.log(`Generating TTS for: ${t}`);
    
    // First, let's log the availability of required credentials
    console.log("TTS process starting with credentials check:");
    console.log("- OpenAI API key available:", !!env.OPENAI_KEY);
    console.log("- Transloadit key available:", !!env.TRANSLOADIT_KEY);
    console.log("- Transloadit template available:", !!env.TRANSLOADIT_TPL);
    
    // Generate audio with OpenAI TTS
    let rawBuf;
    try {
      rawBuf = await openaiTTS(t, env);
      console.log("Successfully generated OpenAI TTS, buffer size:", rawBuf.byteLength);
    } catch (openaiError) {
      console.error("OpenAI TTS generation failed:", openaiError);
      throw new Error(`OpenAI TTS failed: ${openaiError.message}`);
    }
    
    // First, try to send with Transloadit encoding (preferred)
    let voipBuf;
    try {
      voipBuf = await encodeVoipWithTransloadit(rawBuf, env);
      console.log("Successfully encoded audio with Transloadit, buffer size:", voipBuf.byteLength);
      
    const dur = calculateDuration(voipBuf);
    await telegramSendVoice(chatId, voipBuf, dur, env);
      console.log("Successfully sent Transloadit-encoded voice message to Telegram");
    
    // Add a small delay after sending audio to prevent flooding
    await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    } catch (transloaditError) {
      console.error("Transloadit encoding or sending failed:", transloaditError);
      console.log("Falling back to direct OpenAI audio...");
      
      // If Transloadit fails, try direct send as fallback
      try {
        console.log("Attempting direct send of OpenAI audio without Transloadit encoding");
        const directDur = calculateDuration(rawBuf);
        await telegramSendVoice(chatId, rawBuf, directDur, env);
        console.log("Direct audio send successful");
        
        // Add a small delay after sending audio to prevent flooding
        await new Promise(resolve => setTimeout(resolve, 1000));
    return true;
      } catch (directError) {
        console.error("Direct audio send failed:", directError);
        throw new Error(`All audio sending methods failed: ${directError.message}`);
      }
    }
  } catch (e) {
    console.error("TTS process failed with error:", e);
    
    // Final fallback to text if all audio methods fail
    try {
    await sendText(chatId, "📝 " + t, env);
      console.log("Fallback to text message successful");
      return false;
    } catch (textError) {
      console.error("Even text fallback failed:", textError);
    return false;
    }
  }
}

// Convert audio to Telegram-compatible format with Transloadit
async function encodeVoipWithTransloadit(buf, env) {
  console.log("Starting Transloadit encoding, input buffer size:", buf.byteLength);
  
  // Расширенное логирование для диагностики
  console.log("Checking Transloadit credentials:");
  console.log("TRANSLOADIT_KEY exists:", !!env.TRANSLOADIT_KEY);
  console.log("TRANSLOADIT_KEY length:", env.TRANSLOADIT_KEY ? env.TRANSLOADIT_KEY.length : 0);
  console.log("TRANSLOADIT_TPL exists:", !!env.TRANSLOADIT_TPL);
  console.log("TRANSLOADIT_TPL length:", env.TRANSLOADIT_TPL ? env.TRANSLOADIT_TPL.length : 0);
  console.log("TRANSLOADIT_TPL value:", env.TRANSLOADIT_TPL ? env.TRANSLOADIT_TPL.substring(0, 5) + "..." : "null");
  
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
  console.log(`Preparing to send voice message to chat ${chatId}, buffer size: ${buf.byteLength}, duration: ${dur}`);
  
  if (!buf || buf.byteLength === 0) {
    throw new Error("Cannot send empty audio buffer");
  }
  
  // Use correct token based on environment
  const botToken = env.DEV_MODE === 'true' ? env.DEV_BOT_TOKEN : env.BOT_TOKEN;
  
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('duration', dur);
  fd.append('voice', new File([buf], 'voice.ogg', { type: 'audio/ogg; codecs=opus' }));
  
  try {
    console.log(`Sending voice message to Telegram API, token length: ${botToken ? botToken.length : 0}`);
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendVoice`, 
    { method: 'POST', body: fd }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
      console.error(`Telegram API error: ${res.status}, ${errorText}`);
      throw new Error(`Telegram sendVoice error: ${res.status} ${errorText}`);
    }
    
    const result = await res.json();
    console.log("Telegram voice message sent successfully:", JSON.stringify(result.ok));
    return result;
  } catch (error) {
    console.error("Failed to send voice message:", error);
    throw error;
  }
}

// Send text message via Telegram
async function sendText(chatId, text, env, keyboard) {
  // Use correct token based on environment
  const botToken = env.DEV_MODE === 'true' ? env.DEV_BOT_TOKEN : env.BOT_TOKEN;
  
  const body = { 
    chat_id: String(chatId), 
    text,
    parse_mode: 'Markdown'
  };
  
  if (keyboard) {
    body.reply_markup = { inline_keyboard: keyboard };
  }
  
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram sendMessage error: ${errorText}`);
  }
}

// Send GIF via Telegram
async function sendGif(chatId, gifUrl, caption, env) {
  // Use correct token based on environment
  const botToken = env.DEV_MODE === 'true' ? env.DEV_BOT_TOKEN : env.BOT_TOKEN;
  
  const body = { 
    chat_id: String(chatId), 
    animation: gifUrl,
    caption: caption,
    parse_mode: 'Markdown'
  };
  
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendAnimation`,
    { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(body) 
    }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram sendAnimation error: ${errorText}`);
  }
}

// Transcribe voice message using Whisper
async function transcribeVoice(fileId, env) {
  // Use correct token based on environment
  const botToken = env.DEV_MODE === 'true' ? env.DEV_BOT_TOKEN : env.BOT_TOKEN;
  
  // Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
  );
  
  if (!fileRes.ok) {
    throw new Error(`Failed to get file info: ${await fileRes.text()}`);
  }
  
  const info = await fileRes.json();
  const filePath = info.result.file_path;
  
  // Download voice file
  const fileUrl = `https://api.telegram.org/file/bot${botToken}/${filePath}`;
  const fileData = await fetch(fileUrl).then(r => r.arrayBuffer());
  
  // Prepare form data for OpenAI API
  const fd = new FormData();
  fd.append('model', 'whisper-1');
  fd.append('language', 'en');
  fd.append('file', new File([fileData], 'voice.ogg', { type: 'audio/ogg' }));
  
  // Call OpenAI Whisper API
  const whisperRes = await fetch(
    'https://api.openai.com/v1/audio/transcriptions', 
    { 
      method: 'POST', 
      headers: { Authorization: `Bearer ${env.OPENAI_KEY}` }, 
      body: fd 
    }
  );
  
  if (!whisperRes.ok) {
    throw new Error(`Whisper API error: ${await whisperRes.text()}`);
  }
  
  const transcription = await whisperRes.json();
  return transcription.text.trim();
}

// Calculate approximate duration from buffer size
function calculateDuration(buf) {
  // More accurate duration calculation based on Opus encoding
  // For Opus format, we can estimate roughly 12KB per second for speech quality
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 12000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
}
