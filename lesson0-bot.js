// linguapulse-lesson0-bot worker.js
// CONFIG:
// - D1 binding: USER_DB
// - KV binding for conversation history: CHAT_KV
// - Env vars: OPENAI_KEY, BOT_TOKEN, TRANSLOADIT_KEY, TRANSLOADIT_TPL, SYSTEM_PROMPT

export default {
  async fetch(request, env, ctx) {
    try {
      const raw = await request.json();
      console.log('Lesson0-bot raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      const chatId = raw.user_id || raw.message?.chat?.id;
      if (!chatId) return new Response('OK');

      const db = env.USER_DB;
      const kv = env.CHAT_KV;

      // A) Start free lesson trigger
      if (raw.action === 'start_free') {
        // First, check if the user has already completed the free lesson AND has eng_level
        const { results } = await db.prepare(
          `SELECT eng_level, pass_lesson0_at FROM user_profiles 
           WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        // КРИТИЧЕСКАЯ ПРОВЕРКА: Пользователь должен сначала пройти placement test
        if (results.length === 0 || !results[0].eng_level) {
          console.log(`User ${chatId} hasn't completed placement test, redirecting to test`);
          await sendText(
            chatId, 
            "You need to complete the placement test first to determine your English level. Please type /start to begin the test.",
            env
          );
          return new Response('OK');
        }
        
        // If user already completed the lesson, show subscription offer instead
        if (results[0].pass_lesson0_at) {
          await sendText(
            chatId, 
            "You've already completed your free trial lesson. If you'd like to continue practicing English, you can subscribe for just €2 per week. This gives you access to one extended lesson every day with personalized feedback.",
            env,
            [[{ text: "Subscribe for €2/week", callback_data: "subscribe:weekly" }]]
          );
          return new Response('OK');
        }
        
        // ИСПРАВЛЕНИЕ ПОРЯДКА: Сначала отправляем приветствие, затем начинаем урок
        // Отправляем сообщение о начале урока
        await sendText(chatId, "🎧 *Welcome to your free English conversation practice!* Please listen to the audio and respond with a voice message.", env);
        
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
        
        // Затем отправляем "Starting free audio lesson..." и генерируем первое приветствие
        await sendText(chatId, "Starting free audio lesson…", env);
        
        // Generate first GPT greeting
        await sendFirstGreeting(chatId, history, env, kv);
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
          
          // Проверка на валидность истории
          if (!Array.isArray(hist) || hist.length === 0) {
            console.log("Invalid or empty history found, resetting session");
            await sendText(chatId, "I couldn't retrieve your conversation history. Please use /lesson to start a new practice session.", env);
            
            // Очистить данные сессии
            await safeKvDelete(kv, histKey);
            await safeKvDelete(kv, `session:${chatId}`);
            return new Response('OK');
          }
        } catch (parseError) {
          console.error("Error parsing history:", parseError);
          await sendText(chatId, "There was an error processing your lesson. Please use /lesson to start a new practice session.", env);
            
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
          await sendText(chatId, "It seems your previous lesson has ended. Please use /lesson to start a new practice session.", env);
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
            const bye = "That concludes our English practice session for today. You've done really well! I'll analyze your speaking and provide feedback now. Thank you for practicing with me!";
            hist.push({ role: 'assistant', content: bye });
            await safeKvPut(kv, histKey, JSON.stringify(hist));
            await safeSendTTS(chatId, bye, env);

            // Send a transition message
            await sendText(chatId, "🔍 *Analyzing your speaking...*", env);
            console.log(`=== FREE LESSON FEEDBACK PHASE START ===`);
            
            // Grammar analysis of all user utterances
            const userUtterances = hist.filter(h => h.role === 'user').map(h => h.content);
            console.log(`Analyzing user utterances: ${JSON.stringify(userUtterances)}`);
            const analyses = await analyzeLanguage(userUtterances, env);
            
            // First, send an introduction message
            if (analyses.length > 0) {
              await sendText(
                chatId, 
                "📝 *Your Language Feedback*\n\nHere's a detailed analysis of your speaking during our conversation:", 
                env
              );
              
              // Then send individual analysis for each utterance
              for (let i = 0; i < analyses.length; i++) {
                const analysis = analyses[i];
                await sendText(
                  chatId,
                  `*Utterance ${i+1}:* "${analysis.utterance}"\n\n${analysis.feedback}`,
                  env
                );
                
                // Add a short delay between messages to avoid flooding
                await new Promise(resolve => setTimeout(resolve, 800));
              }
              
              // Overall assessment based on all utterances
              await sendText(
                chatId,
                "🌟 *Overall Assessment*\n\nYou demonstrated good effort in communicating in English. With continued practice, you'll see significant improvements in fluency, grammar accuracy, and vocabulary usage. I recommend practicing daily conversations like this to build confidence and speaking skills.",
                env
              );
            }

            console.log(`=== FREE LESSON SUBSCRIPTION OFFER PHASE START ===`);
            // Subscription offer - sent after all feedback messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendText(
              chatId,
              "To unlock daily personalized audio lessons, you can subscribe for just €2 per week.",
              env,
              [[{ text: "Subscribe for €2/week", callback_data: "subscribe:weekly" }]]
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
            const reply = await chatGPT(hist, env);
            const safeReply = reply.trim() || "I didn't quite catch that. Could you please repeat?";
            
            console.log(`Generated bot reply: ${safeReply}`);
            
            // Add bot response to history
            hist.push({ role: 'assistant', content: safeReply });
            await safeKvPut(kv, histKey, JSON.stringify(hist));
            
            console.log(`Updated history after bot response, new length: ${hist.length}`);
            
            // Send audio response
            await safeSendTTS(chatId, safeReply, env);
            console.log(`Sent audio response to user`);
          }
        } finally {
          // Clear processing flag
          await safeKvDelete(kv, processingKey);
        }
      }

      return new Response('OK');
    } catch (e) {
      console.error('Error in Lesson0 bot:', e);
      return new Response('Error: ' + e.message, { status: 500 });
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
async function sendFirstGreeting(chatId, history, env, kv) {
  try {
    console.log(`=== GENERATING FIRST GREETING ===`);
    console.log(`Starting sendFirstGreeting for user ${chatId}`);
    console.log(`Initial history state:`, JSON.stringify(history));
    
    // ИСПРАВЛЕНИЕ ДЛИНЫ: Модифицируем промпт для более короткого приветствия
    const prompt = `
Generate a brief, friendly greeting for an English language practice session. 
Your greeting should:
1. Warmly welcome the student 
2. Very briefly mention this is to practice English speaking
3. Ask ONE simple open-ended question to start the conversation
4. Be encouraging and supportive

Keep your greeting very concise - no more than 2-3 short sentences total.
Make it simple enough for even beginner English learners to understand.
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
  } catch (error) {
    console.error("Error generating first greeting:", error);
    // Fallback to a simple greeting if GPT fails
    // ИСПРАВЛЕНИЕ ДЛИНЫ: Упрощаем запасное приветствие
    const fallbackGreeting = "Hi there! I'm your English practice partner today. How are you feeling, and what would you like to talk about?";
    
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
  }
}

// Chat with GPT based on conversation history
async function chatGPT(history, env) {
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
    return "I'd love to hear more about that. Could you tell me more?";
  }
}

// Analyze user language for grammar and vocabulary feedback
async function analyzeLanguage(utterances, env) {
  if (!utterances.length) return "Not enough conversation data to analyze.";
  
  // Instead of analyzing all utterances together, analyze each one separately
  const analyses = [];
  
  for (const utterance of utterances) {
    if (!utterance.trim()) continue; // Skip empty utterances
    
    const prompt = `
As an expert English language teacher, provide a detailed yet helpful language analysis for this specific student utterance:
"${utterance}"

Your analysis should include:
1. A positive note about what the student did well (fluency, vocabulary usage, etc.)
2. One specific grammar correction if needed (explain the rule briefly)
3. Vocabulary enhancement suggestions (1-2 more advanced or natural alternatives)
4. Pronunciation guidance if applicable (based on likely pronunciation issues for non-native speakers)
5. How a native speaker might express the same idea more naturally

FORMAT: 
- Keep feedback constructive and supportive
- Use clear bullet points 
- Keep total response under 200 words
- Start with a brief positive comment
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
          temperature: 0.3,
          max_tokens: 400  // Increased token limit for more detailed feedback
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
    
    // Add a small delay between API calls to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  return analyses;
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
  
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('duration', dur);
  fd.append('voice', new File([buf], 'voice.ogg', { type: 'audio/ogg; codecs=opus' }));
  
  try {
    console.log(`Sending voice message to Telegram API, token length: ${env.BOT_TOKEN ? env.BOT_TOKEN.length : 0}`);
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendVoice`, 
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
  // For Opus format, we can estimate roughly 12KB per second for speech quality
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 12000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
}
