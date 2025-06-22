// reminder-worker.js
// Sends daily reminders to users at 10 AM to encourage consistent practice
// Triggered by Cloudflare Cron Trigger (daily at 10:00)
// Also handles streak maintenance - resets streak if user missed a day

export default {
  // This scheduled handler runs once per day at 10:00 AM
  async scheduled(event, env, ctx) {
    console.log('Running daily reminders at:', new Date().toISOString());
    
    try {
      // Process users in batches to handle large user bases efficiently
      let cursor = null;
      const batchSize = 50; // Process 50 users at a time
      let processedCount = 0;
      let remindersSent = 0;
      let streaksReset = 0;
      
      do {
        // Query user profiles from D1 database
        // Get users who have completed the survey (instead of eng_level)
        const query = `
          SELECT up.telegram_id, up.subscription_expired_at, 
                 up.next_lesson_access_at, up.lessons_in_row, up.daily_lesson_pass_at
          FROM user_profiles up
          INNER JOIN user_survey us ON up.telegram_id = us.telegram_id
          WHERE (up.is_active IS NULL OR up.is_active = 1)
          LIMIT ? ${cursor ? 'OFFSET ?' : ''}
        `;
        
        const params = cursor ? [batchSize, cursor] : [batchSize];
        const { results, success } = await env.USER_DB
          .prepare(query)
          .bind(...params)
          .all();
        
        if (!success) {
          throw new Error('Failed to query user profiles from database');
        }
        
        // Process each user in the batch
        const now = new Date();
        const promises = results.map(async (user) => {
          processedCount++;
          
          // Skip users who haven't completed the survey (shouldn't happen with our query but just in case)
          if (!user.telegram_id) return;
          
          // Check streak maintenance - regardless of subscription status
          // This ensures we maintain accurate streaks for all users
          await checkAndUpdateStreak(user, now, env, streaksReset);
          
          // Check if user has an active subscription
          const hasActiveSubscription = user.subscription_expired_at && 
                                      (new Date(user.subscription_expired_at) > now);
          
          // Now process based on subscription status for reminders
          if (hasActiveSubscription) {
            // User has active subscription - check if next lesson is available
            const lessonAvailable = user.next_lesson_access_at && 
                                  (new Date(user.next_lesson_access_at) <= now);
            
            if (lessonAvailable) {
              // Lesson is available - send reminder with streak info
              const streak = user.lessons_in_row || 0;
              let message = "Your daily English practice is waiting! 🎯 Remember, just 5-10 minutes of speaking practice today will help you improve consistently.";
              
              // Add streak information if they have one
              if (streak > 0) {
                message += `\n\nYou're on a ${streak}-day streak! 🔥 Keep it going!`;
              }
              
              await sendTelegramMessage(user.telegram_id, message, env, [
                [{ text: "Start Today's Lesson", callback_data: "lesson:start" }]
              ]);
              
              remindersSent++;
            }
            // If lesson not available, don't send any message
          } else {
            // No active subscription - send motivation for daily practice
            const message = "Did you know that consistent practice is the key to breaking through your language barrier? 🗣️\n\nEven just 5-10 minutes of speaking practice each day in a safe environment can dramatically improve your English fluency.\n\nSubscribe now to access daily personalized lessons!";
            
            // ИЗМЕНЕНО: Используем ссылку на канал Tribute из env
            await sendTelegramMessage(user.telegram_id, message, env, [
              [{ text: "Subscribe to Channel (€2/week)", url: env.TRIBUTE_CHANNEL_LINK }]
            ]);
            
            remindersSent++;
          }
        });
        
        // Wait for all messages in this batch to be processed
        await Promise.all(promises);
        
        // Update cursor for next batch
        if (results.length < batchSize) {
          // No more results to process
          cursor = null;
        } else {
          cursor = (cursor || 0) + batchSize;
        }
        
      } while (cursor !== null);
      
      console.log(`Reminder processing complete. Processed ${processedCount} users, sent ${remindersSent} reminders, reset ${streaksReset} streaks.`);
      
    } catch (error) {
      console.error('Error in reminder worker:', error);
    }
  },
  
  // Handle HTTP requests (for testing)
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Only allow POST to /manual-trigger for testing
    if (request.method === 'POST' && url.pathname === '/manual-trigger') {
      // For testing only - trigger the same logic
      ctx.waitUntil(this.scheduled(null, env, ctx));
      return new Response('Manual reminder trigger initiated', { status: 200 });
    }
    
    // Provide some basic info for GET requests
    return new Response('LinguaPulse Reminder Worker - Scheduled to run daily at 10:00 AM', { 
      status: 200,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

// Check and update user's streak status
async function checkAndUpdateStreak(user, now, env, streaksResetCounter) {
  // Only process users who have completed at least one lesson
  if (!user.daily_lesson_pass_at) return;
  
  const lastLessonDate = new Date(user.daily_lesson_pass_at);
  const currentStreak = user.lessons_in_row || 0;
  
  // Calculate dates for comparison
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  
  const tomorrowStart = new Date(now);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  tomorrowStart.setHours(0, 0, 0, 0);
  
  // Check if the last lesson was completed yesterday or today
  const isRecentLesson = 
    (lastLessonDate >= yesterday && lastLessonDate < todayStart) || // Yesterday
    (lastLessonDate >= todayStart && lastLessonDate < tomorrowStart); // Today
  
  // If streak is broken, reset it to 0
  if (!isRecentLesson && currentStreak > 0) {
    console.log(`Resetting streak for user ${user.telegram_id}. Last lesson: ${lastLessonDate.toISOString()}, Current streak: ${currentStreak}`);
    
    try {
      await env.USER_DB
        .prepare('UPDATE user_profiles SET lessons_in_row = 0 WHERE telegram_id = ?')
        .bind(parseInt(user.telegram_id, 10))
        .run();
      
      if (typeof streaksResetCounter === 'number') {
        streaksResetCounter++;
      }
    } catch (error) {
      console.error(`Failed to reset streak for user ${user.telegram_id}:`, error);
    }
  }
}

// Helper function to send a message via Telegram Bot API
async function sendTelegramMessage(chatId, text, env, inlineKeyboard = null) {
  const payload = { 
    chat_id: chatId, 
    text: text,
    parse_mode: 'Markdown'
  };
  
  if (inlineKeyboard) {
    payload.reply_markup = { inline_keyboard: inlineKeyboard };
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorData = await response.text();
      console.error(`Failed to send message to ${chatId}: ${errorData}`);
      
      // Handle user blocking the bot or chat not found
      if (response.status === 403 || errorData.includes('chat not found')) {
        console.log(`User ${chatId} has blocked the bot or deleted the chat. Marking as inactive.`);
        
        // Optionally: Update a field in the database to mark user as inactive
        // This could be used in the future to filter out users who shouldn't receive messages
        await env.USER_DB
          .prepare('UPDATE user_profiles SET is_active = 0 WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .run()
          .catch(err => console.error(`Failed to mark user ${chatId} as inactive:`, err));
      }
      
      return false;
    }
    
    return true;
  } catch (error) {
    console.error(`Error sending message to ${chatId}:`, error);
    return false;
  }
}
