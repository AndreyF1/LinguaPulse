// newbies-funnel worker.js
// Handles onboarding funnel: language selection and mini-survey

export default {
  async fetch(request, env, ctx) {
    let raw; // Declared here to be accessible in the final catch block
    try {
      raw = await request.json();
      console.log('Newbies-funnel raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      const chatId = raw.user_id || raw.message?.chat?.id || raw.callback_query?.message?.chat?.id;
      console.log(`[DEBUG] Extracted chatId: ${chatId}`);
      if (!chatId) {
        console.log('[DEBUG] No chatId found, returning OK');
        return new Response('OK');
      }

      const db = env.USER_DB;
      const kv = env.CHAT_KV;

      // A) Start onboarding funnel trigger
      if (raw.action === 'start_onboarding') {
        console.log(`Starting/resuming onboarding for user ${chatId}`);
        
        // First, check if survey is already complete in DB
        const { results: surveyResults } = await db.prepare(
          `SELECT completed_at FROM user_survey WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();

        if (surveyResults.length > 0 && surveyResults[0].completed_at) {
          // This case should be handled by telegram-webhook, but as a fallback:
          console.log(`User ${chatId} already completed survey, sending welcome back.`);
          await sendText(
            chatId, 
            "Welcome back! Use /lesson to see your learning options.",
            env
          );
          return new Response('OK');
        }

        // ИСПРАВЛЕНИЕ: Всегда начинаем с самого начала для новых пользователей
        // Очищаем любое предыдущее состояние опроса
        try {
          await kv.delete(`survey:${chatId}`);
          console.log(`Cleared any existing survey state for user ${chatId}`);
        } catch (kvError) {
          console.log(`Could not clear KV state (might not exist):`, kvError.message);
        }

        // Check if they have selected a language but not started survey
        const { results: prefResults } = await db.prepare(
          `SELECT interface_language FROM user_preferences WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();

        if (prefResults.length > 0 && prefResults[0].interface_language) {
          console.log(`User ${chatId} has language preference, starting fresh survey`);
          await startMiniSurvey(chatId, prefResults[0].interface_language, env);
          return new Response('OK');
        }

        // If nothing else, they are a brand new user. Send language selection.
        console.log(`User ${chatId} is brand new. Sending language selection.`);
        const welcomeMessage = 
          "👋 Hello! I'm LinguaPulse, an AI teacher created to help you learn English.\n\n" +
          "Привет! Я LinguaPulse, AI учитель, созданный для помощи в изучении английского языка.\n\n" +
          "🌍 What language should I use for the interface? / На каком языке оставить интерфейс?";
        
        await sendText(chatId, welcomeMessage, env, [
          [
            { text: "🇷🇺 Русский", callback_data: "language:ru" },
            { text: "🇺🇸 English", callback_data: "language:en" }
          ]
        ]);
        
        return new Response('OK');
      }

      // B) Handle language selection
      if (raw.callback_query?.data?.startsWith('language:')) {
        const selectedLanguage = raw.callback_query.data.split(':')[1];
        console.log(`User ${chatId} selected language: ${selectedLanguage}`);
        
        // Debug logging
        console.log(`[DEBUG] Database object available:`, !!db);
        console.log(`[DEBUG] Database type:`, typeof db);
        console.log(`[DEBUG] Attempting to save language preference for user ${chatId} with language ${selectedLanguage}`);
        
        try {
          // Save language preference
          const result = await db.prepare(
            `INSERT INTO user_preferences (telegram_id, interface_language, created_at)
             VALUES (?, ?, ?)
             ON CONFLICT(telegram_id) DO UPDATE
             SET interface_language = excluded.interface_language`
          )
          .bind(parseInt(chatId, 10), selectedLanguage, new Date().toISOString())
          .run();
          
          console.log(`[DEBUG] Database insert result:`, result);
          console.log(`[DEBUG] Language preference saved successfully for user ${chatId}`);
        } catch (dbError) {
          console.error(`[ERROR] Failed to save language preference:`, dbError);
          throw dbError;
        }
        
        // Acknowledge callback
        await callTelegram('answerCallbackQuery', {
          callback_query_id: raw.callback_query.id
        }, env);
        
        // Start mini-survey
        await startMiniSurvey(chatId, selectedLanguage, env);
        return new Response('OK');
      }

      // C) Handle survey questions
      if (raw.callback_query?.data?.startsWith('survey:')) {
        const [_, questionType, answer] = raw.callback_query.data.split(':');
        console.log(`[SURVEY] User ${chatId} answered ${questionType}: ${answer}`);
        
        // Get current survey state
        console.log(`[SURVEY] Getting survey state for user ${chatId}...`);
        const surveyState = await kv.get(`survey:${chatId}`) || '{}';
        console.log(`[SURVEY] Raw survey state:`, surveyState);
        
        let state;
        try {
          state = JSON.parse(surveyState);
          console.log(`[SURVEY] Parsed survey state:`, JSON.stringify(state));
        } catch (parseError) {
          console.error(`[SURVEY] Error parsing survey state:`, parseError);
          state = {};
        }
        
        // Save answer
        state[questionType] = answer;
        state.currentQuestion = getNextQuestion(questionType);
        
        console.log(`[SURVEY] Updated state:`, JSON.stringify(state));
        console.log(`[SURVEY] Next question:`, state.currentQuestion);
        
        // Save updated state
        try {
          await kv.put(`survey:${chatId}`, JSON.stringify(state));
          console.log(`[SURVEY] State saved successfully`);
        } catch (saveError) {
          console.error(`[SURVEY] Error saving state:`, saveError);
        }
        
        // Acknowledge callback
        try {
          await callTelegram('answerCallbackQuery', {
            callback_query_id: raw.callback_query.id
          }, env);
          console.log(`[SURVEY] Callback acknowledged`);
        } catch (ackError) {
          console.error(`[SURVEY] Error acknowledging callback:`, ackError);
        }
        
        // Show next question or complete survey
        if (state.currentQuestion) {
          console.log(`[SURVEY] Showing next question: ${state.currentQuestion}`);
          await showSurveyQuestion(chatId, state.currentQuestion, state.language, env);
        } else {
          console.log(`[SURVEY] Survey completed, finishing up`);
          await completeSurvey(chatId, state, env);
        }
        
        return new Response('OK');
      }

      // D) Handle free lesson callback (replaces placement test)
      if (raw.callback_query?.data === 'lesson:free') {
        console.log(`User ${chatId} starting free lesson`);
        
        // Acknowledge callback
        await callTelegram('answerCallbackQuery', {
          callback_query_id: raw.callback_query.id
        }, env);
        
        // Check if user has completed the survey first
        const { results: surveyResults } = await db.prepare(
          `SELECT * FROM user_survey WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        if (surveyResults.length === 0) {
          console.log(`User ${chatId} hasn't completed survey, redirecting to survey`);
          await sendText(chatId, 
            "Please complete the survey first to help us personalize your learning experience.", 
            env);
          return new Response('OK');
        }
        
        // Get user language preference
        const { results } = await db.prepare(
          `SELECT interface_language FROM user_preferences WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        const language = results[0]?.interface_language || 'en';
        
        // Use survey language level directly (no CEFR mapping needed)
        const surveyLevel = surveyResults[0].language_level;
        console.log(`User ${chatId} survey level: ${surveyLevel}`);
        
        // Create initial user profile record (without eng_level since we'll use survey data)
        const startAt = new Date().toISOString();
        await db.prepare(
          `INSERT INTO user_profiles (telegram_id, start_test_at)
           VALUES (?, ?)
           ON CONFLICT(telegram_id) DO UPDATE
             SET start_test_at = COALESCE(excluded.start_test_at, start_test_at)`
        )
        .bind(parseInt(chatId, 10), startAt)
        .run();
        
        // Forward to lesson0 for free lesson
        console.log("Forwarding to LESSON0 for free lesson");
        return forward(env.LESSON0, {
          user_id: chatId,
          action: 'start_free'
        });
      }

      return new Response('OK');
    } catch (e) {
      console.error('Error in Newbies-funnel:', e, e.stack);

      // Try to inform the user about the error
      try {
        const chatId = raw.user_id || raw.message?.chat?.id;
        if (chatId) {
          await sendText(
            chatId,
            '⚙️ Sorry, a technical error occurred during the setup. Please try your request again in a moment. If the problem persists, you can use /start to begin again.',
            env
          );
        }
      } catch (sendError) {
        console.error('Fatal: Failed to send error message from newbies-funnel:', sendError);
      }
      
      // Return 200 OK to avoid Telegram retries
      return new Response('OK');
    }
  }
};

// Survey questions configuration
const SURVEY_QUESTIONS = {
  language_level: {
    ru: {
      question: "Какой у тебя уровень языка?",
      options: ["Начинающий", "Средний", "Продвинутый"]
    },
    en: {
      question: "What's your language level?",
      options: ["Beginner", "Intermediate", "Advanced"]
    }
  },
  study_goal: {
    ru: {
      question: "Основная цель изучения?",
      options: ["Для работы", "Для путешествий", "Для учебы", "Хобби", "Другое"]
    },
    en: {
      question: "Main study goal?",
      options: ["For work", "For travel", "For study", "Hobby", "Other"]
    }
  },
  gender: {
    ru: {
      question: "Укажи свой пол",
      options: ["Мужской", "Женский", "Предпочитаю не отвечать"]
    },
    en: {
      question: "What's your gender?",
      options: ["Male", "Female", "Prefer not to say"]
    }
  },
  age: {
    ru: {
      question: "Сколько тебе лет?",
      options: ["Менее 14", "14-21", "22-28", "29-35", "36-45", "46-60", "Более 60"]
    },
    en: {
      question: "How old are you?",
      options: ["Under 14", "14-21", "22-28", "29-35", "36-45", "46-60", "Over 60"]
    }
  },
  telegram_preference: {
    ru: {
      question: "Нравится ли тебе идея заниматься в Телеграм?",
      options: ["Да", "Предпочёл бы app"]
    },
    en: {
      question: "Do you like the idea of studying in Telegram?",
      options: ["Yes", "Prefer app"]
    }
  },
  voice_usage: {
    ru: {
      question: "Часто ли ты пользуешься голосовыми сообщениями в Телеграм?",
      options: ["Что это?", "Нет", "Иногда", "Постоянно"]
    },
    en: {
      question: "How often do you use voice messages in Telegram?",
      options: ["What's that?", "No", "Sometimes", "Constantly"]
    }
  }
};

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

async function startMiniSurvey(chatId, language, env) {
  console.log(`[SURVEY] Starting mini survey for user ${chatId} in language ${language}`);
  
  const firstQuestion = QUESTION_ORDER[0];
  
  // Initialize survey state
  const state = {
    language: language,
    currentQuestion: firstQuestion
  };
  
  console.log(`[SURVEY] Saving initial state:`, JSON.stringify(state));
  await env.CHAT_KV.put(`survey:${chatId}`, JSON.stringify(state));
  
  // Show first question
  console.log(`[SURVEY] Showing first question: ${firstQuestion}`);
  await showSurveyQuestion(chatId, firstQuestion, language, env);
}

async function showSurveyQuestion(chatId, questionType, language, env) {
  const questionConfig = SURVEY_QUESTIONS[questionType];
  if (!questionConfig) {
    console.error(`Unknown question type: ${questionType}`);
    return;
  }
  
  const question = questionConfig[language].question;
  const options = questionConfig[language].options;
  
  // Create keyboard with options
  const keyboard = options.map(option => [{
    text: option,
    callback_data: `survey:${questionType}:${option}`
  }]);
  
  await sendText(chatId, question, env, keyboard);
}

async function completeSurvey(chatId, surveyData, env) {
  console.log(`Completing survey for user ${chatId}:`, surveyData);
  
  // Save survey results to database
  await env.USER_DB.prepare(
    `INSERT INTO user_survey (telegram_id, language_level, study_goal, gender, age, telegram_preference, voice_usage, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE
     SET language_level = excluded.language_level,
         study_goal = excluded.study_goal,
         gender = excluded.gender,
         age = excluded.age,
         telegram_preference = excluded.telegram_preference,
         voice_usage = excluded.voice_usage,
         completed_at = excluded.completed_at`
  )
  .bind(
    parseInt(chatId, 10),
    surveyData.language_level,
    surveyData.study_goal,
    surveyData.gender,
    surveyData.age,
    surveyData.telegram_preference,
    surveyData.voice_usage,
    new Date().toISOString()
  )
  .run();
  
  // Clean up survey state
  await env.CHAT_KV.delete(`survey:${chatId}`);
  
  // Send tutor matching sequence
  const searchingMessage = surveyData.language === 'ru' 
    ? "🔍 Подбираю подходящего помощника LinguaPulse, который будет заниматься с тобой..."
    : "🔍 Finding the right LinguaPulse assistant who will work with you...";
  
  await sendText(chatId, searchingMessage, env);
  
  // Send "thinking" dots
  await sendText(chatId, "...", env);
  
  // Send tutor found message with free lesson offer
  const tutorFoundMessage = surveyData.language === 'ru' 
    ? "✅ Отлично! Найден подходящий тутор для твоего уровня. Давай попробуем первый бесплатный урок!"
    : "✅ Great! Found a suitable tutor for your level. Let's try your first free lesson!";
  
  await sendText(chatId, tutorFoundMessage, env, [
    [{ text: surveyData.language === 'ru' ? "Начать бесплатный урок" : "Start Free Lesson", callback_data: "lesson:free" }]
  ]);
}

// Helper functions
async function sendText(chatId, text, env, keyboard = null) {
  const payload = { 
    chat_id: chatId, 
    text,
    parse_mode: 'Markdown'
  };
  
  if (keyboard) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }
  
  // Determine correct bot token based on environment
  let botToken;
  if (env.DEV_MODE === 'true') {
    botToken = env.DEV_BOT_TOKEN;
    if (!botToken) {
      throw new Error("DEV_BOT_TOKEN is required in dev environment");
    }
  } else {
    botToken = env.BOT_TOKEN;
    if (!botToken) {
      throw new Error("BOT_TOKEN is required in production environment");
    }
  }
  
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' }, 
      body: JSON.stringify(payload) 
    }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram sendMessage error: ${errorText}`);
  }
}

async function callTelegram(method, payload, env) {
  // Determine correct bot token based on environment
  let botToken;
  if (env.DEV_MODE === 'true') {
    botToken = env.DEV_BOT_TOKEN;
    if (!botToken) {
      throw new Error("DEV_BOT_TOKEN is required in dev environment");
    }
  } else {
    botToken = env.BOT_TOKEN;
    if (!botToken) {
      throw new Error("BOT_TOKEN is required in production environment");
    }
  }
  
  const res = await fetch(
    `https://api.telegram.org/bot${botToken}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }
  );
  
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Telegram API error: ${errorText}`);
  }
  
  return res;
}

// Helper function to forward to other workers
function forward(service, payload) {
  console.log(`🔄 [FORWARD] Forwarding to service:`, service ? 'Service exists' : 'Service is undefined');
  console.log(`🔄 [FORWARD] Payload:`, JSON.stringify(payload).substring(0, 300));
  
  if (!service) {
    console.error(`❌ [FORWARD] Service binding is undefined`);
    throw new Error('Service binding is undefined');
  }
  
  if (typeof service.fetch !== 'function') {
    console.error(`❌ [FORWARD] Service doesn't have fetch method`);
    throw new Error('Service does not have a fetch method');
  }
  
  try {
    console.log(`🚀 [FORWARD] Calling service.fetch...`);
    const result = service.fetch('https://internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log(`✅ [FORWARD] service.fetch call successful`);
    return result;
  } catch (error) {
    console.error(`❌ [FORWARD] Error forwarding request:`, error);
    throw error;
  }
} 