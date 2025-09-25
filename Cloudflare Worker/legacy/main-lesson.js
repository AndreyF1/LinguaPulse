// main-lesson/worker.js
// Handles main lesson flow for subscribed users

export default {
  async fetch(request, env, ctx) {
    let raw; // Declared here to be accessible in the final catch block
    try {
      // Handle GET requests (health checks, etc.)
      if (request.method === 'GET') {
        return new Response('Main lesson worker is running', { status: 200 });
      }
      
      // Only process POST requests
      if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }
      
      raw = await request.json();
      console.log('Main-lesson-bot raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      
      // Handle two entry points: direct /talk command or forwarded Start lesson button
      const chatId = raw.user_id || raw.message?.chat?.id;
      if (!chatId) return new Response('OK');

      const db = env.USER_DB;
      const kv = env.CHAT_KV;

      // CRITICAL ANTI-DUPLICATION CHECK for lesson start
      if (raw.action === 'start_lesson' || raw.message?.text === '/talk') {
        const startLockKey = `start_lock:${chatId}`;
        const existingLock = await safeKvGet(kv, startLockKey);
        
        if (existingLock) {
          const lockTime = parseInt(existingLock, 10);
          const now = Date.now();
          
          // If lock is less than 60 seconds old, reject duplicate request
          if (now - lockTime < 60000) {
            console.log(`🚫 [${chatId}] DUPLICATE lesson start request blocked (lock age: ${now - lockTime}ms)`);
            return new Response('OK');
          }
        }
        
        // Set lock for 60 seconds
        await safeKvPut(kv, startLockKey, Date.now().toString(), { expirationTtl: 60 });
        console.log(`🔒 [${chatId}] Lesson start lock set`);
      }

      // Command entry point: /talk
      if (raw.message?.text === '/talk') {
        return await handleLessonStart(chatId, env, db, kv);
      }

      // Button entry point: "Start lesson" button or direct trigger from webhook
      if (raw.action === 'start_lesson') {
        return await handleLessonStart(chatId, env, db, kv);
      }

      // Handle user voice message during lesson
      if (raw.message?.voice) {
        // Get message ID for deduplication
        const messageId = raw.message.message_id;
        const processedKey = `main_processed:${chatId}:${messageId}`;
        
        // Check if this exact message was already processed
        const alreadyProcessed = await safeKvGet(kv, processedKey);
        if (alreadyProcessed) {
          console.log(`Message ${messageId} already processed, ignoring duplicate`);
          return new Response('OK');
        }
        
        // Mark this message as being processed
        await safeKvPut(kv, processedKey, "1", { expirationTtl: 3600 }); // 1 hour TTL
        
        // Get conversation history
        const histKey = `main_hist:${chatId}`;
        const stored = await safeKvGet(kv, histKey) || '[]';
        const hist = JSON.parse(stored);
        
        // Check current session ID and activity - FIXED to be more robust
        const sessionKey = `main_session:${chatId}`;
        const currentSession = await safeKvGet(kv, sessionKey);
        
        // CRITICAL FIX: Ensure we're checking the right worker's session
        if (!currentSession) {
          console.log("No active main-lesson session found");
          
          // Check if there might be a lesson0 session instead
          const lesson0SessionKey = `session:${chatId}`;
          const lesson0Session = await safeKvGet(kv, lesson0SessionKey);
          
          if (lesson0Session) {
            // This is a lesson0 session, we shouldn't process it here
            // Just acknowledge receiving it and let telegram-webhook route it correctly
            console.log("Found lesson0 session instead, not processing in main-lesson");
            return new Response('OK');
          }
          
          // Otherwise, we have no active session at all
          await sendText(chatId, 
            "You don't have an active lesson. Please start a new lesson by using the /talk command.", 
            env,
            [[{ text: "Start Lesson", callback_data: "lesson:start" }]]);
          return new Response('OK');
        }
        
        // Now check for session timeout only if we have a valid session
        const isSessionActive = await checkSessionActive(chatId, kv);
        if (!isSessionActive) {
          console.log("Session inactive or timed out");
          // Different message based on how many turns we had
          const botTurns = hist.filter(h => h.role === 'assistant').length;
          
          if (botTurns >= 5) {
            // Enough turns, session completed due to inactivity
            await sendText(chatId, 
              "Your lesson has been completed as you had several exchanges already. You can start a new lesson when the next one becomes available.", 
              env);
          } else {
            // Not enough turns, but session timed out
            await sendText(chatId, 
              "Your lesson session timed out due to inactivity. You can start a new lesson by pressing the Start Lesson button or using the /talk command.",
              env,
              [[{ text: "Start Lesson", callback_data: "lesson:start" }]]);
          }
          return new Response('OK');
        }
        
        // Check if user has already spoken and we're waiting for their response
        const lastMessage = hist.length > 0 ? hist[hist.length - 1] : null;
        if (lastMessage && lastMessage.role === 'user') {
          console.log("Last message was from user, waiting for bot response. Possible race condition.");
          return new Response('OK');
        }
        
        // Set a "processing" flag to prevent concurrent processing of messages
        const processingKey = `main_processing:${chatId}`;
        const isProcessing = await safeKvGet(kv, processingKey);
        
        if (isProcessing) {
          console.log("Already processing a message for this user, ignoring duplicate");
          return new Response('OK');
        }
        
        // Set processing flag with 60-second expiration
        await safeKvPut(kv, processingKey, "1", { expirationTtl: 60 });
        
        try {
          // Transcribe user voice
          const userText = await transcribeVoice(raw.message.voice.file_id, env);
          console.log(`User said: ${userText}`);
          
          // Add user message to history
          hist.push({ role: 'user', content: userText });
          
          // Count assistant turns (not counting initial greeting)
          const botTurns = hist.filter(h => h.role === 'assistant').length;
          
          // If we've already had 9-10 bot responses after greeting, end the lesson
          if (botTurns >= 10) { // 1 greeting + 9 responses = 10 total
            // Farewell message
            const bye = "That's all for today's lesson! You did great. Let's continue our practice tomorrow with new exercises. Have a wonderful day!";
            hist.push({ role: 'assistant', content: bye });
            
            // CRITICAL FIX: Clean up session data BEFORE sending any more messages
            // This prevents users from sending more messages during lesson conclusion
            await safeKvDelete(kv, histKey);
            await safeKvDelete(kv, `main_session:${chatId}`);
            await safeKvDelete(kv, `main_last_activity:${chatId}`);
            
            // Delete all processed message markers
            const keys = await kv.list({ prefix: `main_processed:${chatId}:` });
            for (const key of keys.keys) {
              await safeKvDelete(kv, key.name);
            }
            
            // Now send the farewell message
            await safeSendTTS(chatId, bye, env);

            // Grammar analysis of all user utterances (concise, localized)
            const userUtterances = hist.filter(h => h.role === 'user').map(h => h.content);
            
            // Get user's interface language for localization
            const userLangForFeedback = await getUserLanguageForMain(chatId, env.USER_DB);
            
            // Generate single consolidated feedback (concise)
            const consolidatedFeedback = await analyzeLanguageConsolidated(userUtterances, env, userLangForFeedback);
            
            if (consolidatedFeedback) {
              const feedbackTitles = {
                en: "📝 *Your Language Feedback*\n\nHere's a detailed analysis of your speaking during our conversation:",
                ru: "📝 *Обратная связь по языку*\n\nВот подробный анализ вашей речи во время нашего разговора:"
              };
              const titleText = feedbackTitles[userLangForFeedback] || feedbackTitles.en;
              
              await sendText(chatId, titleText, env);
              await sendText(chatId, consolidatedFeedback, env);
            }

            // Send message about next lesson
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendText(
              chatId,
              "Your next lesson will be available tomorrow. Come back then to continue improving your English!",
              env
            );

            // Update user profile in database - FIXED: field names adjusted to match schema
            // 1. Increment number_of_lessons 
            // 2. Update lessons_in_row
            // 3. Set next_lesson_access_at to tomorrow at 2 AM
            // 4. Set daily_lesson_pass_at to now
            const now = new Date();
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(2, 0, 0, 0);
            const nextLessonAt = tomorrow.toISOString();
            
            // Get current profile values first
            const { results } = await db.prepare(
              `SELECT number_of_lessons, lessons_in_row, daily_lesson_pass_at FROM user_profiles WHERE telegram_id = ?`
            )
            .bind(parseInt(chatId, 10))
            .all();
            
            let lessonsTotal = 1;
            let lessonsStreak = 1;
            
            if (results.length > 0) {
              lessonsTotal = (results[0].number_of_lessons || 0) + 1;
              
              // Calculate streak logic
              const lastLessonDate = results[0].daily_lesson_pass_at ? new Date(results[0].daily_lesson_pass_at) : null;
              const currentStreak = results[0].lessons_in_row || 0;
              
              if (lastLessonDate) {
                // Check if the last lesson was yesterday or earlier today
                const yesterday = new Date(now);
                yesterday.setDate(yesterday.getDate() - 1);
                yesterday.setHours(0, 0, 0, 0);
                
                const todayStart = new Date(now);
                todayStart.setHours(0, 0, 0, 0);
                
                if ((lastLessonDate >= yesterday && lastLessonDate < todayStart) || 
                    (lastLessonDate >= todayStart)) {
                  // Last lesson was yesterday or today, increment streak
                  lessonsStreak = currentStreak + 1;
                } else {
                  // Streak broken, reset to 1
                  lessonsStreak = 1;
                }
              }
            }
            
            // Update the database with new values - FIXED: field names
            const lessonCompletedAt = now.toISOString();
            await db.prepare(
              `UPDATE user_profiles 
               SET next_lesson_access_at = ?,
                   number_of_lessons = ?,
                   lessons_in_row = ?,
                   daily_lesson_pass_at = ?
               WHERE telegram_id = ?`
            )
            .bind(
              nextLessonAt,
              lessonsTotal,
              lessonsStreak,
              lessonCompletedAt,
              parseInt(chatId, 10)
            )
            .run();
            
            return new Response('OK');
          }

          // Get user's level for proper response generation
          const userLevel = await safeKvGet(kv, `main_user_level:${chatId}`) || "B1";
          
          // Generate GPT reply based on conversation history and actual user level
          const reply = await chatGPT(hist, env, userLevel, chatId);
          const safeReply = reply.trim() || "I didn't quite catch that. Could you please repeat?";
          
          // Add bot response to history
          hist.push({ role: 'assistant', content: safeReply });
          await safeKvPut(kv, histKey, JSON.stringify(hist));
          
          // Update activity timestamp
          await safeKvPut(kv, `main_last_activity:${chatId}`, Date.now().toString());
          
          // Send audio response
          await safeSendTTS(chatId, safeReply, env);
          
          // Generate and send suggestion for beginner/intermediate users
          try {
            const userLevel = await safeKvGet(kv, `main_user_level:${chatId}`) || "B1";
            console.log(`User level: ${userLevel}`);
            
            const shouldShowSuggestion = (
              userLevel === 'Beginner' || 
              userLevel === 'Intermediate' ||
              userLevel === 'A1' ||
              userLevel === 'A2' ||
              userLevel === 'B1'
            );
            
            console.log(`Should show suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
            
            if (shouldShowSuggestion) {
              console.log(`Generating suggestion for ${userLevel} level user`);
              const suggestion = await generateSuggestedResponse(hist, env);
              console.log(`Generated suggestion: "${suggestion}"`);
              
              // Get user's interface language for localization
              const userLang = await getUserLanguageForMain(chatId, env.USER_DB);
              const suggestionText = userLang === 'ru' 
                ? "Ты можешь использовать следующий текст ниже для аудио-ответа. Можешь проигнорировать и придумать свой ответ"
                : "You can use the text below for your audio response. Feel free to ignore it and come up with your own answer";
              
              const suggestionMessage = `${suggestionText}\n\n_${suggestion}_`;
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
        } finally {
          // Clear processing flag
          await safeKvDelete(kv, processingKey);
        }
      }

      return new Response('OK');
    } catch (e) {
      console.error('Error in Main lesson bot:', e, e.stack);

      // Try to inform the user about the error
      try {
        const chatId = raw.user_id || raw.message?.chat?.id;
        if (chatId) {
          await sendText(
            chatId,
            '⚙️ Sorry, a technical error occurred during your lesson. Please use /talk to start a new one, or contact support if the issue continues.',
            env
          );
        }
      } catch (sendError) {
        console.error('Fatal: Failed to send error message from main-lesson:', sendError);
      }
      
      // Return 200 OK to avoid Telegram retries
      return new Response('OK');
    }
  }
};

// Analyze language in a single concise message, localized (mirrors lesson0 approach)
async function analyzeLanguageConsolidated(utterances, env, language) {
  try {
    if (!utterances || utterances.length === 0) return '';
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
      console.error('OpenAI API error in analyzeLanguageConsolidated:', await res.text());
      return '';
    }
    const j = await res.json();
    const feedback = j.choices[0].message.content.trim();
    return feedback;
  } catch (e) {
    console.error('Error in analyzeLanguageConsolidated:', e);
    return '';
  }
}

// Check if session is still active and valid
async function checkSessionActive(chatId, kv) {
  const sessionKey = `main_session:${chatId}`;
  const lastActivityKey = `main_last_activity:${chatId}`;
  
  // Get last activity timestamp
  const lastActivity = await safeKvGet(kv, lastActivityKey);
  
  if (lastActivity) {
    const lastActiveTime = parseInt(lastActivity, 10);
    const now = Date.now();
    
    // If inactive for more than 10 minutes (600000 ms) - increased from 5 min for better UX
    if (now - lastActiveTime > 600000) {
      return false;
    }
  }
  
  // Update activity timestamp
  await safeKvPut(kv, lastActivityKey, Date.now().toString());
  return true;
}

// Handle lesson start logic with checks for subscription and next_lesson_access_at
async function handleLessonStart(chatId, env, db, kv) {
  // First, check if user has active subscription and lesson is available
  const { results } = await db.prepare(
    `SELECT subscription_expired_at, next_lesson_access_at
     FROM user_profiles 
     WHERE telegram_id = ?`
  )
  .bind(parseInt(chatId, 10))
  .all();
  
  if (!results.length) {
    await sendText(
      chatId, 
      "You need to complete the onboarding first. Use /start to begin.",
      env
    );
    return new Response('OK');
  }
  
  const profile = results[0];
  const now = new Date();
  
  // Check subscription status
  const hasActiveSubscription = profile.subscription_expired_at && 
                               (new Date(profile.subscription_expired_at) > now);
                               
  if (!hasActiveSubscription) {
    // No active subscription - send subscription link
    await sendSubscriptionMessage(chatId, env);
    return new Response('OK');
  }
  
  // Check if next lesson is available (null means available immediately)
  const lessonAvailable = !profile.next_lesson_access_at || 
                          (new Date(profile.next_lesson_access_at) <= now);
  
  if (!lessonAvailable) {
    // Subscription active but lesson not yet available
    const nextLessonAt = new Date(profile.next_lesson_access_at);
    const timeUntil = formatTimeUntil(nextLessonAt);
    
    await sendText(
      chatId,
      `Your next lesson will be available in ${timeUntil}. Please come back then!`,
      env
    );
    return new Response('OK');
  }
  
  // Get user's language level from survey
  const { results: surveyResults } = await db.prepare(
    `SELECT language_level FROM user_survey WHERE telegram_id = ?`
  )
  .bind(parseInt(chatId, 10))
  .all();
  
  const userLevel = surveyResults.length > 0 ? surveyResults[0].language_level : 'Intermediate';
  console.log(`🚀 [${chatId}] Starting lesson for user with level: ${userLevel}`);
  
  // CRITICAL CHECK: See if user already has an active session
  const existingSession = await safeKvGet(kv, `main_session:${chatId}`);
  const existingActivity = await safeKvGet(kv, `main_last_activity:${chatId}`);
  const existingHistory = await safeKvGet(kv, `main_hist:${chatId}`);
  
  console.log(`🔍 [${chatId}] Checking existing session data:`, {
    session: !!existingSession,
    activity: !!existingActivity, 
    history: !!existingHistory
  });
  
  // If we have any indication of active session, check if it's still valid
  if (existingSession || existingActivity || existingHistory) {
    
    // Check activity timestamp if it exists
    if (existingActivity) {
      const lastActiveTime = parseInt(existingActivity, 10);
      const now = Date.now();
      const timeSinceActivity = now - lastActiveTime;
      
      console.log(`🕐 [${chatId}] Time since last activity: ${timeSinceActivity}ms`);
      
      // If active within last 10 minutes, continue existing session
      if (timeSinceActivity < 600000) {
        console.log(`🔄 [${chatId}] Active session found, continuing existing lesson`);
        await sendText(chatId, "You already have an active lesson session. Let's continue!", env);
        return new Response('OK');
      }
    }
    
    // If we have history but no recent activity, clean up old session
    console.log(`🧹 [${chatId}] Cleaning up expired session data`);
    await safeKvDelete(kv, `main_session:${chatId}`);
    await safeKvDelete(kv, `main_hist:${chatId}`);
    await safeKvDelete(kv, `main_last_activity:${chatId}`);
    await safeKvDelete(kv, `main_user_level:${chatId}`);
  }
  
  // If we get here, user can start the lesson
  await sendText(chatId, "🎓 Your English lesson is starting...", env);
  
  // Initialize empty history and create a new session ID
  console.log(`💾 [${chatId}] Initializing lesson session`);
  const history = [];
  const sessionId = Date.now().toString();
  
  // CRITICAL FIX: Clear greeting flags from previous sessions
  await safeKvDelete(kv, `greeting_sent:${chatId}`);
  await safeKvDelete(kv, `greeting_attempts:${chatId}`);
  
  // Save all session data with error checking
  const historyResult = await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
  const sessionResult = await safeKvPut(kv, `main_session:${chatId}`, sessionId);
  const activityResult = await safeKvPut(kv, `main_last_activity:${chatId}`, Date.now().toString());
  
  // Store user's level in KV for reference throughout the session
  const levelResult = await safeKvPut(kv, `main_user_level:${chatId}`, userLevel);
  
  console.log(`💾 [${chatId}] Session data saved:`, {
    history: historyResult,
    session: sessionResult,
    activity: activityResult,
    level: levelResult,
    sessionId: sessionId
  });
  
  if (!sessionResult) {
    console.error(`❌ [${chatId}] CRITICAL: Failed to save session ID - lesson may not work properly`);
  }
  
  // Generate first GPT greeting with user's actual level
  console.log(`🤖 [${chatId}] Starting first greeting generation`);
  await sendFirstGreeting(chatId, history, env, kv, userLevel);
  
  console.log(`✅ [${chatId}] Lesson startup completed`);
  return new Response('OK');
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

// Helper function to get user's interface language for localization
async function getUserLanguageForMain(chatId, db) {
  try {
    const { results } = await db
      .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    return results.length > 0 ? results[0].interface_language : 'en';
  } catch (error) {
    console.error('Error getting user language for main-lesson:', error);
    return 'en';
  }
}

// Generate first greeting using GPT - FIXED: Uses actual user level with attempt limiting
async function sendFirstGreeting(chatId, history, env, kv, userLevel) {
  console.log(`👋 [${chatId}] Starting first greeting generation for level: ${userLevel}`);
  
  // CRITICAL: Check if greeting was already sent for this session
  const greetingSentKey = `greeting_sent:${chatId}`;
  const greetingAlreadySent = await safeKvGet(kv, greetingSentKey);
  
  if (greetingAlreadySent) {
    console.log(`🚫 [${chatId}] Greeting already sent for this session, skipping`);
    return;
  }
  
  // Set flag immediately to prevent concurrent calls
  await safeKvPut(kv, greetingSentKey, "1", { expirationTtl: 3600 });
  
  // Check if we've already tried to generate greeting for this session
  const attemptKey = `greeting_attempts:${chatId}`;
  const attemptCount = parseInt(await safeKvGet(kv, attemptKey) || '0', 10);
  
  if (attemptCount >= 2) {
    console.log(`🚫 [${chatId}] Maximum greeting generation attempts (2) reached, using fallback`);
    const fallbackGreeting = "Hello! How are you today?";
    history.push({ role: 'assistant', content: fallbackGreeting });
    await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
    const fallbackResult = await safeSendTTS(chatId, fallbackGreeting, env);
    console.log(`🔄 [${chatId}] Fallback greeting sent due to attempt limit`);
    return;
  }
  
  // Increment attempt counter
  await safeKvPut(kv, attemptKey, String(attemptCount + 1), { expirationTtl: 3600 });
  console.log(`🔢 [${chatId}] Greeting generation attempt ${attemptCount + 1}/2`);
  
  try {
    // Format prompt based on user's actual language level
    let levelPrompt;
    
    // Simple 3-level system based on survey responses
    if (userLevel === 'Beginner' || userLevel === 'Начинающий') {
      levelPrompt = "The student is a beginner. Focus on very basic grammar (subject-verb agreement, simple present/past tense). Provide simple alternatives with common, everyday vocabulary. Be very encouraging.";
    } else if (userLevel === 'Advanced' || userLevel === 'Продвинутый') {
      levelPrompt = "The student is advanced. Focus on sophisticated language use, nuanced expressions, subtle grammar points, and native-like fluency. Your feedback can be more detailed.";
    } else {
      // Intermediate level (default)
      levelPrompt = "The student is at intermediate level. You can suggest improvements to grammar accuracy, vocabulary range, and basic sentence structure. Balance encouragement with constructive feedback.";
    }
    
    console.log(`🤖 [${chatId}] Calling OpenAI GPT for greeting generation`);
    
    const prompt = `Generate a warm, friendly greeting for a casual English conversation practice. ${levelPrompt} 

Keep it simple and conversational - like chatting with a friend. Ask ONE simple, relatable question that anyone could easily answer. Avoid complex, philosophical, or abstract topics.

Examples of good questions: "How has your day been?", "What did you do this weekend?", "What's your favorite way to relax?"

Keep your greeting to 1-2 sentences maximum.`;
    
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
        temperature: 0.7,
        max_tokens: 150 // Limit token length to ensure short, focused greeting
      })
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ [${chatId}] OpenAI API error:`, errorText);
      throw new Error(`OpenAI API error: ${errorText}`);
    }
    
    const j = await res.json();
    const greeting = j.choices[0].message.content.trim();
    
    console.log(`✅ [${chatId}] Generated greeting: "${greeting}"`);
    
    // Add greeting to history
    console.log(`💾 [${chatId}] Saving greeting to conversation history`);
    history.push({ role: 'assistant', content: greeting });
    const saveResult = await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
    
    if (!saveResult) {
      console.error(`❌ [${chatId}] Failed to save history to KV`);
    } else {
      console.log(`✅ [${chatId}] History saved successfully`);
    }
    
    // Send greeting as voice message
    console.log(`🎤 [${chatId}] Sending greeting as TTS message`);
    const ttsResult = await safeSendTTS(chatId, greeting, env);
    
    if (ttsResult) {
      console.log(`🎉 [${chatId}] First greeting completed successfully!`);
    } else {
      console.log(`⚠️ [${chatId}] First greeting sent but TTS failed (fallback to text used)`);
    }
    
    // Generate and send suggestion for beginner/intermediate users
    try {
      console.log(`User level: ${userLevel}`);
      
      const shouldShowSuggestion = (
        userLevel === 'Beginner' || 
        userLevel === 'Intermediate' ||
        userLevel === 'A1' ||
        userLevel === 'A2' ||
        userLevel === 'B1'
      );
      
      console.log(`Should show suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
      
      if (shouldShowSuggestion) {
        console.log(`Generating suggestion for ${userLevel} level user`);
        const suggestion = await generateSuggestedResponse(history, env);
        console.log(`Generated suggestion: "${suggestion}"`);
        
        // Get user's interface language for localization
        const userLang = await getUserLanguageForMain(chatId, env.USER_DB);
        const suggestionText = userLang === 'ru' 
          ? "Ты можешь использовать следующий текст ниже для аудио-ответа. Можешь проигнорировать и придумать свой ответ"
          : "You can use the text below for your audio response. Feel free to ignore it and come up with your own answer";
        
        const suggestionMessage = `${suggestionText}\n\n_${suggestion}_`;
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
    
  } catch (error) {
    console.error(`❌ [${chatId}] Error generating first greeting:`, error);
    
    // Fallback greetings based on level
    let fallbackGreeting;
    
    // Simple 3-level system based on survey responses
    if (userLevel === 'Beginner' || userLevel === 'Начинающий') {
      fallbackGreeting = "Hello! How are you today?";
    } else if (userLevel === 'Advanced' || userLevel === 'Продвинутый') {
      fallbackGreeting = "Welcome back to our English practice session! I'm curious to hear what's been on your mind lately.";
    } else {
      // Intermediate level (default)
      fallbackGreeting = "Welcome to today's English practice! What have you been up to recently?";
    }
    
    console.log(`🔄 [${chatId}] Using fallback greeting: "${fallbackGreeting}"`);
    
    history.push({ role: 'assistant', content: fallbackGreeting });
    await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
    
    const fallbackResult = await safeSendTTS(chatId, fallbackGreeting, env);
    console.log(`🔄 [${chatId}] Fallback greeting ${fallbackResult ? 'sent successfully' : 'failed (text fallback used)'}`);
    
    // Generate and send suggestion for beginner/intermediate users (fallback case)
    try {
      console.log(`User level: ${userLevel}`);
      
      const shouldShowSuggestion = (
        userLevel === 'Beginner' || 
        userLevel === 'Intermediate' ||
        userLevel === 'A1' ||
        userLevel === 'A2' ||
        userLevel === 'B1'
      );
      
      console.log(`Should show suggestion: ${shouldShowSuggestion} (level: ${userLevel})`);
      
      if (shouldShowSuggestion) {
        console.log(`Generating suggestion for ${userLevel} level user (fallback)`);
        const suggestion = await generateSuggestedResponse(history, env);
        console.log(`Generated suggestion: "${suggestion}"`);
        
        // Get user's interface language for localization
        const userLang = await getUserLanguageForMain(chatId, env.USER_DB);
        const suggestionText = userLang === 'ru' 
          ? "Ты можешь использовать следующий текст ниже для аудио-ответа. Можешь проигнорировать и придумать свой ответ"
          : "You can use the text below for your audio response. Feel free to ignore it and come up with your own answer";
        
        const suggestionMessage = `${suggestionText}\n\n_${suggestion}_`;
        console.log(`Full suggestion message: "${suggestionMessage}"`);
        
        await sendText(chatId, suggestionMessage, env);
        console.log(`Successfully sent suggestion to ${userLevel} level user (fallback)`);
      } else {
        console.log(`No suggestion needed for level: ${userLevel}`);
      }
    } catch (suggestionError) {
      console.error('Error generating/sending suggestion (fallback):', suggestionError);
      console.error('Suggestion error stack:', suggestionError.stack);
      // Don't fail the whole lesson if suggestion fails
    }
  }
}

// Chat with GPT based on conversation history - FIXED: Use actual user level with attempt limiting  
async function chatGPT(history, env, userLevel = "B1", chatId = 'unknown') {
  
  // Check attempt count in a simple way - use a global counter or pass kv
  // For now, just limit retries within this function call
  let attempts = 0;
  const maxAttempts = 2;
  
  while (attempts < maxAttempts) {
    attempts++;
    console.log(`🤖 [${chatId}] ChatGPT attempt ${attempts}/${maxAttempts}`);
    
    try {
    // Construct system prompt based on user's actual level
    let levelPrompt;
    
    // Simple 3-level system based on survey responses
    if (userLevel === 'Beginner' || userLevel === 'Начинающий') {
      levelPrompt = "The student is a beginner. Use very simple vocabulary and short sentences. Keep to basic everyday topics like family, food, hobbies.";
    } else if (userLevel === 'Advanced' || userLevel === 'Продвинутый') {
      levelPrompt = "The student is advanced. Discuss interesting topics like professional challenges, cultural insights, creative pursuits.";
    } else {
      // Intermediate level (default)
      levelPrompt = "The student is at intermediate level. Discuss practical topics like personal experiences, current events (simple), lifestyle choices.";
    }
    
    // Get system prompt from environment or use enhanced default with level adaptation
    const baseSystemPrompt = env.MAIN_SYSTEM_PROMPT || 
      "You are a professional English language tutor having a conversation with a paying subscriber. " +
      "Keep your responses conversational but educational, supportive, and engaging. " +
      "Ask follow-up questions that challenge the student appropriately for their level. " +
      "Your goal is to help the student practice their English in a natural way while gradually improving. " +
      "Keep responses fairly short (1-3 sentences) to maintain a flowing conversation. " +
      "Try to correct major grammar errors indirectly by rephrasing what they said correctly in your response.";
    
    const systemPrompt = `${baseSystemPrompt} ${levelPrompt}`;
    
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
        temperature: 0.7,
        max_tokens: 150 // Reduced from 200 to keep responses shorter and more focused
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
      const j = await res.json();
      const response = j.choices[0].message.content.trim();
      console.log(`✅ [${chatId}] GPT response received on attempt ${attempts}:`, response);
      return response;
    } catch (error) {
      console.error(`❌ [${chatId}] ChatGPT attempt ${attempts} failed:`, error);
      
      if (attempts >= maxAttempts) {
        console.error(`🚫 [${chatId}] All ChatGPT attempts exhausted, using fallback`);
        return "I'm sorry, I'm having trouble responding right now. Could you please try again in a moment?";
      }
      
      // Continue to next attempt
      console.log(`🔄 [${chatId}] Retrying ChatGPT call...`);
    }
  }
  
  // This should never be reached, but just in case
  return "I'm having technical difficulties. Please try again later.";
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

// Analyze user language for grammar and vocabulary feedback - FIXED: Use actual user level and avoid redundant encouragement
async function analyzeLanguage(utterances, env, userLevel = "B1") {
  if (!utterances.length) return {
    utteranceAnalyses: [],
    skillAssessment: null,
    message: "Not enough conversation data to analyze."
  };
  
  // Analyze each utterance separately
  const analyses = [];
  
  for (const utterance of utterances) {
    if (!utterance.trim()) continue; // Skip empty utterances
    
    // Adjust prompt based on actual user level
    let levelPrompt;
    
    // Simple 3-level system based on survey responses
    if (userLevel === 'Beginner' || userLevel === 'Начинающий') {
      levelPrompt = "The student is a beginner. Focus on very basic grammar (subject-verb agreement, simple present/past tense). Provide simple alternatives with common, everyday vocabulary. Be very encouraging.";
    } else if (userLevel === 'Advanced' || userLevel === 'Продвинутый') {
      levelPrompt = "The student is advanced. Focus on sophisticated language use, nuanced expressions, subtle grammar points, and native-like fluency. Your feedback can be more detailed.";
    } else {
      // Intermediate level (default)
      levelPrompt = "The student is at intermediate level. You can suggest improvements to grammar accuracy, vocabulary range, and basic sentence structure. Balance encouragement with constructive feedback.";
    }
    
    // FIXED: Updated prompt to avoid redundant encouragement
    const prompt = `
As an English language teacher for a paying subscriber, provide a concise yet detailed language analysis for this specific student utterance:
"${utterance}"

${levelPrompt}

Provide a brief analysis with:
1. What the student did well (be specific)
2. One specific grammar or vocabulary improvement if needed
3. How a native speaker might express the same idea more naturally

FORMAT: 
- Keep feedback constructive and focused on just this utterance
- Use clear bullet points 
- Keep total response under 150 words
- Start with a specific positive comment
- DO NOT include generic encouragement phrases like "Keep up the good work" at the end
- DO NOT mention the student's level in your response
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
          messages: [
            { role: 'system', content: prompt }
          ], 
          temperature: 0.3
        })
      });
      
      if (!res.ok) {
        throw new Error(`OpenAI API error: ${await res.text()}`);
      }
      
      const j = await res.json();
      analyses.push({
        utterance: utterance,
        feedback: j.choices[0].message.content.trim()
      });
    } catch (error) {
      console.error(`Analysis error for utterance "${utterance}":`, error);
      analyses.push({
        utterance: utterance,
        feedback: "Sorry, I couldn't analyze this particular response."
      });
    }
  }
  
  // After analyzing individual utterances, perform overall skill assessment
  try {
    // FIXED: Include actual user level in assessment prompt
    const prompt = `
As a language assessment expert, evaluate this ${userLevel}-level student's English speaking skills based on these utterances:

"${utterances.join('"\n"')}"

Provide objective numerical scores (1-100) for:
1. Speaking: fluency, pronunciation, clarity of expression
2. Vocabulary: range, appropriateness, precision of word choice
3. Grammar: accuracy, complexity of structures used

Contextualize these scores relative to their ${userLevel} level - do not evaluate them against native speakers. Then provide 1-2 sentences explaining each score. Format your response as JSON:
{
"speaking": { "score": 75, "feedback": "Good fluency with some hesitations..." },
"vocabulary": { "score": 80, "feedback": "Uses a variety of words appropriate to the topic..." },
"grammar": { "score": 70, "feedback": "Generally correct with some minor errors..." }
}
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
        temperature: 0.3,
        response_format: { type: "json_object" }
      })
    });
  
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
  
    const j = await res.json();
    const assessment = JSON.parse(j.choices[0].message.content.trim());
  
    return {
      utteranceAnalyses: analyses,
      skillAssessment: assessment
    };
  } catch (error) {
    console.error(`Skill assessment error:`, error);
    // Return just the utterance analyses if skill assessment fails
    return {
      utteranceAnalyses: analyses,
      skillAssessment: null
    };
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
    
    // Step 2: Convert to Telegram-compatible format
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
    
      return true;
    } catch (e) {
      console.error(`❌ [${chatId}] TTS attempt ${attempts} failed:`, e.message);
      
      if (attempts >= maxAttempts) {
        console.error(`🚫 [${chatId}] All TTS attempts exhausted, falling back to text`);
        
        // Fallback to text if all TTS attempts fail
        try {
          console.log(`📝 [${chatId}] Falling back to text message`);
          await sendText(chatId, "📝 " + t, env);
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
  
  // This should never be reached, but just in case
  return false;
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

// Send text message via Telegram
async function sendText(chatId, text, env, keyboard) {
  const body = { 
    chat_id: String(chatId), 
    text,
    parse_mode: 'Markdown'
  };
  
  if (keyboard) {
    body.reply_markup = { inline_keyboard: keyboard };
  }
  
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
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

// Transcribe voice message using Whisper
async function transcribeVoice(fileId, env) {
  // Get file path from Telegram
  const fileRes = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`
  );
  
  if (!fileRes.ok) {
    throw new Error(`Failed to get file info: ${await fileRes.text()}`);
  }
  
  const info = await fileRes.json();
  const filePath = info.result.file_path;
  
  // Download voice file
  const fileUrl = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`;
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
  // For Opus format at speech quality, estimate roughly 20KB per second
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 20000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
}

// Send subscription message with proper Tribute link
async function sendSubscriptionMessage(chatId, env) {
  console.log(`[DEBUG] sendSubscriptionMessage called for user ${chatId}`);
  
  // Helper function for localization in sendSubscriptionMessage
  async function getUserLanguageForSubscription() {
    try {
      const { results } = await env.USER_DB
        .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
        .bind(parseInt(chatId, 10))
        .all();
      return results.length > 0 ? results[0].interface_language : 'en';
    } catch (error) {
      console.error('Error getting user language for subscription:', error);
      return 'en';
    }
  }

  const subscriptionTexts = {
    en: {
      title: "🔑 *To unlock premium lessons, please subscribe:*",
      step1: "1️⃣ Click the button below to open the subscription page",
      step2: "2️⃣ Complete the payment process",
      step3: "3️⃣ After payment, you'll receive a confirmation message from the bot",
      benefit: "🎯 *Your subscription will give you access to daily personalized English lessons!*",
      subscribeButton: "Subscribe for 600₽/month"
    },
    ru: {
      title: "🔑 *Для доступа к премиум урокам, пожалуйста, подпишитесь:*",
      step1: "1️⃣ Нажмите кнопку ниже, чтобы открыть страницу подписки",
      step2: "2️⃣ Завершите процесс оплаты",
      step3: "3️⃣ После оплаты вы получите подтверждающее сообщение от бота",
      benefit: "🎯 *Ваша подписка даст вам доступ к ежедневным персонализированным урокам английского!*",
      subscribeButton: "Подписаться за 600₽/месяц"
    }
  };

  function getSubscriptionText(lang, key) {
    return subscriptionTexts[lang]?.[key] || subscriptionTexts.en[key] || key;
  }
  
  // Используем точно такую же логику, как в sendTributeChannelLink из telegram-webhook.js
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

  console.log(`[DEBUG] Using tribute link: ${tributeAppLink}`);

  const userLang = await getUserLanguageForSubscription();
  const message = `${getSubscriptionText(userLang, 'title')}\n\n` +
                 `${getSubscriptionText(userLang, 'step1')}\n` +
                 `${getSubscriptionText(userLang, 'step2')}\n` +
                 `${getSubscriptionText(userLang, 'step3')}\n\n` +
                 `${getSubscriptionText(userLang, 'benefit')}`;
  
  await sendText(
    chatId,
    message,
    env,
    [[{ text: getSubscriptionText(userLang, 'subscribeButton'), url: tributeAppLink }]]
  );
}

// Format time until date in human-readable form
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
