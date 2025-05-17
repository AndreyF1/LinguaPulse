// linguapulse-test-bot worker.js
// Telegram webhook + структурированный тест + D1 (USER_DB) для профиля + KV для состояния (TEST_KV)
// нужно будет переделать структуру в Cloudflare

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'POST') {
      const update = await request.json().catch(() => ({}));
      ctx.waitUntil(handleUpdate(update, env, ctx));
      return new Response('OK');
    }
    return new Response('Welcome to LinguaPulseBot', { status: 200 });
  }
};

// Префикс для хранения состояния в KV
const STATE_PREFIX = 'state:';

// Основной обработчик запросов
async function handleUpdate(update, env, ctx) {
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  if (!chatId) return;

  // Вспомогательные функции для Telegram API
  const callT = (method, payload = {}) =>
    fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, ...payload })
    });

  const sendMessage = (text, keyboard) => {
    const opts = { text, parse_mode: 'Markdown' };
    if (keyboard) opts.reply_markup = { inline_keyboard: keyboard };
    return callT('sendMessage', opts);
  };

  const ack = (callbackId) =>
    callT('answerCallbackQuery', { callback_query_id: callbackId });

  const ask = (text, options) => {
    const kb = options.map(o => [{ text: o, callback_data: `next:${o}` }]);
    return sendMessage(text, kb);
  };

  // KV хранилище для состояния
  const kv = env.TEST_KV;
  const stateKey = STATE_PREFIX + chatId;
  const raw = await kv.get(stateKey);
  const allState = raw ? JSON.parse(raw) : {};
  
  // Данные о текущем состоянии теста
  let { 
    questions = [], 
    answers = [], 
    index = 0, 
    currentCategoryIndex = 0,
    categoryCompletionStatus = {
      vocabulary: 0,  // Количество заданных вопросов из категории
      grammar: 0,
      reading: 0
    }
  } = allState;

  // Обработка команды /start - первичное взаимодействие с ботом
  if (update.message?.text === '/start') {
    // Проверяем, прошел ли пользователь тест ранее
    const { results } = await env.USER_DB
      .prepare('SELECT eng_level FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    if (results.length > 0 && results[0].eng_level) {
      // Если уже есть уровень, просто перенаправляем
      await sendMessage("You've already completed the placement test. Your English level is " + results[0].eng_level + ".\n\nWhat would you like to do next?", [
        [{ text: "Free Audio Lesson", callback_data: "lesson:free" }],
        [{ text: "Retake Test", callback_data: "confirm_retest" }]
      ]);
      return;
    }

    // Проверяем, является ли это первым взаимодействием пользователя с ботом
    const isNewUser = results.length === 0;

    // Для новых пользователей показываем приветственное сообщение
    if (isNewUser) {
      await sendMessage(
        "👋 *Welcome to LinguaPulse!*\n\n" +
        "I'm your AI English tutor designed to help you improve your speaking skills through natural conversation.\n\n" +
        "*How it works:*\n" +
        "1️⃣ First, you'll take a short placement test to determine your English level\n" +
        "2️⃣ Then, you'll get audio lessons where we'll practice speaking together\n" +
        "3️⃣ You can learn in a safe and comfortable environment where it's okay to make mistakes\n" +
        "4️⃣ Practice anytime for just 10-15 minutes whenever you have free time\n\n" +
        "Ready to start your English journey? Press the button below!"
      , [[{ text: "Start Placement Test", callback_data: "start_test" }]]);
      
      // Сразу создаем запись в БД, чтобы при повторном /start пользователь уже не считался новым
      await env.USER_DB
        .prepare(
          `INSERT INTO user_profiles (telegram_id)
           VALUES (?)
           ON CONFLICT(telegram_id) DO NOTHING`
        )
        .bind(parseInt(chatId, 10))
        .run();
      
      return;
    }

    // Проверяем, был ли начат, но не завершен тест
    const { results: testProgress } = await env.USER_DB
      .prepare('SELECT start_test_at FROM user_profiles WHERE telegram_id = ? AND start_test_at IS NOT NULL AND eng_level IS NULL')
      .bind(parseInt(chatId, 10))
      .all();
    
    if (testProgress.length > 0) {
      // Если тест был начат, но не завершен, предлагаем продолжить или начать заново
      const testState = await kv.get(stateKey);
      if (testState) {
        await sendMessage(
          "You have an unfinished test. Would you like to continue where you left off or start a new test?",
          [
            [{ text: "Continue Test", callback_data: "continue_test" }],
            [{ text: "Start New Test", callback_data: "start_test" }]
          ]
        );
        return;
      }
    }

    // Для существующих пользователей (которые уже видели приветствие, но еще не прошли тест)
    // Отправляем сообщение о начале теста
    await sendMessage(
      "Welcome to *LinguaPulse English Placement Test*!\n\n" +
      "This test will help determine your English proficiency level according to the CEFR scale (A1-C2).\n\n" +
      "The test consists of 12 questions:\n" +
      "• 5 vocabulary questions\n" +
      "• 5 grammar questions\n" +
      "• 2 reading comprehension questions\n\n" +
      "Ready to start? Press the button below!"
    , [[{ text: "Start Test", callback_data: "start_test" }]]);
    
    return;
  }

  // Обработка команды /retest - явный запрос на повторное прохождение теста
  if (update.message?.text === '/retest') {
    // Проверяем, есть ли у пользователя уже определенный уровень
    const { results } = await env.USER_DB
      .prepare('SELECT eng_level FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    if (results.length > 0 && results[0].eng_level) {
      // Если уровень уже определен, запрашиваем подтверждение на перезапуск
      await sendMessage(
        `Your current English level is *${results[0].eng_level}*.\n\n` +
        "Are you sure you want to retake the test? Your current level will be overwritten with the new result.",
        [
          [{ text: "Yes, Retake Test", callback_data: "confirm_retest" }],
          [{ text: "No, Keep Current Level", callback_data: "keep_level" }]
        ]
      );
      return;
    } else {
      // Если уровень еще не определен, просто начинаем тест
      await sendMessage(
        "Welcome to *LinguaPulse English Placement Test*!\n\n" +
        "This test will help determine your English proficiency level according to the CEFR scale (A1-C2).\n\n" +
        "The test consists of 12 questions:\n" +
        "• 5 vocabulary questions\n" +
        "• 5 grammar questions\n" +
        "• 2 reading comprehension questions\n\n" +
        "Ready to start? Press the button below!"
      , [[{ text: "Start Test", callback_data: "start_test" }]]);
      return;
    }
  }

  // Обработка кнопки подтверждения перезапуска теста
  if (update.callback_query?.data === 'confirm_retest') {
    await ack(update.callback_query.id);
    await sendMessage(
      "You've chosen to retake the test. Your previous level will be overwritten with the new result.",
      [[{ text: "Start Test", callback_data: "start_test" }]]
    );
    return;
  }

  // Обработка кнопки сохранения текущего уровня
  if (update.callback_query?.data === 'keep_level') {
    await ack(update.callback_query.id);
    
    // Получаем текущий уровень пользователя
    const { results } = await env.USER_DB
      .prepare('SELECT eng_level FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    if (results.length > 0 && results[0].eng_level) {
      await sendMessage(
        `You've chosen to keep your current English level: *${results[0].eng_level}*.\n\n` +
        "What would you like to do next?",
        [[{ text: "Free Audio Lesson", callback_data: "lesson:free" }]]
      );
    } else {
      // Если по какой-то причине уровень не найден
      await sendMessage(
        "I couldn't find your current level. Let's take the test to determine it.",
        [[{ text: "Start Test", callback_data: "start_test" }]]
      );
    }
    return;
  }

  // Обработка кнопки начала теста - универсальный обработчик для первичного запуска и перезапуска
  if (update.callback_query?.data === 'start_test') {
    await ack(update.callback_query.id);
    
    // Сбрасываем состояние теста
    questions = [];
    answers = [];
    index = 0;
    currentCategoryIndex = 0;
    categoryCompletionStatus = {
      vocabulary: 0,
      grammar: 0,
      reading: 0
    };
    
    // Записываем время начала теста
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
    
    // Загружаем первый вопрос из базы
    const firstQuestion = await fetchNextQuestion(env, 'vocabulary', 'A1');
    questions.push(firstQuestion);
    
    await kv.put(stateKey, JSON.stringify({ 
      questions, 
      answers, 
      index, 
      currentCategoryIndex,
      categoryCompletionStatus
    }));
    
    // Показываем первый вопрос
    await ask(formatQuestion(firstQuestion, 1, 12), firstQuestion.options);
    return;
  }
  
  // Обработка кнопки продолжения теста
  if (update.callback_query?.data === 'continue_test') {
    await ack(update.callback_query.id);
    
    // Проверяем наличие сохраненного состояния теста
    const testState = await kv.get(stateKey);
    if (!testState) {
      // Если состояние теста не найдено, начинаем новый тест
      await sendMessage(
        "Sorry, I couldn't find your previous test session :( Let's start a new test.",
        [[{ text: "Start Test", callback_data: "start_test" }]]
      );
      return;
    }
    
    const state = JSON.parse(testState);
    questions = state.questions || [];
    answers = state.answers || [];
    index = state.index || 0;
    currentCategoryIndex = state.currentCategoryIndex || 0;
    categoryCompletionStatus = state.categoryCompletionStatus || {
      vocabulary: 0,
      grammar: 0,
      reading: 0
    };
    
    // Проверяем, есть ли текущий вопрос
    if (questions.length > index) {
      // Показываем текущий вопрос
      await ask(formatQuestion(questions[index], index + 1, 12), questions[index].options);
      return;
    } else {
      // Что-то пошло не так, начинаем новый тест
      await sendMessage(
        "Sorry, I couldn't properly restore your test. Let's start a new one.",
        [[{ text: "Start Test", callback_data: "start_test" }]]
      );
      return;
    }
  }
  
  // Обработка ответов на вопросы
  if (update.callback_query?.data?.startsWith('next:')) {
    await ack(update.callback_query.id);
    const selectedAnswer = update.callback_query.data.slice(5);
    answers[index] = selectedAnswer;
    
    // Проверяем правильность ответа
    const currentQuestion = questions[index];
    const isCorrect = (selectedAnswer === currentQuestion.answer);
    
    // Обновляем статус завершения для текущей категории
    categoryCompletionStatus[currentQuestion.category]++;
    
    // Определяем, какую категорию вопросов задавать следующей
    const categories = ['vocabulary', 'grammar', 'reading'];
    currentCategoryIndex = (currentCategoryIndex + 1) % 3;
    
    // Проверяем, не достигли ли лимитов для категорий
    if (categoryCompletionStatus.vocabulary >= 5 && categories[currentCategoryIndex] === 'vocabulary') {
      currentCategoryIndex = (currentCategoryIndex + 1) % 3;
    }
    if (categoryCompletionStatus.grammar >= 5 && categories[currentCategoryIndex] === 'grammar') {
      currentCategoryIndex = (currentCategoryIndex + 1) % 3;
    }
    if (categoryCompletionStatus.reading >= 2 && categories[currentCategoryIndex] === 'reading') {
      currentCategoryIndex = (currentCategoryIndex + 1) % 3;
    }
    
    // Определяем следующий уровень сложности
    let nextLevel;
    if (index < 3) {
      // Первые несколько вопросов фиксированного уровня для калибровки
      nextLevel = 'A1';
    } else {
      // Адаптируем сложность на основе ответов
      const correctRatio = answers.filter((a, i) => a === questions[i].answer).length / answers.length;
      
      if (correctRatio >= 0.8) {
        // При высокой точности увеличиваем сложность
        const currentLevel = currentQuestion.level;
        if (currentLevel === 'A1') nextLevel = 'A2';
        else if (currentLevel === 'A2') nextLevel = 'B1';
        else if (currentLevel === 'B1') nextLevel = 'B2';
        else if (currentLevel === 'B2') nextLevel = 'C1';
        else nextLevel = 'C1';
      } else if (correctRatio <= 0.4) {
        // При низкой точности снижаем сложность
        const currentLevel = currentQuestion.level;
        if (currentLevel === 'C1') nextLevel = 'B2';
        else if (currentLevel === 'B2') nextLevel = 'B1';
        else if (currentLevel === 'B1') nextLevel = 'A2';
        else nextLevel = 'A1';
      } else {
        // Сохраняем текущий уровень
        nextLevel = currentQuestion.level;
      }
    }
    
    // Переходим к следующему вопросу
    index++;
    
    // Сохраняем обновленное состояние
    await kv.put(stateKey, JSON.stringify({ 
      questions, 
      answers, 
      index, 
      currentCategoryIndex,
      categoryCompletionStatus
    }));

    // Проверяем, завершен ли тест (12 вопросов или достигнуты все лимиты категорий)
    const testComplete = index >= 12 || 
                        (categoryCompletionStatus.vocabulary >= 5 && 
                         categoryCompletionStatus.grammar >= 5 && 
                         categoryCompletionStatus.reading >= 2);

    if (!testComplete) {
      // Загружаем следующий вопрос из базы
      const nextCategory = categories[currentCategoryIndex];
      const nextQuestion = await fetchNextQuestion(env, nextCategory, nextLevel);
      questions.push(nextQuestion);
      
      await kv.put(stateKey, JSON.stringify({ 
        questions, 
        answers, 
        index, 
        currentCategoryIndex,
        categoryCompletionStatus
      }));
      
      // Показываем следующий вопрос
      await ask(formatQuestion(nextQuestion, index + 1, 12), nextQuestion.options);
      return;
    }

    // Завершаем тест: оцениваем уровень и обновляем eng_level и tested_at
    const { level, report } = evaluateTest(questions, answers);
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

    await kv.delete(stateKey);
    
    // Форматируем сообщение о результатах теста
    const correctCount = answers.filter((answer, i) => answer === questions[i].answer).length;
    const accuracy = Math.round((correctCount / questions.length) * 100);
    
    let resultMessage = `🎓 *Test completed!*\n\n` +
                        `Your English level: *${level}*\n` +
                        `Accuracy: ${accuracy}%\n\n`;
    
    // Добавляем описание уровня
    resultMessage += getLevelDescription(level) + "\n\n";
    
    // Добавляем отчет об ошибках, если они были
    if (report.length > 0) {
      resultMessage += "*Areas for improvement:*\n";
      resultMessage += report;
    } else {
      resultMessage += "🌟 *Excellent work!* You answered all questions correctly.";
    }
    
    await sendMessage(
      resultMessage,
      [[{ text: "Free Audio Lesson", callback_data: "lesson:free" }]]
    );
    return;
  }

  // Запуск бесплатного аудио-урока
  if (update.callback_query?.data === 'lesson:free') {
    await ack(update.callback_query.id);
    await sendMessage('Starting free audio lesson…');
    ctx.waitUntil(
      env.LESSON0.fetch('https://dummy.internal/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: chatId, action: 'start_free' })
      })
    );
    return;
  }

  // Запасной вариант
  if (update.message) {
    await sendMessage('Press /start to begin the placement test.');
  }
}

// Форматирование вопроса с указанием номера
function formatQuestion(question, current, total) {
  let formattedText = `*Question ${current}/${total}*\n\n`;
  
  // Добавляем индикатор категории
  if (question.category === 'vocabulary') {
    formattedText += '📚 *Vocabulary*\n\n';
  } else if (question.category === 'grammar') {
    formattedText += '📝 *Grammar*\n\n';
  } else if (question.category === 'reading') {
    formattedText += '📖 *Reading*\n\n';
  }
  
  // Добавляем текст вопроса
  formattedText += question.question;
  
  return formattedText;
}

// Функция для получения вопроса из базы данных (или другого источника)
async function fetchNextQuestion(env, category, level) {
  // Здесь следует реализовать логику получения вопроса из хранилища
  // Это может быть запрос к KV, D1 или другой внешней базе данных
  
  // Пример: Получаем вопрос из таблицы вопросов в D1
  const query = `
    SELECT * FROM test_questions 
    WHERE category = ? AND level = ? 
    ORDER BY RANDOM() 
    LIMIT 1
  `;
  
  try {
    const { results } = await env.USER_DB
      .prepare(query)
      .bind(category, level)
      .all();
    
    if (results && results.length > 0) {
      // Форматируем вопрос из базы данных
      return {
        id: results[0].id,
        category: results[0].category,
        level: results[0].level,
        question: results[0].question_text,
        options: JSON.parse(results[0].options),
        answer: results[0].correct_answer
      };
    }
  } catch (error) {
    console.error("Error fetching question:", error);
  }
  
  // Если не удалось получить вопрос из базы, используем резервные вопросы
  return getFallbackQuestion(category, level);
}

// Резервные вопросы на случай, если база данных недоступна
function getFallbackQuestion(category, level) {
  // Здесь можно реализовать небольшой набор резервных вопросов для каждой категории и уровня
  const fallbackQuestions = {
    vocabulary: {
      A1: {
        question: "What is the meaning of 'begin'?",
        options: ["End", "Start", "Stop", "Continue"],
        answer: "Start",
        category: "vocabulary",
        level: "A1"
      },
      // Другие уровни...
    },
    grammar: {
      A1: {
        question: "Complete the sentence: She ___ a student.",
        options: ["am", "is", "are", "be"],
        answer: "is",
        category: "grammar",
        level: "A1"
      },
      // Другие уровни...
    },
    reading: {
      A1: {
        question: "Read and answer:\n\nMy name is John. I am from England. I speak English.\n\nWhere is John from?",
        options: ["America", "England", "France", "Spain"],
        answer: "England",
        category: "reading",
        level: "A1"
      },
      // Другие уровни...
    }
  };
  
  // Возвращаем базовый вопрос для запрошенной категории и уровня
  return fallbackQuestions[category][level] || fallbackQuestions.vocabulary.A1;
}

// Оценка результатов теста для определения уровня английского
function evaluateTest(questions, answers) {
  let correct = 0;
  const incorrectByCategory = {
    vocabulary: [],
    grammar: [],
    reading: []
  };

  // Подсчитываем правильные ответы и отслеживаем ошибки по категориям
  questions.forEach((q, i) => {
    if (answers[i] === q.answer) {
      correct++;
    } else {
      // Сохраняем ошибку в соответствующей категории
      if (q.category === 'vocabulary') {
        incorrectByCategory.vocabulary.push(q);
      } else if (q.category === 'grammar') {
        incorrectByCategory.grammar.push(q);
      } else if (q.category === 'reading') {
        incorrectByCategory.reading.push(q);
      }
    }
  });

  // Вычисляем процент правильных ответов
  const accuracy = questions.length ? (correct / questions.length) : 0;
  
  // Определяем уровень на основе точности и сложности вопросов
  let level;
  if (accuracy >= 0.9) level = 'C1';
  else if (accuracy >= 0.8) level = 'B2';
  else if (accuracy >= 0.65) level = 'B1';
  else if (accuracy >= 0.45) level = 'A2';
  else level = 'A1';
  
  // Также учитываем максимальную сложность правильно отвеченных вопросов
  const correctlyAnsweredLevels = questions
    .filter((q, i) => answers[i] === q.answer)
    .map(q => q.level);
  
  if (correctlyAnsweredLevels.includes('C1') && accuracy >= 0.8) {
    level = 'C1';
  } else if (correctlyAnsweredLevels.includes('B2') && accuracy >= 0.7) {
    level = 'B2';
  }
  
  // Генерируем подробный отчет о неправильных ответах
  let report = '';
  
  // Отчет по ошибкам в словарном запасе
  if (incorrectByCategory.vocabulary.length > 0) {
    report += '• *Vocabulary*: ';
    if (incorrectByCategory.vocabulary.length === 1) {
      const q = incorrectByCategory.vocabulary[0];
      report += `"${q.question}" - Correct answer: "${q.answer}"\n`;
    } else {
      report += `You missed ${incorrectByCategory.vocabulary.length} vocabulary questions.\n`;
    }
  }
  
  // Отчет по ошибкам в грамматике
  if (incorrectByCategory.grammar.length > 0) {
    report += '• *Grammar*: ';
    if (incorrectByCategory.grammar.length === 1) {
      const q = incorrectByCategory.grammar[0];
      report += `"${q.question}" - Correct answer: "${q.answer}"\n`;
    } else {
      report += `You missed ${incorrectByCategory.grammar.length} grammar questions.\n`;
    }
  }
  
  // Отчет по ошибкам в чтении
  if (incorrectByCategory.reading.length > 0) {
    report += '• *Reading*: ';
    if (incorrectByCategory.reading.length === 1) {
      const q = incorrectByCategory.reading[0];
      report += `"${q.question.split('\n\n')[0]}..." - Correct answer: "${q.answer}"\n`;
    } else {
      report += `You missed ${incorrectByCategory.reading.length} reading questions.\n`;
    }
  }

  return { level, report };
}

// Получение описания для уровня CEFR
function getLevelDescription(level) {
  const descriptions = {
    'A1': "At A1 level, you can understand and use familiar everyday expressions and very basic phrases. You can introduce yourself and others, and ask and answer questions about personal details.",
    'A2': "At A2 level, you can understand sentences and frequently used expressions related to areas of most immediate relevance. You can communicate in simple and routine tasks requiring a simple and direct exchange of information.",
    'B1': "At B1 level, you can deal with most situations likely to arise while traveling in areas where the language is spoken. You can describe experiences and events, dreams, hopes & ambitions, and briefly give reasons and explanations for opinions and plans.",
    'B2': "At B2 level, you can interact with a degree of fluency and spontaneity that makes regular interaction with native speakers quite possible. You can explain your viewpoint on a topical issue, giving the advantages and disadvantages of various options.",
    'C1': "At C1 level, you can use language flexibly and effectively for social, academic and professional purposes. You can produce clear, well-structured, detailed text on complex subjects, showing controlled use of organizational patterns, connectors and cohesive devices."
  };
  
  return descriptions[level] || "Your English level has been assessed.";
}
