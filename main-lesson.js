// main-lesson/worker.js
// Handles main lesson flow for subscribed users

export default {
  async fetch(request, env, ctx) {
    try {
      const raw = await request.json();
      console.log('Main-lesson-bot raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      
      // Handle two entry points: direct /talk command or forwarded Start lesson button
      const chatId = raw.user_id || raw.message?.chat?.id;
      if (!chatId) return new Response('OK');

      const db = env.USER_DB;
      const kv = env.CHAT_KV;

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
          
          // If we've already had 5-6 bot responses after greeting, end the lesson
          if (botTurns >= 6) { // 1 greeting + 5 responses = 6 total
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

            // Grammar analysis of all user utterances
            const userUtterances = hist.filter(h => h.role === 'user').map(h => h.content);
            
            // Get user's actual level from KV storage
            const userLevel = await safeKvGet(kv, `main_user_level:${chatId}`) || "B1";
            const analyses = await analyzeLanguage(userUtterances, env, userLevel);
            
            // First, send an introduction message
            if (analyses.utteranceAnalyses && analyses.utteranceAnalyses.length > 0) {
              await sendText(
                chatId, 
                "📝 *Here's your language feedback from today's practice:*", 
                env
              );
              
              // Then send individual analysis for each utterance
              for (const analysis of analyses.utteranceAnalyses) {
                // Type guard to ensure we're dealing with the correct structure
                if (typeof analysis === 'object' && analysis !== null && 'utterance' in analysis && 'feedback' in analysis) {
                  await sendText(
                    chatId,
                    `*Your phrase:* "${analysis.utterance}"\n\n${analysis.feedback}`,
                    env
                  );
                  
                  // Add a short delay between messages to avoid flooding
                  await new Promise(resolve => setTimeout(resolve, 500));
                }
              }
              
              // Add skill assessment if available
              if (analyses.skillAssessment) {
                const skills = analyses.skillAssessment;
                await sendText(
                  chatId,
                  "🏆 *Your Skill Assessment*\n\n" +
                  `*Speaking:* ${skills.speaking.score}/100\n${skills.speaking.feedback}\n\n` +
                  `*Vocabulary:* ${skills.vocabulary.score}/100\n${skills.vocabulary.feedback}\n\n` +
                  `*Grammar:* ${skills.grammar.score}/100\n${skills.grammar.feedback}`,
                  env
                );
              }
              
              // After all analyses, send encouragement message
              await sendText(
                chatId,
                "🌟 *Keep practicing! With consistent practice, you'll see steady improvement in your speaking skills!*",
                env
              );
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
          const reply = await chatGPT(hist, env, userLevel);
          const safeReply = reply.trim() || "I didn't quite catch that. Could you please repeat?";
          
          // Add bot response to history
          hist.push({ role: 'assistant', content: safeReply });
          await safeKvPut(kv, histKey, JSON.stringify(hist));
          
          // Update activity timestamp
          await safeKvPut(kv, `main_last_activity:${chatId}`, Date.now().toString());
          
          // Send audio response
          await safeSendTTS(chatId, safeReply, env);
        } finally {
          // Clear processing flag
          await safeKvDelete(kv, processingKey);
        }
      }

      return new Response('OK');
    } catch (e) {
      console.error('Error in Main lesson bot:', e);
      return new Response('Error: ' + e.message, { status: 500 });
    }
  }
};

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
    `SELECT subscription_expired_at, next_lesson_access_at, eng_level
     FROM user_profiles 
     WHERE telegram_id = ?`
  )
  .bind(parseInt(chatId, 10))
  .all();
  
  if (!results.length) {
    await sendText(
      chatId, 
      "You need to take the placement test first. Use /start to begin.",
      env
    );
    return new Response('OK');
  }
  
  const profile = results[0];
  const now = new Date();
  
  // Check subscription status
  const hasActiveSubscription = profile.subscription_expired_at && 
                               (new Date(profile.subscription_expired_at) > now);
                               
  // Check if next lesson is available
  const lessonAvailable = profile.next_lesson_access_at && 
                          (new Date(profile.next_lesson_access_at) <= now);
  
  // Both conditions must be true to start the lesson
  if (!hasActiveSubscription) {
    // No active subscription
    await sendText(
      chatId,
      "You don't have an active subscription. Subscribe to access daily lessons!",
      env,
      [[{ text: "Subscribe for $1/week", callback_data: "sub:weekly" }]]
    );
    return new Response('OK');
  }
  
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
  
  // If we get here, user can start the lesson
  await sendText(chatId, "🎓 Your English lesson is starting...", env);
  
  // Initialize empty history and create a new session ID
  const history = [];
  const sessionId = Date.now().toString();
  await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
  await safeKvPut(kv, `main_session:${chatId}`, sessionId);
  await safeKvPut(kv, `main_last_activity:${chatId}`, Date.now().toString());
  
  // FIXED: Store user's level in KV for reference throughout the session
  const userLevel = profile.eng_level || "B1";
  await safeKvPut(kv, `main_user_level:${chatId}`, userLevel);
  
  // Generate first GPT greeting with user's actual level
  await sendFirstGreeting(chatId, history, env, kv, userLevel);
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

// Generate first greeting using GPT - FIXED: Uses actual user level
async function sendFirstGreeting(chatId, history, env, kv, userLevel) {
  try {
    // Format prompt based on user's actual language level
    let levelPrompt;
    
    switch(userLevel) {
      case 'A1':
        levelPrompt = "The student is at beginner level (A1). Use very simple vocabulary and short, basic sentences. Speak slowly and clearly. Ask only one simple question at a time. Focus on everyday topics the student would be familiar with.";
        break;
      case 'A2':
        levelPrompt = "The student is at elementary level (A2). Use simple vocabulary and straightforward sentences. Ask one clear question at a time. Focus on familiar topics and everyday situations.";
        break;
      case 'B1':
        levelPrompt = "The student is at intermediate level (B1). Use moderately complex vocabulary and sentence structures. You can ask one or two related questions. Discuss a range of familiar and some unfamiliar topics.";
        break;
      case 'B2':
        levelPrompt = "The student is at upper-intermediate level (B2). Use natural language with varied vocabulary and sentence structures. You can ask related questions on a variety of topics including abstract concepts.";
        break;
      case 'C1':
      case 'C2':
        levelPrompt = "The student is at advanced level (C1/C2). Use sophisticated vocabulary and complex sentences. You can ask challenging questions on any topic, including abstract and specialized subjects.";
        break;
      default:
        levelPrompt = "The student is at intermediate level (B1). Use moderately complex vocabulary and sentence structures. You can ask one or two related questions. Discuss a range of familiar and some unfamiliar topics.";
    }
    
    const prompt = `Generate a friendly, conversational opening greeting for an English language practice session with a subscriber. ${levelPrompt} Make the greeting engaging and personalized. Ask a thoughtful question to start the conversation naturally. Keep your response between 1-3 sentences total.`;
    
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
      throw new Error(`OpenAI API error: ${await res.text()}`);
    }
    
    const j = await res.json();
    const greeting = j.choices[0].message.content.trim();
    
    console.log(`First greeting: ${greeting}`);
    
    // Add greeting to history
    history.push({ role: 'assistant', content: greeting });
    await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
    
    // Send greeting as voice message
    await safeSendTTS(chatId, greeting, env);
  } catch (error) {
    console.error("Error generating first greeting:", error);
    
    // Fallback greetings based on level
    let fallbackGreeting;
    
    switch(userLevel) {
      case 'A1':
        fallbackGreeting = "Hello! How are you today?";
        break;
      case 'A2':
        fallbackGreeting = "Hi there! How was your day? Tell me about it.";
        break;
      case 'B1':
      default:
        fallbackGreeting = "Welcome to today's English practice! What have you been up to recently?";
        break;
      case 'B2':
      case 'C1':
      case 'C2':
        fallbackGreeting = "Welcome back to our English practice session! I'm curious to hear what's been on your mind lately.";
        break;
    }
    
    history.push({ role: 'assistant', content: fallbackGreeting });
    await safeKvPut(kv, `main_hist:${chatId}`, JSON.stringify(history));
    await safeSendTTS(chatId, fallbackGreeting, env);
  }
}

// Chat with GPT based on conversation history - FIXED: Use actual user level
async function chatGPT(history, env, userLevel = "B1") {
  try {
    // Construct system prompt based on user's actual level
    let levelPrompt;
    
    switch(userLevel) {
      case 'A1':
        levelPrompt = "The student is at beginner level (A1). Use very simple vocabulary and short sentences. Speak slowly and clearly with basic grammar. Focus on everyday topics.";
        break;
      case 'A2':
        levelPrompt = "The student is at elementary level (A2). Use simple vocabulary and straightforward sentences. Focus on familiar topics and everyday situations.";
        break;
      case 'B1':
        levelPrompt = "The student is at intermediate level (B1). Use moderately complex vocabulary and sentence structures. Discuss a range of familiar and some unfamiliar topics.";
        break;
      case 'B2':
        levelPrompt = "The student is at upper-intermediate level (B2). Use natural language with varied vocabulary and sentence structures. Discuss a variety of topics including abstract concepts.";
        break;
      case 'C1':
      case 'C2':
        levelPrompt = "The student is at advanced level (C1/C2). Use sophisticated vocabulary and complex sentences. Discuss any topic, including abstract and specialized subjects.";
        break;
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
    console.log("GPT response:", response);
    return response;
  } catch (error) {
    console.error("Error in chatGPT function:", error);
    return "I'm interested in hearing more about that. Could you tell me a bit more?";
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
    
    switch(userLevel) {
      case 'A1':
        levelPrompt = "The student is a beginner (A1). Focus on very basic grammar (subject-verb agreement, simple present/past tense). Provide simple alternatives with common, everyday vocabulary. Be very encouraging.";
        break;
      case 'A2':
        levelPrompt = "The student is at elementary level (A2). Focus on basic sentence structure, common tenses, and everyday vocabulary. Keep feedback simple and encouraging.";
        break;
      case 'B1':
        levelPrompt = "The student is at intermediate level (B1). You can suggest improvements to grammar accuracy, vocabulary range, and basic sentence structure. Balance encouragement with constructive feedback.";
        break;
      case 'B2':
        levelPrompt = "The student is at upper-intermediate level (B2). You can provide feedback on more nuanced grammar points, varied vocabulary, cohesion, and natural phrasing. Challenge them appropriately.";
        break;
      case 'C1':
      case 'C2':
        levelPrompt = "The student is at advanced level (C1/C2). Focus on sophisticated language use, nuanced expressions, subtle grammar points, and native-like fluency. Your feedback can be more detailed.";
        break;
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
  // For Opus format at speech quality, estimate roughly 20KB per second
  const estimatedSeconds = Math.max(1, Math.round(buf.byteLength / 20000));
  console.log(`Audio size: ${buf.byteLength} bytes, estimated duration: ${estimatedSeconds} seconds`);
  return estimatedSeconds;
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
