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
  console.log('Received update:', JSON.stringify(update));
  
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  if (!chatId) {
    console.log('No chatId found in update');
    return;
  }
  console.log('Processing update for chatId:', chatId);
  
  // Если есть callback_query, логируем его отдельно для отладки
  if (update.callback_query) {
    console.log('Received callback_query:', JSON.stringify(update.callback_query));
  }

  // Вспомогательные функции для Telegram API
  const callT = async (method, payload = {}) => {
    console.log(`Calling Telegram API: ${method}`, JSON.stringify(payload).slice(0, 200) + '...');
    try {
      const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, ...payload })
      });
      
      const result = await response.json();
      console.log(`Telegram API response for ${method}:`, JSON.stringify(result).slice(0, 200) + '...');
      
      if (!result.ok) {
        console.error(`Telegram API error for ${method}:`, result.description);
        throw new Error(`Telegram API error: ${result.description}`);
      }
      
      return result;
    } catch (error) {
      console.error(`Error calling Telegram API ${method}:`, error);
      throw error;
    }
  };

  const sendMessage = async (text, keyboard) => {
    // Убедимся, что текст - строка
    if (typeof text !== 'string') {
      console.error('Invalid text type:', typeof text);
      text = String(text);
    }
    
    // Проверяем наличие экранированных последовательностей, которые нужно конвертировать
    if (text.includes('\\n')) {
      console.log('Found escaped newlines in message text, replacing them');
      text = text.replace(/\\n/g, '\n');
    }
    
    const opts = { text, parse_mode: 'Markdown' };
    if (keyboard) opts.reply_markup = { inline_keyboard: keyboard };
    console.log('Sending message:', text.slice(0, 50) + '...');
    
    try {
      const result = await callT('sendMessage', opts);
      console.log('Message sent successfully, message_id:', result.result?.message_id);
      return result;
    } catch (error) {
      console.error('Failed to send message:', error);
      // Попробуем отправить без Markdown форматирования, если это могло вызвать проблему
      if (error.message?.includes('can\'t parse entities') || error.message?.includes('markdown')) {
        console.log('Trying to send without markdown...');
        const plainOpts = { ...opts, parse_mode: undefined, text: text.replace(/[*_`]/g, '') };
        return await callT('sendMessage', plainOpts);
      }
      throw error;
    }
  };

  const ack = async (callbackId) => {
    try {
      return await callT('answerCallbackQuery', { callback_query_id: callbackId });
    } catch (error) {
      console.error('Failed to acknowledge callback query:', error);
      // Продолжаем выполнение даже при ошибке
    }
  };

  const ask = async (text, options) => {
    console.log('Creating keyboard for options:', JSON.stringify(options));
    try {
      const kb = options.map(o => [{ text: o, callback_data: `next:${o}` }]);
      return await sendMessage(text, kb);
    } catch (error) {
      console.error('Error in ask function:', error);
      // Попробуем отправить базовый вариант
      return await sendMessage(`Question: ${text}\n\nChoose one of: ${options.join(', ')}`);
    }
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
    console.log('Starting test for user', chatId);
    
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
    try {
      console.log('Updating user profile with start_test_at:', startAt);
      await env.USER_DB
        .prepare(
          `INSERT INTO user_profiles (telegram_id, start_test_at)
           VALUES (?, ?)
           ON CONFLICT(telegram_id) DO UPDATE
             SET start_test_at = excluded.start_test_at`
        )
        .bind(parseInt(chatId, 10), startAt)
        .run();
      
      console.log('User profile updated successfully');
    } catch (error) {
      console.error('Error updating user profile:', error);
    }
    
    // Проверяем доступные категории в базе данных
    try {
      const categoriesQuery = `
        SELECT DISTINCT category FROM test_questions
      `;
      
      const categoriesResult = await env.USER_DB
        .prepare(categoriesQuery)
        .all();
      
      console.log('Available categories:', JSON.stringify(categoriesResult));
      
      // Определяем первую категорию для вопроса
      let firstCategory = 'vocabulary';
      
      if (categoriesResult.results && categoriesResult.results.length > 0) {
        // Проверяем, есть ли категория vocabulary
        const hasVocabulary = categoriesResult.results.some(
          cat => cat.category.toLowerCase() === 'vocabulary'
        );
        
        if (!hasVocabulary) {
          // Если нет vocabulary, берем первую доступную категорию
          firstCategory = categoriesResult.results[0].category;
          console.log(`No vocabulary category found, using ${firstCategory} instead`);
        }
      }
      
      // Загружаем первый вопрос из базы
      console.log(`Fetching first question (${firstCategory}, A1)`);
      const firstQuestion = await fetchNextQuestion(env, firstCategory, 'A1', []);
      
      if (!firstQuestion) {
        console.error('Failed to fetch first question');
        await sendMessage(
          "Sorry, there was a problem loading the test. Please try again later.",
          [[{ text: "Try Again", callback_data: "start_test" }]]
        );
        return;
      }
      
      // Обновляем индекс категории для следующего вопроса
      const categories = ['vocabulary', 'grammar', 'reading'];
      currentCategoryIndex = categories.indexOf(firstQuestion.category);
      if (currentCategoryIndex === -1) currentCategoryIndex = 0;
      
      console.log('First question:', JSON.stringify(firstQuestion));
      console.log('Current category index:', currentCategoryIndex);
      questions.push(firstQuestion);
      
      // Обновляем счетчик категории
      categoryCompletionStatus[firstQuestion.category]++;
      
      try {
        console.log('Saving initial state to KV');
        await kv.put(stateKey, JSON.stringify({ 
          questions, 
          answers, 
          index, 
          currentCategoryIndex,
          categoryCompletionStatus
        }));
        console.log('Initial state saved successfully');
      } catch (error) {
        console.error('Error saving initial state:', error);
      }
      
      // Показываем первый вопрос
      try {
        console.log('Sending first question to user');
        const formattedQuestion = formatQuestion(firstQuestion, 1, 12);
        console.log('Formatted question:', formattedQuestion);
        console.log('Options:', firstQuestion.options);
        await ask(formattedQuestion, firstQuestion.options);
        console.log('First question sent successfully');
      } catch (error) {
        console.error('Error sending first question:', error);
      }
    } catch (error) {
      console.error('Error checking available categories:', error);
      
      // В случае ошибки используем запасной вопрос
      const fallbackQuestion = getFallbackQuestion('vocabulary', 'A1');
      questions.push(fallbackQuestion);
      
      await kv.put(stateKey, JSON.stringify({ 
        questions, 
        answers, 
        index, 
        currentCategoryIndex,
        categoryCompletionStatus
      }));
      
      await ask(formatQuestion(fallbackQuestion, 1, 12), fallbackQuestion.options);
    }
    
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
        "Sorry, I couldn't find your previous test session. Let's start a new test.",
        [[{ text: "Start Test", callback_data: "start_test" }]]
      );
      return;
    }
    
    try {
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
        // Если нужно загрузить следующий вопрос
        const categories = ['vocabulary', 'grammar', 'reading'];
        if (currentCategoryIndex >= 0 && currentCategoryIndex < categories.length) {
          const nextCategory = categories[currentCategoryIndex];
          
          // Определяем следующий уровень сложности на основе предыдущих ответов
          let nextLevel = 'A1'; // Уровень по умолчанию
          
          if (questions.length > 0) {
            const lastQuestion = questions[questions.length - 1];
            // Если уже были вопросы, используем тот же уровень сложности, что и для последнего вопроса
            nextLevel = lastQuestion.level;
            
            // Если есть достаточно ответов, можно адаптировать сложность
            if (answers.length >= 3) {
              const correctRatio = answers.filter((a, i) => a === questions[i].answer).length / answers.length;
              console.log('Correct ratio for next question level:', correctRatio);
              
              if (correctRatio >= 0.8) {
                // При высокой точности увеличиваем сложность
                if (nextLevel === 'A1') nextLevel = 'A2';
                else if (nextLevel === 'A2') nextLevel = 'B1';
                else if (nextLevel === 'B1') nextLevel = 'B2';
                else if (nextLevel === 'B2') nextLevel = 'C1';
              } else if (correctRatio <= 0.4) {
                // При низкой точности снижаем сложность
                if (nextLevel === 'C1') nextLevel = 'B2';
                else if (nextLevel === 'B2') nextLevel = 'B1';
                else if (nextLevel === 'B1') nextLevel = 'A2';
                else if (nextLevel === 'A2') nextLevel = 'A1';
              }
            }
          }
          
          console.log('Continuing test, fetching next question:', nextCategory, nextLevel);
          
          // Получаем ID всех предыдущих вопросов для исключения повторов
          const askedQuestionIds = questions
            .filter(q => q.id) // Фильтруем только вопросы с ID (из базы данных)
            .map(q => q.id);
          console.log('Previously asked question IDs:', askedQuestionIds);
          
          const nextQuestion = await fetchNextQuestion(env, nextCategory, nextLevel, askedQuestionIds);
          questions.push(nextQuestion);
          
          await kv.put(stateKey, JSON.stringify({ 
            questions, 
            answers, 
            index, 
            currentCategoryIndex,
            categoryCompletionStatus
          }));
          
          await ask(formatQuestion(nextQuestion, index + 1, 12), nextQuestion.options);
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
    } catch (error) {
      console.error('Error continuing test:', error);
      await sendMessage(
        "Sorry, there was an error restoring your test. Let's start a new one.",
        [[{ text: "Start Test", callback_data: "start_test" }]]
      );
      return;
    }
  }
  
  // Обработка ответов на вопросы
  if (update.callback_query?.data?.startsWith('next:')) {
    try {
      await ack(update.callback_query.id);
      
      // Проверяем структуру callback_data
      console.log('Received callback_data:', update.callback_query.data);
      const selectedAnswer = update.callback_query.data.slice(5);
      console.log('Selected answer:', selectedAnswer);
      
      // Проверяем состояние теста
      console.log('Current state:', {
        'questions.length': questions.length,
        'index': index,
        'answers': answers
      });
      
      if (index >= questions.length) {
        console.error('Invalid state: index out of bounds');
        await sendMessage(
          "Sorry, something went wrong with your test session. Let's start again.",
          [[{ text: "Start Test", callback_data: "start_test" }]]
        );
        return;
      }
      
      answers[index] = selectedAnswer;
      
      // Проверяем правильность ответа
      const currentQuestion = questions[index];
      console.log('Current question:', JSON.stringify(currentQuestion));
      
      // Проверяем, что answer и selectedAnswer в одинаковом формате
      console.log('Answer comparison:', {
        'correct_answer': currentQuestion.answer,
        'selected_answer': selectedAnswer,
        'match': selectedAnswer === currentQuestion.answer
      });
      
      const isCorrect = (selectedAnswer === currentQuestion.answer);
      console.log('Answer:', selectedAnswer, 'Correct:', isCorrect);
      
      // Обновляем статус завершения для текущей категории
      categoryCompletionStatus[currentQuestion.category]++;
      console.log('Category completion status:', JSON.stringify(categoryCompletionStatus));
      
      // Определяем, какую категорию вопросов задавать следующей
      const categories = ['vocabulary', 'grammar', 'reading'];
      currentCategoryIndex = (currentCategoryIndex + 1) % 3;
      console.log('New category index:', currentCategoryIndex);
      
      // Проверяем, не достигли ли лимитов для категорий
      if (categoryCompletionStatus.vocabulary >= 5 && categories[currentCategoryIndex] === 'vocabulary') {
        console.log('Vocabulary limit reached, skipping category');
        currentCategoryIndex = (currentCategoryIndex + 1) % 3;
      }
      if (categoryCompletionStatus.grammar >= 5 && categories[currentCategoryIndex] === 'grammar') {
        console.log('Grammar limit reached, skipping category');
        currentCategoryIndex = (currentCategoryIndex + 1) % 3;
      }
      if (categoryCompletionStatus.reading >= 2 && categories[currentCategoryIndex] === 'reading') {
        console.log('Reading limit reached, skipping category');
        currentCategoryIndex = (currentCategoryIndex + 1) % 3;
      }
      console.log('Final category index after limits check:', currentCategoryIndex);
      
      // Определяем следующий уровень сложности
      let nextLevel;
      if (index < 3) {
        // Первые несколько вопросов фиксированного уровня для калибровки
        nextLevel = 'A1';
      } else {
        // Адаптируем сложность на основе ответов
        const correctRatio = answers.filter((a, i) => a === questions[i].answer).length / answers.length;
        console.log('Correct ratio:', correctRatio);
        
        if (correctRatio >= 0.8) {
          // При высокой точности увеличиваем сложность
          const currentLevel = currentQuestion.level;
          console.log('Increasing difficulty from', currentLevel);
          if (currentLevel === 'A1') nextLevel = 'A2';
          else if (currentLevel === 'A2') nextLevel = 'B1';
          else if (currentLevel === 'B1') nextLevel = 'B2';
          else if (currentLevel === 'B2') nextLevel = 'C1';
          else nextLevel = 'C1';
        } else if (correctRatio <= 0.4) {
          // При низкой точности снижаем сложность
          const currentLevel = currentQuestion.level;
          console.log('Decreasing difficulty from', currentLevel);
          if (currentLevel === 'C1') nextLevel = 'B2';
          else if (currentLevel === 'B2') nextLevel = 'B1';
          else if (currentLevel === 'B1') nextLevel = 'A2';
          else nextLevel = 'A1';
        } else {
          // Сохраняем текущий уровень
          nextLevel = currentQuestion.level;
        }
      }
      console.log('Next level:', nextLevel);
      
      // Переходим к следующему вопросу
      index++;
      
      // Сохраняем обновленное состояние
      try {
        const stateToSave = { 
          questions, 
          answers, 
          index, 
          currentCategoryIndex,
          categoryCompletionStatus
        };
        console.log('Saving state to KV');
        await kv.put(stateKey, JSON.stringify(stateToSave));
      } catch (error) {
        console.error('Error saving state:', error);
      }
    
      // Проверяем, завершен ли тест (12 вопросов или достигнуты все лимиты категорий)
      const testComplete = index >= 12 || 
                          (categoryCompletionStatus.vocabulary >= 5 && 
                           categoryCompletionStatus.grammar >= 5 && 
                           categoryCompletionStatus.reading >= 2);
      
      console.log('Test completion check:', {
        index,
        categoryCompletionStatus,
        testComplete
      });
  
      if (!testComplete) {
        try {
          // Сохраняем nextLevel и currentCategoryIndex для диагностики
          console.log('Loading next question with params:', {
            nextCategory: categories[currentCategoryIndex],
            nextLevel: nextLevel,
            currentCategoryIndex: currentCategoryIndex
          });
          
          // Получаем ID всех предыдущих вопросов для исключения повторов
          const askedQuestionIds = questions
            .filter(q => q.id) // Фильтруем только вопросы с ID (из базы данных)
            .map(q => q.id);
          console.log('Previously asked question IDs:', askedQuestionIds);
          
          // Загружаем следующий вопрос из базы
          const nextCategory = categories[currentCategoryIndex];
          console.log('Fetching next question for category:', nextCategory, 'level:', nextLevel);
          const nextQuestion = await fetchNextQuestion(env, nextCategory, nextLevel, askedQuestionIds);
          console.log('Next question loaded:', JSON.stringify(nextQuestion));
          
          // Проверка, что вопрос был успешно загружен
          if (!nextQuestion) {
            throw new Error('Failed to load next question');
          }
          
          questions.push(nextQuestion);
          
          await kv.put(stateKey, JSON.stringify({ 
            questions, 
            answers, 
            index, 
            currentCategoryIndex,
            categoryCompletionStatus
          }));
          
          // Показываем следующий вопрос
          console.log('Sending next question');
          await ask(formatQuestion(nextQuestion, index + 1, 12), nextQuestion.options);
          console.log('Next question sent successfully');
        } catch (error) {
          console.error('Error sending next question:', error, error.stack);
          await sendMessage(
            "Sorry, there was a problem loading the next question. Let's try to continue.",
            [[{ text: "Continue Test", callback_data: "continue_test" }]]
          );
        }
        return;
      }
  
      try {
        // Завершаем тест: оцениваем уровень и обновляем eng_level и tested_at
        console.log('Completing test, evaluating results');
        const { level, report } = evaluateTest(questions, answers);
        const testedAt = new Date().toISOString();
        
        console.log('Test results:', { level, report });
        
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
        
        // Проверяем, есть ли у пользователя активная подписка
        const { results: subResults } = await env.USER_DB
          .prepare('SELECT subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        const now = new Date();
        const hasActiveSubscription = subResults.length > 0 && 
                                   subResults[0].subscription_expired_at && 
                                   (new Date(subResults[0].subscription_expired_at) > now);
        
        // Кнопки для результатов теста
        let buttons = [];
        
        // Добавляем кнопку бесплатного урока
        buttons.push([{ text: "Free Audio Lesson", callback_data: "lesson:free" }]);
        
        // Если нет активной подписки, добавляем кнопку подписки
        if (!hasActiveSubscription) {
          // Получаем ссылку на канал из переменной окружения или используем запасную
          let channelLink = env.TRIBUTE_CHANNEL_LINK;
          
          if (!channelLink || channelLink.trim() === '') {
            console.warn(`Missing TRIBUTE_CHANNEL_LINK environment variable, using fallback link`);
            channelLink = "https://t.me/+vQ8lD3NDHjg3MzJi"; // Updated to a valid channel link
          }
          
          // Проверяем формат ссылки
          if (!channelLink.match(/^https?:\/\//)) {
            channelLink = "https://" + channelLink.replace(/^[\/\\]+/, '');
          }
          
          // Добавляем кнопку подписки под кнопкой бесплатного урока
          buttons.push([{ text: "Subscribe for $1/week", url: channelLink }]);
        }
        
        await sendMessage(
          resultMessage,
          buttons
        );
        console.log('Test completion message sent successfully');
      } catch (error) {
        console.error('Error completing test:', error);
        await sendMessage(
          "Sorry, there was a problem processing your test results. Please contact support.",
          [[{ text: "Try Again", callback_data: "start_test" }]]
        );
      }
    } catch (e) {
      console.error('Unexpected error in answer processing:', e, e.stack);
      await sendMessage(
        "Sorry, something went wrong. Let's try to continue the test.",
        [[{ text: "Continue Test", callback_data: "continue_test" }]]
      );
    }
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
  try {
    let formattedText = `*Question ${current}/${total}*\n\n`;
    
    // Добавляем индикатор категории
    if (question.category === 'vocabulary') {
      formattedText += '📚 *Vocabulary*\n\n';
    } else if (question.category === 'grammar') {
      formattedText += '📝 *Grammar*\n\n';
    } else if (question.category === 'reading') {
      formattedText += '📖 *Reading*\n\n';
    }
    
    // Заменяем все варианты переносов строк на реальные переносы
    let processedQuestion = question.question;
    
    // Логируем исходный текст для отладки
    console.log('Original question text:', JSON.stringify(processedQuestion));
    
    // Детальная обработка всех возможных представлений переносов строк
    processedQuestion = processedQuestion
      // Обрабатываем различные комбинации слешей и 'n'
      .replace(/\\\\n/g, '\n')  // \\n -> перенос строки
      .replace(/\\\n/g, '\n')   // \n -> перенос строки
      .replace(/\/\/n/g, '\n')  // //n -> перенос строки
      .replace(/\/n/g, '\n')    // /n -> перенос строки
      .replace(/\\n/g, '\n')    // представление \n как строки -> перенос строки
      // Удаляем оставшиеся странные комбинации слешей
      .replace(/\\\\/g, '')     // \\ -> пусто
      .replace(/\//g, '')       // / -> пусто
      .replace(/\\\//g, '')     // \/ -> пусто
      .replace(/\/\\/g, '');    // /\ -> пусто
    
    // Проверяем, не осталось ли других экранированных последовательностей
    processedQuestion = processedQuestion
      .replace(/\\[trfv]/g, '') // Удаляем другие экранированные последовательности
      .replace(/\bnn\b/g, '\n'); // 'nn' как отдельное слово -> перенос строки
    
    console.log('Processed question text after cleanup:', JSON.stringify(processedQuestion));
    
    // Вместо экранирования всех символов, экранируем только специальные символы Markdown
    // которые могут повлиять на форматирование
    const escapedQuestion = processedQuestion
      .replace(/([_*[\]()~`>#+=|{}])/g, '\\$1');
    
    // Добавляем текст вопроса
    formattedText += escapedQuestion;
    
    console.log('Formatted question with escaped markdown:', formattedText);
    return formattedText;
  } catch (error) {
    console.error('Error formatting question:', error);
    // В случае ошибки возвращаем текст без форматирования
    return `Question ${current}/${total}: ${question.question}`;
  }
}

// Функция для получения вопроса из базы данных (или другого источника)
async function fetchNextQuestion(env, category, level, askedQuestionIds = []) {
  if (!category || !level) {
    console.error('Missing required parameters:', { category, level });
    return getFallbackQuestion('vocabulary', 'A1');
  }
  
  console.log(`Fetching question for category: ${category}, level: ${level}, excluding IDs:`, askedQuestionIds);
  
  try {
    // Сначала проверим, есть ли вообще данные в таблице
    const checkQuery = `
      SELECT COUNT(*) as total FROM test_questions
    `;
    
    const checkResult = await env.USER_DB
      .prepare(checkQuery)
      .all();
    
    console.log('Total questions in database:', JSON.stringify(checkResult));
    if (!checkResult.results || checkResult.results[0].total === 0) {
      console.log('Database is empty, using fallback');
      return getFallbackQuestion(category, level);
    }
    
    // Проверим, какие категории и уровни есть в базе
    const categoriesQuery = `
      SELECT DISTINCT category, level FROM test_questions
    `;
    
    const categoriesResult = await env.USER_DB
      .prepare(categoriesQuery)
      .all();
    
    console.log('Available categories and levels:', JSON.stringify(categoriesResult));
    
    // Проверяем, есть ли точное совпадение по категории и уровню
    const exactMatchQuery = `
      SELECT COUNT(*) as count FROM test_questions 
      WHERE LOWER(category) = LOWER(?) AND LOWER(level) = LOWER(?)
      ${askedQuestionIds.length > 0 ? 'AND id NOT IN (' + askedQuestionIds.join(',') + ')' : ''}
    `;
    
    const exactMatch = await env.USER_DB
      .prepare(exactMatchQuery)
      .bind(category, level)
      .all();
    
    console.log('Exact match count (excluding asked questions):', JSON.stringify(exactMatch));
    
    let queryCategory = category;
    let queryLevel = level;
    
    if (!exactMatch.results || exactMatch.results[0].count === 0) {
      console.log('No exact match found or all questions asked, looking for alternatives');
      
      // Проверяем, есть ли вопросы нужной категории любого уровня
      const categoryMatch = await env.USER_DB
        .prepare(`SELECT DISTINCT level FROM test_questions 
                 WHERE LOWER(category) = LOWER(?)
                 ${askedQuestionIds.length > 0 ? 'AND id NOT IN (' + askedQuestionIds.join(',') + ')' : ''}
                 ORDER BY level ASC`)
        .bind(category)
        .all();
      
      console.log('Available levels for this category (excluding asked questions):', JSON.stringify(categoryMatch));
      
      if (categoryMatch.results && categoryMatch.results.length > 0) {
        // Используем первый доступный уровень для данной категории
        const availableLevel = categoryMatch.results[0].level;
        console.log(`Using available level ${availableLevel} for category ${category}`);
        queryLevel = availableLevel;
      } else {
        // Если нет вопросов нужной категории, ищем любую доступную категорию
        const anyCategory = await env.USER_DB
          .prepare(`SELECT DISTINCT category FROM test_questions 
                   ${askedQuestionIds.length > 0 ? 'WHERE id NOT IN (' + askedQuestionIds.join(',') + ')' : ''}
                   LIMIT 1`)
          .all();
        
        if (anyCategory.results && anyCategory.results.length > 0) {
          queryCategory = anyCategory.results[0].category;
          console.log(`No questions for requested category, using ${queryCategory} instead`);
          
          // Ищем любой уровень для новой категории
          const anyLevel = await env.USER_DB
            .prepare(`SELECT DISTINCT level FROM test_questions 
                     WHERE LOWER(category) = LOWER(?)
                     ${askedQuestionIds.length > 0 ? 'AND id NOT IN (' + askedQuestionIds.join(',') + ')' : ''}
                     LIMIT 1`)
            .bind(queryCategory)
            .all();
          
          if (anyLevel.results && anyLevel.results.length > 0) {
            queryLevel = anyLevel.results[0].level;
            console.log(`Using level ${queryLevel} for category ${queryCategory}`);
          } else {
            // Если все вопросы из базы уже были заданы, сбрасываем фильтр по ID
            if (askedQuestionIds.length > 0) {
              console.log('All questions have been asked, resetting exclusion filter');
              return fetchNextQuestion(env, category, level, []);
            }
            
            // Если что-то пошло совсем не так, используем запасной вопрос
            console.log('Could not find any suitable questions, using fallback');
            return getFallbackQuestion(category, level);
          }
        } else {
          // Если все вопросы из базы уже были заданы, сбрасываем фильтр по ID
          if (askedQuestionIds.length > 0) {
            console.log('All questions have been asked, resetting exclusion filter');
            return fetchNextQuestion(env, category, level, []);
          }
          
          // Если не найдено ни одной категории, используем запасной вопрос
          console.log('Could not find any questions at all, using fallback');
          return getFallbackQuestion(category, level);
        }
      }
    }
    
    // Основной запрос с учетом регистра и возможно измененных category и level
    const query = `
      SELECT * FROM test_questions 
      WHERE LOWER(category) = LOWER(?) AND LOWER(level) = LOWER(?)
      ${askedQuestionIds.length > 0 ? 'AND id NOT IN (' + askedQuestionIds.join(',') + ')' : ''} 
      ORDER BY RANDOM() 
      LIMIT 1
    `;
    
    console.log('Executing query:', query, 'with params:', [queryCategory, queryLevel]);
    
    const { results } = await env.USER_DB
      .prepare(query)
      .bind(queryCategory, queryLevel)
      .all();
    
    console.log('Query results:', JSON.stringify(results));
    
    if (results && results.length > 0) {
      try {
        // Проверяем структуру результата
        if (!results[0].question_text || !results[0].options || !results[0].correct_answer) {
          console.error('Invalid question data structure:', results[0]);
          return getFallbackQuestion(category, level);
        }
        
        // Проверяем, что options можно распарсить
        let options;
        try {
          options = JSON.parse(results[0].options);
          if (!Array.isArray(options)) {
            throw new Error('Options is not an array');
          }
        } catch (parseError) {
          console.error('Error parsing options:', parseError);
          console.error('Options string:', results[0].options);
          return getFallbackQuestion(category, level);
        }
        
        // Форматируем вопрос из базы данных
        const question = {
          id: results[0].id,
          category: results[0].category,
          level: results[0].level,
          question: results[0].question_text,
          options: options,
          answer: results[0].correct_answer
        };
        
        console.log('Formatted question:', JSON.stringify(question));
        return question;
      } catch (formatError) {
        console.error('Error formatting question:', formatError);
        return getFallbackQuestion(category, level);
      }
    } else {
      // Если после применения всех фильтров не осталось вопросов, пробуем сбросить список исключений
      if (askedQuestionIds.length > 0) {
        console.log('No questions found with current exclusions, trying without excluding asked questions');
        return fetchNextQuestion(env, category, level, []);
      }
      
      console.log('No questions found in database with adjusted parameters, using fallback');
      return getFallbackQuestion(category, level);
    }
  } catch (error) {
    console.error("Error fetching question:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    return getFallbackQuestion(category, level);
  }
}

// Резервные вопросы на случай, если база данных недоступна
function getFallbackQuestion(category, level) {
  console.log(`Getting fallback question for category: ${category}, level: ${level}`);
  
  // Проверяем, что переданы корректные параметры
  if (!category) {
    console.warn('No category provided for fallback question, defaulting to vocabulary');
    category = 'vocabulary';
  }
  
  if (!level) {
    console.warn('No level provided for fallback question, defaulting to A1');
    level = 'A1';
  }
  
  // Нормализуем категорию и уровень
  category = category.toLowerCase();
  level = level.toUpperCase();
  
  // Здесь можно реализовать небольшой набор резервных вопросов для каждой категории и уровня
  const fallbackQuestions = {
    vocabulary: {
      A1: [
        {
          question: "What is the meaning of 'begin'?",
          options: ["End", "Start", "Stop", "Continue"],
          answer: "Start",
          category: "vocabulary",
          level: "A1"
        },
        {
          question: "It's cold today. Wear your ___!",
          options: ["jacket", "shirt", "shoes", "tea"],
          answer: "jacket",
          category: "vocabulary",
          level: "A1"
        },
        {
          question: "Can you ___ me with my homework?",
          options: ["help", "make", "give", "take"],
          answer: "help",
          category: "vocabulary",
          level: "A1"
        }
      ],
      A2: [
        {
          question: "They live in a small ___ near the mountains.",
          options: ["village", "city", "place", "house"],
          answer: "village",
          category: "vocabulary",
          level: "A2"
        }
      ]
    },
    grammar: {
      A1: [
        {
          question: "Complete the sentence: She ___ a student.",
          options: ["am", "is", "are", "be"],
          answer: "is",
          category: "grammar",
          level: "A1"
        },
        {
          question: "Complete the sentence: I ___ coffee every morning.",
          options: ["drink", "drinks", "drinking", "am drink"],
          answer: "drink",
          category: "grammar",
          level: "A1"
        }
      ],
      A2: [
        {
          question: "Complete the sentence: She ___ to the gym every morning.",
          options: ["go", "goes", "gone", "going"],
          answer: "goes",
          category: "grammar",
          level: "A2"
        }
      ]
    },
    reading: {
      A1: [
        {
          question: "Read and answer:\\n\\nMy name is John. I am from England. I speak English.\\n\\nWhere is John from?",
          options: ["America", "England", "France", "Spain"],
          answer: "England",
          category: "reading",
          level: "A1"
        }
      ],
      A2: [
        {
          question: "Read and answer:\\n\\nMaria goes to work by bus. It takes her 30 minutes to get to work. She starts work at 9:00.\\n\\nHow does Maria go to work?",
          options: ["By car", "By train", "By bus", "On foot"],
          answer: "By bus",
          category: "reading",
          level: "A2"
        }
      ]
    }
  };
  
  // Проверяем наличие вопросов для указанной категории и уровня
  if (fallbackQuestions[category] && fallbackQuestions[category][level] && fallbackQuestions[category][level].length > 0) {
    // Берем случайный вопрос из доступных
    const randomIndex = Math.floor(Math.random() * fallbackQuestions[category][level].length);
    console.log(`Using fallback question for ${category} ${level}, index ${randomIndex}`);
    return fallbackQuestions[category][level][randomIndex];
  }
  
  // Если нет вопросов для указанной категории и уровня, берем вопрос из наиболее близкой категории и уровня
  const categories = ['vocabulary', 'grammar', 'reading'];
  const levels = ['A1', 'A2', 'B1', 'B2', 'C1'];
  
  // Сначала пробуем найти другой уровень в той же категории
  if (fallbackQuestions[category]) {
    for (const possibleLevel of levels) {
      if (fallbackQuestions[category][possibleLevel] && fallbackQuestions[category][possibleLevel].length > 0) {
        const randomIndex = Math.floor(Math.random() * fallbackQuestions[category][possibleLevel].length);
        console.log(`No exact match found, using fallback from same category but level ${possibleLevel}`);
        return fallbackQuestions[category][possibleLevel][randomIndex];
      }
    }
  }
  
  // Если не нашли в той же категории, ищем в любой категории
  for (const possibleCategory of categories) {
    if (fallbackQuestions[possibleCategory]) {
      for (const possibleLevel of levels) {
        if (fallbackQuestions[possibleCategory][possibleLevel] && fallbackQuestions[possibleCategory][possibleLevel].length > 0) {
          const randomIndex = Math.floor(Math.random() * fallbackQuestions[possibleCategory][possibleLevel].length);
          console.log(`Using fallback from category ${possibleCategory}, level ${possibleLevel}`);
          return fallbackQuestions[possibleCategory][possibleLevel][randomIndex];
        }
      }
    }
  }
  
  // Если совсем ничего не нашли, возвращаем самый базовый вопрос
  console.log('No suitable fallback questions found, using default question');
  return {
    question: "What is the English word for 'hello'?",
    options: ["Hello", "Goodbye", "Thank you", "Sorry"],
    answer: "Hello",
    category: "vocabulary",
    level: "A1"
  };
}

// Оценка результатов теста для определения уровня английского
function evaluateTest(questions, answers) {
  console.log('Evaluating test results...');
  console.log('Questions:', JSON.stringify(questions.map(q => ({ id: q.id, category: q.category, level: q.level }))));
  console.log('Answers:', JSON.stringify(answers));
  
  if (!questions || !answers || questions.length === 0) {
    console.error('Invalid input for evaluateTest: empty questions or answers');
    return { level: 'A1', report: 'Could not accurately evaluate your level due to insufficient data.' };
  }
  
  let correct = 0;
  const incorrectByCategory = {
    vocabulary: [],
    grammar: [],
    reading: []
  };

  // Подсчитываем правильные ответы и отслеживаем ошибки по категориям
  questions.forEach((q, i) => {
    if (i < answers.length && answers[i] === q.answer) {
      correct++;
    } else if (i < answers.length) {
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
  const accuracy = answers.length ? (correct / answers.length) : 0;
  console.log('Correct answers:', correct, 'out of', answers.length, 'Accuracy:', accuracy);
  
  // Определяем уровень на основе точности и сложности вопросов
  let level;
  if (accuracy >= 0.9) level = 'C1';
  else if (accuracy >= 0.8) level = 'B2';
  else if (accuracy >= 0.65) level = 'B1';
  else if (accuracy >= 0.45) level = 'A2';
  else level = 'A1';
  
  // Также учитываем максимальную сложность правильно отвеченных вопросов
  const correctlyAnsweredLevels = questions
    .filter((q, i) => i < answers.length && answers[i] === q.answer)
    .map(q => q.level);
  
  console.log('Correctly answered levels:', correctlyAnsweredLevels);
  
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
      
      // Обрабатываем текст вопроса, заменяя все варианты переносов строк
      let questionText = q.question
        .replace(/\\n/g, ' ')   // Заменяем \n на пробел
        .replace(/\/\/n/g, ' ') // Заменяем //n на пробел
        .replace(/\\\\n/g, ' ') // Заменяем \\n на пробел
        .replace(/\n/g, ' ');   // Заменяем реальные переносы на пробел
      
      // Берем только первую часть текста или первые 30 символов
      const parts = questionText.split(/[.!?]/, 2);
      const questionStart = parts.length > 1 ? parts[0] + parts[1].substring(0, 20) : questionText.substring(0, 50);
      
      report += `"${questionStart}..." - Correct answer: "${q.answer}"\n`;
    } else {
      report += `You missed ${incorrectByCategory.reading.length} reading questions.\n`;
    }
  }
  
  console.log('Final level assessment:', level);
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
