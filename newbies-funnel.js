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

      // D) Handle start test callback
      if (raw.callback_query?.data === 'start_test') {
        console.log(`User ${chatId} starting placement test`);
        
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
        
        // Create initial user profile record
        const startAt = new Date().toISOString();
        await db.prepare(
          `INSERT INTO user_profiles (telegram_id, start_test_at)
           VALUES (?, ?)
           ON CONFLICT(telegram_id) DO UPDATE
             SET start_test_at = excluded.start_test_at`
        )
        .bind(parseInt(chatId, 10), startAt)
        .run();
        
        // Send test introduction message
        const testIntro = language === 'ru' 
          ? "🎯 *Тест на определение уровня английского языка*\n\n" +
            "Этот тест поможет определить ваш уровень владения английским языком по шкале CEFR (A1-C2).\n\n" +
            "Тест состоит из 12 вопросов:\n" +
            "• 5 вопросов по лексике\n" +
            "• 5 вопросов по грамматике\n" +
            "• 2 вопроса на понимание прочитанного\n\n" +
            "Готовы начать? Нажмите кнопку ниже!"
          : "🎯 *English Placement Test*\n\n" +
            "This test will help determine your English proficiency level according to the CEFR scale (A1-C2).\n\n" +
            "The test consists of 12 questions:\n" +
            "• 5 vocabulary questions\n" +
            "• 5 grammar questions\n" +
            "• 2 reading comprehension questions\n\n" +
            "Ready to start? Press the button below!";
        
        await sendText(chatId, testIntro, env, [
          [{ text: language === 'ru' ? "Начать тест" : "Start Test", callback_data: "start_test_questions" }]
        ]);
        
        return new Response('OK');
      }

      // E) Handle actual test start
      if (raw.callback_query?.data === 'start_test_questions') {
        console.log(`User ${chatId} starting test questions`);
        
        // Acknowledge callback
        await callTelegram('answerCallbackQuery', {
          callback_query_id: raw.callback_query.id
        }, env);
        
        // Initialize test state
        const testState = {
          questions: [],
          answers: [],
          index: 0,
          currentCategoryIndex: 0,
          categoryCompletionStatus: {
            vocabulary: 0,
            grammar: 0,
            reading: 0
          }
        };
        
        await kv.put(`test:${chatId}`, JSON.stringify(testState));
        
        // Start with first question
        await startTestQuestions(chatId, env);
        
        return new Response('OK');
      }

      // F) Handle test answers
      if (raw.callback_query?.data?.startsWith('test_answer:')) {
        const [_, answer] = raw.callback_query.data.split(':');
        console.log(`User ${chatId} answered test question: ${answer}`);
        
        // Get test state
        const testStateData = await kv.get(`test:${chatId}`) || '{}';
        const testState = JSON.parse(testStateData);
        
        // Save answer
        testState.answers[testState.index] = answer;
        testState.index++;
        
        await kv.put(`test:${chatId}`, JSON.stringify(testState));
        
        // Acknowledge callback
        await callTelegram('answerCallbackQuery', {
          callback_query_id: raw.callback_query.id
        }, env);
        
        // Show next question or complete test
        if (testState.index < 12) {
          await showNextTestQuestion(chatId, testState, env);
        } else {
          await completeTest(chatId, testState, env);
        }
        
        return new Response('OK');
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
  
  // Send completion message
  const completionMessage = surveyData.language === 'ru' 
    ? "🎉 Спасибо за ответы! Теперь давайте определим ваш уровень английского языка."
    : "🎉 Thank you for your answers! Now let's determine your English level.";
  
  await sendText(chatId, completionMessage, env, [
    [{ text: surveyData.language === 'ru' ? "Начать тест" : "Start Test", callback_data: "start_test" }]
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

// Test-related functions
async function startTestQuestions(chatId, env) {
  try {
    // Get first question from database
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM test_questions WHERE category = ? AND level = ? ORDER BY RANDOM() LIMIT 1')
      .bind('vocabulary', 'A1')
      .all();
    
    if (results.length === 0) {
      // Fallback question if database is empty
      const fallbackQuestion = {
        question_text: "What is the English word for 'hello'?",
        options: JSON.stringify(["Hello", "Goodbye", "Thank you", "Sorry"]),
        correct_answer: "Hello",
        category: "vocabulary",
        level: "A1"
      };
      await showTestQuestion(chatId, fallbackQuestion, 1, env);
      return;
    }
    
    const question = results[0];
    await showTestQuestion(chatId, question, 1, env);
  } catch (error) {
    console.error('Error starting test questions:', error);
    await sendText(chatId, "Sorry, there was an error loading the test. Please try again.", env);
  }
}

async function showTestQuestion(chatId, question, questionNumber, env) {
  try {
    const options = JSON.parse(question.options);
    const keyboard = options.map(option => [{
      text: option,
      callback_data: `test_answer:${option}`
    }]);
    
    const questionText = `*Question ${questionNumber}/12*\n\n` +
      `${getCategoryEmoji(question.category)} *${question.category.charAt(0).toUpperCase() + question.category.slice(1)}*\n\n` +
      question.question_text;
    
    await sendText(chatId, questionText, env, keyboard);
  } catch (error) {
    console.error('Error showing test question:', error);
    await sendText(chatId, "Sorry, there was an error showing the question. Please try again.", env);
  }
}

async function showNextTestQuestion(chatId, testState, env) {
  try {
    // Determine next category and level based on current state
    const categories = ['vocabulary', 'grammar', 'reading'];
    const currentCategory = categories[testState.currentCategoryIndex % 3];
    
    // Determine level based on performance
    let level = 'A1';
    if (testState.answers.length >= 3) {
      const correctAnswers = testState.answers.filter((answer, index) => 
        testState.questions[index] && answer === testState.questions[index].correct_answer
      ).length;
      const accuracy = correctAnswers / testState.answers.length;
      
      if (accuracy >= 0.8) level = 'A2';
      else if (accuracy <= 0.4) level = 'A1';
    }
    
    // Get next question
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM test_questions WHERE category = ? AND level = ? ORDER BY RANDOM() LIMIT 1')
      .bind(currentCategory, level)
      .all();
    
    if (results.length === 0) {
      // Fallback question
      const fallbackQuestion = {
        question_text: "Complete the sentence: I ___ English.",
        options: JSON.stringify(["speak", "speaks", "speaking", "spoke"]),
        correct_answer: "speak",
        category: currentCategory,
        level: level
      };
      testState.questions.push(fallbackQuestion);
      await showTestQuestion(chatId, fallbackQuestion, testState.index + 1, env);
      return;
    }
    
    const question = results[0];
    testState.questions.push(question);
    testState.currentCategoryIndex++;
    
    await env.CHAT_KV.put(`test:${chatId}`, JSON.stringify(testState));
    await showTestQuestion(chatId, question, testState.index + 1, env);
  } catch (error) {
    console.error('Error showing next test question:', error);
    await sendText(chatId, "Sorry, there was an error loading the next question. Please try again.", env);
  }
}

async function completeTest(chatId, testState, env) {
  try {
    // Calculate results
    const correctAnswers = testState.answers.filter((answer, index) => 
      testState.questions[index] && answer === testState.questions[index].correct_answer
    ).length;
    
    const accuracy = correctAnswers / testState.answers.length;
    let level = 'A1';
    
    if (accuracy >= 0.9) level = 'C1';
    else if (accuracy >= 0.8) level = 'B2';
    else if (accuracy >= 0.65) level = 'B1';
    else if (accuracy >= 0.45) level = 'A2';
    
    // Save test results
    const testedAt = new Date().toISOString();
    await env.USER_DB
      .prepare(
        `INSERT INTO user_profiles (telegram_id, eng_level, tested_at)
         VALUES (?, ?, ?)
         ON CONFLICT(telegram_id) DO UPDATE
           SET eng_level = excluded.eng_level,
               tested_at = excluded.tested_at`
      )
      .bind(parseInt(chatId, 10), level, testedAt)
      .run();
    
    // Clean up test state
    await env.CHAT_KV.delete(`test:${chatId}`);
    
    // Get user language preference
    const { results } = await env.USER_DB
      .prepare('SELECT interface_language FROM user_preferences WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    const language = results[0]?.interface_language || 'en';
    
    // Send results
    const resultMessage = language === 'ru'
      ? `🎓 *Тест завершен!*\n\n` +
        `Ваш уровень английского: *${level}*\n` +
        `Точность: ${Math.round(accuracy * 100)}%\n\n` +
        `Отличная работа! Теперь вы можете начать практиковать английский язык.`
      : `🎓 *Test completed!*\n\n` +
        `Your English level: *${level}*\n` +
        `Accuracy: ${Math.round(accuracy * 100)}%\n\n` +
        `Great work! Now you can start practicing English.`;
    
    await sendText(chatId, resultMessage, env, [
      [{ text: language === 'ru' ? "Бесплатный урок" : "Free Lesson", callback_data: "lesson:free" }]
    ]);
    
  } catch (error) {
    console.error('Error completing test:', error);
    await sendText(chatId, "Sorry, there was an error processing your test results. Please try again.", env);
  }
}

function getCategoryEmoji(category) {
  switch (category) {
    case 'vocabulary': return '📚';
    case 'grammar': return '📝';
    case 'reading': return '📖';
    default: return '❓';
  }
} 