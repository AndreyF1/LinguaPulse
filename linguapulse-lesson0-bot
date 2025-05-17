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
        // First, check if the user has already completed the free lesson
        const { results } = await db.prepare(
          `SELECT pass_lesson0_at FROM user_profiles 
           WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        // If user already completed the lesson, show subscription offer instead
        if (results.length > 0 && results[0].pass_lesson0_at) {
          await sendText(
            chatId, 
            "You've already completed your free trial lesson. If you'd like to continue practicing English, you can subscribe for just $1 per week. This gives you access to one extended lesson every day with personalized feedback.",
            env,
            [[{ text: "Subscribe for $1/week", callback_data: "subscribe:weekly" }]]
          );
          return new Response('OK');
        }
        
        // Send initial text notification
        await sendText(chatId, "🎓 Your free English lesson is starting...", env);
        
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
        
        // Generate first GPT greeting (instead of static prompt)
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
        const hist = JSON.parse(stored);
        
        // Check current session ID to avoid mixing test sessions
        const sessionKey = `session:${chatId}`;
        const currentSession = await safeKvGet(kv, sessionKey);
        if (!currentSession) {
          console.log("No active session found, message might be from an old test session");
          await sendText(chatId, "It seems your previous lesson has ended. To start a new lesson, please press the 'Free audio lesson' button again.", env);
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
          
          // Count assistant turns (not counting initial greeting)
          const botTurns = hist.filter(h => h.role === 'assistant').length;
          
          // If we've already had 3 bot responses after greeting, end the lesson
          if (botTurns >= 4) { // 1 greeting + 3 responses = 4 total
            // Farewell message
            const bye = "Thanks for practicing with me today! You did great. We'll continue tomorrow with new exercises. Have a wonderful day!";
            hist.push({ role: 'assistant', content: bye });
            await safeKvPut(kv, histKey, JSON.stringify(hist));
            await safeSendTTS(chatId, bye, env);

            // Grammar analysis of all user utterances - one message per utterance
            const userUtterances = hist.filter(h => h.role === 'user').map(h => h.content);
            const analyses = await analyzeLanguage(userUtterances, env);
            
            // First, send an introduction message
            if (analyses.length > 0) {
              await sendText(
                chatId, 
                "📝 *Here's your language feedback from today's practice:*", 
                env
              );
              
              // Then send individual analysis for each utterance
              for (const analysis of analyses) {
                await sendText(
                  chatId,
                  `*Your phrase:* "${analysis.utterance}"\n\n${analysis.feedback}`,
                  env
                );
                
                // Add a short delay between messages to avoid flooding
                await new Promise(resolve => setTimeout(resolve, 500));
              }
              
              // After all analyses, send encouragement message
              await sendText(
                chatId,
                "🌟 *Keep practicing! With regular conversation practice, you'll improve quickly!*",
                env
              );
            }

            // Subscription offer - sent after all feedback messages
            await new Promise(resolve => setTimeout(resolve, 1000));
            await sendText(
              chatId,
              "To unlock daily personalized audio lessons, you can subscribe for just $1 per week.",
              env,
              [[{ text: "Subscribe for $1/week", callback_data: "subscribe:weekly" }]]
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

            // Clean up history and all session data
            await safeKvDelete(kv, histKey);
            await safeKvDelete(kv, `session:${chatId}`);
            // Delete all processed message markers
            const keys = await kv.list({ prefix: `processed:${chatId}:` });
            for (const key of keys.keys) {
              await safeKvDelete(kv, key.name);
            }
            return new Response('OK');
          }

          // Generate GPT reply based on conversation history
          const reply = await chatGPT(hist, env);
          const safeReply = reply.trim() || "I didn't quite catch that. Could you please repeat?";
          
          // Add bot response to history
          hist.push({ role: 'assistant', content: safeReply });
          await safeKvPut(kv, histKey, JSON.stringify(hist));
          
          // Send audio response
          await safeSendTTS(chatId, safeReply, env);
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
    const prompt = "Generate a friendly, conversational opening greeting for an English language practice session. Ask the student an engaging question about their day, interests, or preferences to start the conversation. Keep it natural and casual.";
    
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
        temperature: 0.7 
      })
    });
    
    if (!res.ok) {
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const greeting = j.choices[0].message.content.trim();
    
    console.log(`First greeting: ${greeting}`);
    
    // Add greeting to history
    history.push({ role: 'assistant', content: greeting });
    await safeKvPut(kv, `hist:${chatId}`, JSON.stringify(history));
    
    // Send greeting as voice message
    await safeSendTTS(chatId, greeting, env);
  } catch (error) {
    console.error("Error generating first greeting:", error);
    // Fallback to a simple greeting if GPT fails
    const fallbackGreeting = "Hi there! I'm your English conversation partner for today. How are you doing?";
    history.push({ role: 'assistant', content: fallbackGreeting });
    await safeKvPut(kv, `hist:${chatId}`, JSON.stringify(history));
    await safeSendTTS(chatId, fallbackGreeting, env);
  }
}

// Chat with GPT based on conversation history
async function chatGPT(history, env) {
  try {
    // Get system prompt from environment
    const systemPrompt = env.SYSTEM_PROMPT || 
      "You are a friendly English language tutor having a casual conversation with a student. " +
      "Keep your responses conversational, supportive, and engaging. " +
      "Ask follow-up questions to encourage the student to speak more. " +
      "Your goal is to help the student practice their English in a natural way. " +
      "Keep responses fairly short (1-3 sentences) to maintain a flowing conversation.";
    
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
        max_tokens: 200 // Limit response length to prevent overly long messages
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
As an English language teacher, provide a concise yet helpful language analysis for this specific student utterance:
"${utterance}"

Provide a brief analysis with:
1. What the student did well
2. One specific grammar or vocabulary suggestion if needed
3. How a native speaker might express the same idea (if different)

FORMAT: 
- Keep feedback constructive and focused on just one key improvement
- Use clear bullet points 
- Keep total response under 150 words
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
  
  return analyses;
}

// Send TTS audio message safely
async function safeSendTTS(chatId, text, env) {
  const t = text.trim();
  if (!t) return;
  
  try {
    console.log(`Generating TTS for: ${t}`);
    const rawBuf = await openaiTTS(t, env);
    const voipBuf = await encodeVoipWithTransloadit(rawBuf, env);
    const dur = calculateDuration(voipBuf);
    await telegramSendVoice(chatId, voipBuf, dur, env);
    
    // Add a small delay after sending audio to prevent flooding
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true;
  } catch (e) {
    console.error("TTS failed:", e);
    // Fallback to text if TTS fails
    await sendText(chatId, "📝 " + t, env);
    return false;
  }
}

// Convert audio to Telegram-compatible format with Transloadit
async function encodeVoipWithTransloadit(buf, env) {
  const params = { 
    auth: { key: env.TRANSLOADIT_KEY }, 
    template_id: env.TRANSLOADIT_TPL, 
    fields: { filename: 'src.ogg' } 
  };
  
  const fd = new FormData();
  fd.append('params', JSON.stringify(params));
  fd.append('file', new File([buf], 'src.ogg', { type: 'audio/ogg' }));
  
  const init = await (
    await fetch('https://api2.transloadit.com/assemblies', { 
      method: 'POST', 
      body: fd 
    })
  ).json();
  
  const done = await waitAssembly(init.assembly_ssl_url, 90000);
  const url = done.results['encoded-audio'][0].ssl_url;
  return (await fetch(url)).arrayBuffer();
}

// Wait for Transloadit assembly to complete
async function waitAssembly(url, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const j = await (await fetch(url)).json();
    if (j.ok === 'ASSEMBLY_COMPLETED') return j;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('Transloadit timeout');
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
  // For Opus format, we can estimate roughly 12KB per second for speech quality
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 12000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
}
