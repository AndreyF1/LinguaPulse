// newbies-funnel worker.js
// Handles onboarding funnel: language selection and mini-survey

export default {
  async fetch(request, env, ctx) {
    try {
      const raw = await request.json();
      console.log('Newbies-funnel raw update:', JSON.stringify(raw).substring(0, 500) + '...');
      const chatId = raw.user_id || raw.message?.chat?.id;
      if (!chatId) return new Response('OK');

      const db = env.USER_DB;
      const kv = env.CHAT_KV;

      // A) Start onboarding funnel trigger
      if (raw.action === 'start_onboarding') {
        console.log(`Starting onboarding funnel for user ${chatId}`);
        
        // Check if user already completed onboarding
        const { results } = await db.prepare(
          `SELECT interface_language FROM user_preferences 
           WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        if (results.length > 0 && results[0].interface_language) {
          console.log(`User ${chatId} already completed onboarding, redirecting to main flow`);
          // User already completed onboarding, redirect to main flow
          await sendText(
            chatId, 
            "Welcome back! Use /start to begin your English learning journey.",
            env
          );
          return new Response('OK');
        }
        
        // Send welcome message in both languages
        const welcomeMessage = 
          "👋 Привет! Я LinguaPulse, AI учитель, созданный для помощи в изучении английского языка.\n\n" +
          "Hello! I'm LinguaPulse, an AI teacher created to help you learn English.\n\n" +
          "🌍 На каком языке оставить интерфейс? / What language should I use for the interface?";
        
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
        
        // Save language preference
        await db.prepare(
          `INSERT INTO user_preferences (telegram_id, interface_language, created_at)
           VALUES (?, ?, ?)
           ON CONFLICT(telegram_id) DO UPDATE
           SET interface_language = excluded.interface_language`
        )
        .bind(parseInt(chatId, 10), selectedLanguage, new Date().toISOString())
        .run();
        
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
        console.log(`User ${chatId} answered ${questionType}: ${answer}`);
        
        // Get current survey state
        const surveyState = await kv.get(`survey:${chatId}`) || '{}';
        const state = JSON.parse(surveyState);
        
        // Save answer
        state[questionType] = answer;
        state.currentQuestion = getNextQuestion(questionType);
        
        await kv.put(`survey:${chatId}`, JSON.stringify(state));
        
        // Acknowledge callback
        await callTelegram('answerCallbackQuery', {
          callback_query_id: raw.callback_query.id
        }, env);
        
        // Show next question or complete survey
        if (state.currentQuestion) {
          await showSurveyQuestion(chatId, state.currentQuestion, state.language, env);
        } else {
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
        
        // Get user language preference
        const { results } = await db.prepare(
          `SELECT interface_language FROM user_preferences WHERE telegram_id = ?`
        )
        .bind(parseInt(chatId, 10))
        .all();
        
        const language = results[0]?.interface_language || 'en';
        
        // Create initial user profile record with default level
        const startAt = new Date().toISOString();
        await db.prepare(
          `INSERT INTO user_profiles (telegram_id, eng_level, start_test_at)
           VALUES (?, ?, ?)
           ON CONFLICT(telegram_id) DO UPDATE
             SET eng_level = COALESCE(excluded.eng_level, eng_level),
                 start_test_at = COALESCE(excluded.start_test_at, start_test_at)`
        )
        .bind(parseInt(chatId, 10), 'B1', startAt) // Default to B1 level
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
      console.error('Error in Newbies-funnel:', e);
      return new Response('Error: ' + e.message, { status: 500 });
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
      options: ["Для работы", "Для путешествий", "Для учебы в зарубежном учреждении", "Хобби", "Другое"]
    },
    en: {
      question: "Main study goal?",
      options: ["For work", "For travel", "For studying abroad", "Hobby", "Other"]
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
      options: ["Да", "Предпочел бы приложение"]
    },
    en: {
      question: "Do you like the idea of studying in Telegram?",
      options: ["Yes", "Would prefer an app"]
    }
  },
  voice_usage: {
    ru: {
      question: "Часто ли ты пользуешься голосовыми сообщениями в Телеграм?",
      options: ["Что это?", "Нет, не пользуюсь", "Иногда бывает", "Постоянно использую"]
    },
    en: {
      question: "How often do you use voice messages in Telegram?",
      options: ["What's that?", "No, I don't use them", "Sometimes", "I use them constantly"]
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
  const firstQuestion = QUESTION_ORDER[0];
  
  // Initialize survey state
  const state = {
    language: language,
    currentQuestion: firstQuestion
  };
  
  await env.CHAT_KV.put(`survey:${chatId}`, JSON.stringify(state));
  
  // Show first question
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
  
  // Send completion message and offer free lesson
  const completionMessage = surveyData.language === 'ru' 
    ? "🎉 Спасибо за ответы! Теперь давайте попробуем бесплатный аудио-урок английского языка."
    : "🎉 Thank you for your answers! Now let's try a free audio English lesson.";
  
  await sendText(chatId, completionMessage, env, [
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
  
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
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
  const res = await fetch(
    `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`,
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