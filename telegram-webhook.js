// telegram-webhook/worker.js with Tribute.tg integration
// Receives every Telegram update on /tg and routes it to TEST or LESSON0

export default {
  async fetch(request, env) {
    
    try {
      const { pathname } = new URL(request.url);

      // Handle Tribute webhook
      if (pathname === '/tribute-webhook') {
        return await handleTributeWebhook(request, env);
      }

      // Keep existing Stripe webhook handler for backward compatibility
      if (pathname === '/stripe-webhook') {
        return await handleStripeWebhook(request, env);
      }
      
      if (pathname !== '/tg') return new Response('Not found', { status: 404 });

      // 0. parse safely
      let update = {};
      try { 
        update = await request.json(); 
        console.log(`Received update: ${JSON.stringify(update).substring(0, 200)}...`);
      } catch (e) { 
        console.error("JSON parse error:", e);
        return new Response('Bad request', { status: 200 }); // Return 200 to Telegram even for bad requests
      }

      const chatId = update.message?.chat?.id
                  || update.callback_query?.message?.chat?.id;
      if (!chatId) return new Response('OK');

      // Handle /help command, unknown commands, and regular text messages
const supportedCommands = ['/start', '/profile', '/lesson', '/talk', '/help'];

if (update.message?.text) {
  if (update.message.text === '/help' || 
      !supportedCommands.some(cmd => update.message.text.startsWith(cmd))) {
    await sendMessageWithSubscriptionCheck(chatId, 
      '🤖 *LinguaPulse Bot Commands:*\n\n' +
      '*/start* - Begin the language placement test or see your profile\n' +
      '*/profile* - View your language level and progress\n' +
      '*/lesson* - Access your lessons and subscription status\n' +
      '*/talk* - Start today\'s lesson (for subscribers)\n' +
      '*/help* - Show this help message\n\n' +
      '💡 *Did you know?* Just 10-15 minutes of conversation practice daily can improve your English skills more than years of study without regular speaking practice!\n\n' +
      '• Send voice messages during the lesson to practice speaking\n' +
      '• The AI tutor may take a few seconds to think and respond\n' +
      '• Lessons end automatically\n' +
      '• You\'ll receive personalized grammar and vocabulary feedback after each lesson', 
      env,
      { parse_mode: 'Markdown' });
    return new Response('OK');
  }
}

      // Handle /talk command - route to main-lesson
      if (update.message?.text === '/talk') {
        // Check if the MAIN_LESSON worker is available
        if (!env.MAIN_LESSON) {
          console.error("MAIN_LESSON worker is undefined, cannot forward /talk command");
          
          // Check if user has completed the test
          if (await hasCompletedTest(chatId, env)) {
            // Get user subscription status
            const { results } = await env.USER_DB
              .prepare('SELECT subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
              .bind(parseInt(chatId, 10))
              .all();
            
            const now = new Date();
            const hasActiveSubscription = results.length > 0 && 
                                         results[0].subscription_expired_at && 
                                         (new Date(results[0].subscription_expired_at) > now);
            
            if (hasActiveSubscription) {
              // If they have an active subscription but worker is unavailable
              await sendMessageWithSubscriptionCheck(chatId, 
                "Sorry, the lesson service is temporarily unavailable. Please try again later.", env);
            } else {
              // If they don't have an active subscription, show subscription option
              await sendMessageWithSubscriptionCheck(chatId, 
                "You need an active subscription to access lessons. Subscribe to continue learning!", env);
            }
          } else {
            // If they haven't completed the test
            await sendMessageWithSubscriptionCheck(chatId, 
              "You need to complete the placement test first. Use /start to begin.", env);
          }
          return new Response('OK');
        }
        
        // Forward directly to main-lesson worker if available
        console.log("Forwarding /talk command to MAIN_LESSON");
        return forward(env.MAIN_LESSON, update);
      }

      // Handle /profile command - show user-friendly profile data
      if (update.message?.text === '/profile') {
        const { results } = await env.USER_DB
          .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        const profile = results[0] || {};
        
        if (!profile.eng_level) {
          await sendMessageWithSubscriptionCheck(chatId, 
            'You haven\'t taken the placement test yet. Use /start to begin.', env);
        } else {
          // Format human-readable profile info
          const testedAt = profile.tested_at ? new Date(profile.tested_at).toLocaleDateString() : 'N/A';
          
          // Check if subscription is active
          const now = new Date();
          const subscriptionDate = profile.subscription_expired_at ? new Date(profile.subscription_expired_at) : null;
          const hasActiveSubscription = subscriptionDate && subscriptionDate > now;
          
          // Format subscription display
          const subscriptionDisplay = hasActiveSubscription 
            ? (() => {
                const d = new Date(profile.subscription_expired_at);
                const day = d.getDate();  
                const month = d.toLocaleString('en-US', { month: 'long' }); 
                const year = d.getFullYear();
                const hours = String(d.getHours()).padStart(2, '0');
                const minutes = String(d.getMinutes()).padStart(2, '0');
                return `Active until ${day} ${month}, ${year}`;
              })()
            : 'Inactive - Subscribe to continue learning';

          // Check streak validity - if last lesson wasn't yesterday or today, streak should be 0
          let lessonsStreak = profile.lessons_in_row || 0;
          
          if (profile.daily_lesson_pass_at) {
            const lastLessonDate = new Date(profile.daily_lesson_pass_at);
            
            // Calculate yesterday and today for comparison
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            yesterday.setHours(0, 0, 0, 0);
            
            const todayStart = new Date(now);
            todayStart.setHours(0, 0, 0, 0);
            
            const tomorrowStart = new Date(now);
            tomorrowStart.setDate(tomorrowStart.getDate() + 1);
            tomorrowStart.setHours(0, 0, 0, 0);
            
            // Check if last lesson was yesterday or today
            const isRecentLesson = 
              (lastLessonDate >= yesterday && lastLessonDate < todayStart) || // Yesterday
              (lastLessonDate >= todayStart && lastLessonDate < tomorrowStart); // Today
            
            // If streak is broken and not updated yet, display it as 0 and update the DB
            if (!isRecentLesson && lessonsStreak > 0) {
              console.log(`Displaying reset streak for user ${chatId}. Last lesson: ${lastLessonDate.toISOString()}, Current streak: ${lessonsStreak}`);
              
              // Update streak in database
              try {
                await env.USER_DB
                  .prepare('UPDATE user_profiles SET lessons_in_row = 0 WHERE telegram_id = ?')
                  .bind(parseInt(chatId, 10))
                  .run();
                
                // Set display value to 0
                lessonsStreak = 0;
              } catch (error) {
                console.error(`Failed to reset streak for user ${chatId}:`, error);
              }
            }
          }
          
          const lessonsTotal = profile.number_of_lessons || 0;
          
          // Create message text
          const profileMessage = `Your language profile:\n\n` +
            `Language level: ${profile.eng_level}\n` +
            `Subscription: ${subscriptionDisplay}\n` +
            `Total lessons completed: ${lessonsTotal}\n` +
            `Current lesson streak: ${lessonsStreak}`;
          
          // Show profile with appropriate options based on subscription status
          await sendMessageWithSubscriptionCheck(chatId, profileMessage, env);
        }
        
        return new Response('OK');
      }

      // Handle /lesson command - same as /start for users who completed the test
if (update.message?.text === '/lesson' || 
(update.message?.text === '/start' && await hasCompletedTest(chatId, env))) {
try {
console.log(`Calling handleLessonCommand for user ${chatId}`);
await handleLessonCommand(chatId, env);
} catch (error) {
console.error(`Error handling /lesson command for user ${chatId}:`, error);
// Fallback response in case of error
try {
  await sendMessageWithSubscriptionCheck(chatId, 
    "Sorry, there was an error processing your command. Please try again later or contact support.", 
    env);
} catch (sendError) {
  console.error("Failed to send error message:", sendError);
}
}
return new Response('OK');
}
      
      // Modified /start command to check for welcome parameter
      if (update.message?.text?.startsWith('/start')) {
        // Check if this is a return from subscription
        const isWelcomeBack = update.message.text.includes('welcome');
        
        if (isWelcomeBack) {
          // This is a user returning from subscribing
          const { results } = await env.USER_DB
            .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          if (results.length > 0) {
            const profile = results[0];
            const now = new Date();
            
            // Check if subscription is active
            const hasActiveSubscription = profile.subscription_expired_at && 
                                        (new Date(profile.subscription_expired_at) > now);
            
            if (hasActiveSubscription) {
              // Subscription is active, check if lesson is available
              if (profile.next_lesson_access_at && (new Date(profile.next_lesson_access_at) <= now)) {
                // Lesson is available, offer to start it
                await sendMessageWithSubscriptionCheck(chatId,
                  "🎉 Welcome back! Your subscription is active and your lesson is ready. Would you like to start it now?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] }});
                return new Response('OK');
              }
            } else {
              // Subscription inactive or expired, offer to subscribe
              const channelLink = env.TRIBUTE_CHANNEL_LINK;
              if (channelLink) {
                await sendMessageWithSubscriptionCheck(chatId,
                  "Welcome back! Your subscription has expired. Subscribe again to continue learning.",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Subscribe for $1/week", url: channelLink }]] }});
                return new Response('OK');
              }
            }
          }
        }
        
        // Check if user has completed test already
        if (await hasCompletedTest(chatId, env)) {
          await handleLessonCommand(chatId, env);
          return new Response('OK');
        }
        
        // Check if user is new or needs to register first
        const { results } = await env.USER_DB
          .prepare('SELECT telegram_id FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        if (results.length === 0) {
          // New user - create initial record in database
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
        }
        
        // Forward to TEST bot for test generation and question flow
        console.log("Forwarding /start command to TEST bot");
        return forward(env.TEST, update);
      }

      // Handle voice messages with improved routing
      if (update.message?.voice) {
        try {
          console.log(`Received voice message from chat ${chatId}, message ID: ${update.message.message_id}`);
          
          // First check if it's a main lesson session
          const mainSessionKey = `main_session:${chatId}`;
          let mainSession = null;
          
          if (env.CHAT_KV) {
            console.log(`Checking CHAT_KV for ${mainSessionKey}`);
            mainSession = await env.CHAT_KV.get(mainSessionKey);
            
            if (mainSession) {
              console.log(`Found active main-lesson session (${mainSession}), forwarding voice message to MAIN_LESSON`);
              return forward(env.MAIN_LESSON, update);
            }
            
            // If not found in main session, check for lesson0 session directly in CHAT_KV
            const lesson0SessionKey = `session:${chatId}`;
            const lesson0Session = await env.CHAT_KV.get(lesson0SessionKey);
            
            if (lesson0Session) {
              console.log(`Found active lesson0 session (${lesson0Session}), forwarding voice message to LESSON0`);
              return forward(env.LESSON0, update);
            }
          }
          
          // If no active session found, check if user has completed the lesson recently
          // and provide information about next lesson or subscription
          const { results } = await env.USER_DB
            .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          if (results.length > 0) {
            const profile = results[0];
            const now = new Date();
            
            // Check if subscription is active
            const hasActiveSubscription = profile.subscription_expired_at && 
                                        (new Date(profile.subscription_expired_at) > now);
            
            if (hasActiveSubscription) {
              // Check when next lesson is available
              if (profile.next_lesson_access_at) {
                const nextLessonAt = new Date(profile.next_lesson_access_at);
                
                if (nextLessonAt > now) {
                  // Next lesson in the future - tell user when it will be available
                  const timeUntil = formatTimeUntil(nextLessonAt);
                  await sendMessageWithSubscriptionCheck(chatId,
                    `Your next lesson will be available in ${timeUntil}. I look forward to our next conversation!`,
                    env);
                  return new Response('OK');
                } else {
                  // Lesson is available now - suggest starting it
                  await sendMessageWithSubscriptionCheck(chatId,
                    "Your next lesson is available now! Would you like to start?",
                    env,
                    { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] }});
                  return new Response('OK');
                }
              }
            } else {
              // No active subscription - send message with subscription button
              await sendMessageWithSubscriptionCheck(chatId,
                "To continue with your English lessons, you need an active subscription. Subscribe now for daily speaking practice!",
                env);
              return new Response('OK');
            }
          }
          
          // Generic fallback if no user profile found or other conditions not met
          await sendMessageWithSubscriptionCheck(chatId, 
            "You don't have an active lesson. Please use /start to begin the placement test or /talk to start a lesson if you've already completed it.", 
            env);
          return new Response('OK');
        } catch (error) {
          console.error(`Voice message handling error: ${error.message}`);
          console.error(error.stack); // Log the full stack trace
          return new Response('OK');  // Always return OK to Telegram
        }
      }

      // Handle regular text messages outside of sessions
      if (update.message?.text && !update.message.text.startsWith('/')) {
        // Check if user has an active session
        let activeSession = false;
        
        if (env.CHAT_KV) {
          const mainSession = await env.CHAT_KV.get(`main_session:${chatId}`);
          const lesson0Session = await env.CHAT_KV.get(`session:${chatId}`);
          
          if (mainSession || lesson0Session) {
            activeSession = true;
          }
        }
        
        // If no active session, provide info about next lesson or subscription
        if (!activeSession) {
          const { results } = await env.USER_DB
            .prepare('SELECT subscription_expired_at, next_lesson_access_at, eng_level FROM user_profiles WHERE telegram_id = ?')
            .bind(parseInt(chatId, 10))
            .all();
          
          // If user hasn't taken the test yet
          if (!results.length || !results[0].eng_level) {
            await sendMessageWithSubscriptionCheck(chatId, 
              "Please use /start to begin the placement test so I can determine your English level.", 
              env);
            return new Response('OK');
          }
          
          const profile = results[0];
          const now = new Date();
          
          // Check if subscription is active
          const hasActiveSubscription = profile.subscription_expired_at && 
                                       (new Date(profile.subscription_expired_at) > now);
          
          if (hasActiveSubscription) {
            // Check when next lesson is available
            if (profile.next_lesson_access_at) {
              const nextLessonAt = new Date(profile.next_lesson_access_at);
              
              if (nextLessonAt > now) {
                // Next lesson in the future - tell user when it will be available
                const timeUntil = formatTimeUntil(nextLessonAt);
                await sendMessageWithSubscriptionCheck(chatId,
                  `Your next lesson will be available in ${timeUntil}. You can use /profile to see your progress.`,
                  env);
                return new Response('OK');
              } else {
                // Lesson is available now - suggest starting it
                await sendMessageWithSubscriptionCheck(chatId,
                  "Your next lesson is available now! Would you like to start?",
                  env,
                  { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] }});
                return new Response('OK');
              }
            }
          } else {
            // No active subscription - send message with subscription button
            await sendMessageWithSubscriptionCheck(chatId,
              "To continue with your English lessons, you need an active subscription. Subscribe now for daily speaking practice!",
              env);
            return new Response('OK');
          }
        }
      }

      // 2. handle lesson buttons
      if (update.callback_query?.data === 'lesson:free' || 
          update.callback_query?.data === 'lesson:start') {
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        // If this is the free lesson, handle it as before
        if (update.callback_query?.data === 'lesson:free') {
          // send the "Starting…" text back immediately
          await sendMessageWithSubscriptionCheck(chatId,
            'Starting audio lesson…', env);

          // mark lesson in progress
          await env.USER_PROFILE.put(`lesson:${chatId}`, 'in_progress');

          // forward the start payload to lesson0-bot
          console.log("Forwarding lesson:free action to LESSON0");
          return forward(env.LESSON0, {
            user_id: chatId,
            action : 'start_free'
          });
        } 
        // If this is the main lesson (from subscription)
        else if (update.callback_query?.data === 'lesson:start') {
          // Forward to the main-lesson worker with appropriate action
          console.log("Forwarding lesson:start action to MAIN_LESSON");
          return forward(env.MAIN_LESSON, {
            user_id: chatId,
            action : 'start_lesson'
          });
        }
      }
      
      // 2.1 handle subscription button - UPDATED FOR TRIBUTE
      if (update.callback_query?.data === 'subscribe:weekly') {
        // Acknowledge the callback query
        await callTelegram('answerCallbackQuery', {
          callback_query_id: update.callback_query.id
        }, env);
        
        // Check current subscription status
        const { results } = await env.USER_DB
          .prepare('SELECT subscription_expired_at, next_lesson_access_at FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(chatId, 10))
          .all();
        
        if (!results.length) {
          await sendMessageWithSubscriptionCheck(chatId, 
            'You need to take the placement test first. Use /start to begin.', env);
          return new Response('OK');
        }
        
        const profile = results[0];
        const now = new Date();
        
        // Check if user has an active subscription
        if (profile.subscription_expired_at) {
          const subExpiredAt = new Date(profile.subscription_expired_at);
          
          // If subscription is still active
          if (subExpiredAt.getTime() > now.getTime()) {
            // Format the expiration date
            const expiryDate = subExpiredAt.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
            });
            
            // Check if next lesson is available
            if (profile.next_lesson_access_at) {
              const nextLessonAt = new Date(profile.next_lesson_access_at);
              
              if (nextLessonAt.getTime() <= now.getTime()) {
                // Next lesson is already available
                await sendMessageWithSubscriptionCheck(chatId,
                  `You already have an active subscription until ${expiryDate}. Your next lesson is available now!`, 
                  env, 
                  { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] } }
                );
              } else {
                // Next lesson will be available later
                const timeUntil = formatTimeUntil(nextLessonAt);
                await sendMessageWithSubscriptionCheck(chatId,
                  `You already have an active subscription until ${expiryDate}. Your next lesson will be available in ${timeUntil}.`,
                  env
                );
              }
              return new Response('OK');
            } else {
              // Something went wrong - subscription exists but next_lesson_access_at is missing
              await sendMessageWithSubscriptionCheck(chatId,
                `You already have an active subscription until ${expiryDate}.`,
                env,
                { reply_markup: { inline_keyboard: [[{ text: "Start Lesson", callback_data: "lesson:start" }]] } }
              );
              return new Response('OK');
            }
          }
        }
        
        // If we get here, user doesn't have an active subscription or it has expired
        // UPDATED: Redirect to Tribute channel subscription
        await sendTributeChannelLink(chatId, env);
        return new Response('OK');
      }

      // 4. receive end-of-lesson notification (if you choose to send it)
      if (update.lesson_done) {
        await env.USER_PROFILE.put(`lesson:${chatId}`, 'finished', { expirationTtl: 86400 });
        return new Response('OK');
      }

      // 5. everything else goes to test-bot
      console.log("Forwarding to TEST bot as default action");
      return forward(env.TEST, update);
    } catch (error) {
      console.error("Unhandled error in telegram-webhook:", error);
      // Always return 200 OK to Telegram webhook to avoid retries
      return new Response('OK');
    }
  }
};

// UPDATED: Handle Tribute webhook for subscription notifications
async function handleTributeWebhook(request, env) {
  try {
    console.log('==== TRIBUTE WEBHOOK RECEIVED ====');
    
    // Ensure this is a POST request
    if (request.method !== 'POST') {
      console.log('Method not allowed, expected POST, got:', request.method);
      return new Response('Method not allowed', { status: 405 });
    }
    
    // Log headers for debugging
    console.log('Request headers:');
    const headersObj = {};
    for (const [key, value] of request.headers.entries()) {
      headersObj[key] = value;
      console.log(`${key}: ${value}`);
    }
    
    // Get the signature if available (for verification)
    const signature = request.headers.get('trbt-signature');
    if (signature) {
      console.log('Provided signature:', signature);
    }
    
    // Get the raw payload
    const payload = await request.text();
    console.log('Tribute webhook payload:', payload);
    
    // Try to parse the payload
    let event;
    try {
      event = JSON.parse(payload);
      console.log('Parsed event:', JSON.stringify(event));
    } catch (parseError) {
      console.error('Failed to parse payload as JSON:', parseError);
      return new Response('Invalid JSON payload', { status: 400 });
    }
    
    // CRITICAL: Extract telegram_user_id from the correct location in the structure
    let userId = null;
    
    // Look for telegram_user_id in the payload object (actual Tribute structure)
    if (event.payload && event.payload.telegram_user_id) {
      userId = event.payload.telegram_user_id;
      console.log(`Found telegram_user_id in event.payload: ${userId}`);
    }
    // Fallback: Check for user_id directly in the event
    else if (event.telegram_user_id) {
      userId = event.telegram_user_id;
      console.log(`Found telegram_user_id directly in event: ${userId}`);
    }
    // Fallback: Check for user_id in various other locations
    else if (event.user_id) {
      userId = event.user_id;
      console.log(`Found user_id directly in event: ${userId}`);
    }
    else if (event.payload && event.payload.user_id) {
      userId = event.payload.user_id;
      console.log(`Found user_id in event.payload: ${userId}`);
    }
    else {
      console.error('Could not find telegram_user_id or user_id in webhook payload');
      console.log('Full event structure:', JSON.stringify(event));
      return new Response('Missing user ID in webhook payload', { status: 400 });
    }
    
    console.log(`Using user_id: ${userId}`);
    
    // Extract subscription information
    let isNewSubscription = false;
    let expiryDate = null;
    
    // Check if this is a new subscription by looking at the name field (Tribute specific)
    if (event.name === 'new_subscription') {
      isNewSubscription = true;
      console.log('Identified as new subscription from event.name');
    }
    
    // Extract expiry date from the correct location (Tribute specific)
    if (event.payload && event.payload.expires_at) {
      expiryDate = new Date(event.payload.expires_at);
      console.log(`Found expires_at in event.payload: ${event.payload.expires_at}`);
    }
    else if (event.expires_at) {
      expiryDate = new Date(event.expires_at);
      console.log(`Found expires_at directly in event: ${event.expires_at}`);
    }
    
    // Validate expiry date
    if (expiryDate && isNaN(expiryDate.getTime())) {
      console.warn('Invalid expiry date format detected');
      expiryDate = null;
    }
    
    // If no valid date found, use default (7 days)
    if (!expiryDate) {
      console.log('Using default expiry date (7 days from now)');
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + 7);
    }
    
    console.log('Expiry date:', expiryDate.toISOString());
    
    // Process subscription if it's new or we're forcing an update
    if (isNewSubscription) {
      // Calculate dates for subscription
      const now = new Date();
      const subscribed_at = now.toISOString();
      const subscription_expired_at = expiryDate.toISOString();
      
      // For new subscriptions, make next lesson immediately available
      const nextLessonDate = new Date(now);
      nextLessonDate.setTime(now.getTime() - 60000); // 1 minute ago to ensure availability
      const next_lesson_access_at = nextLessonDate.toISOString();
      
      // Update user profile with subscription info
      try {
        // Check if user exists in our database
        console.log(`Checking if user ${userId} exists in database...`);
        const { results, success, error } = await env.USER_DB
          .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(userId, 10))
          .all();
        
        if (!success) {
          console.error('Database query error:', error);
          throw new Error('Database query failed: ' + (error || 'Unknown error'));
        }
        
        if (results.length === 0) {
          console.error(`User ${userId} not found in database`);
          return new Response(`User ${userId} not found in database. Please complete the placement test first.`, { 
            status: 404, 
            headers: { 'Content-Type': 'text/plain' } 
          });
        }
        
        console.log(`User ${userId} found, updating subscription...`);
        
        // Update subscription info
        const updateResult = await env.USER_DB
          .prepare(`
            UPDATE user_profiles
            SET subscribed_at = ?,
                subscription_expired_at = ?,
                next_lesson_access_at = ?
            WHERE telegram_id = ?
          `)
          .bind(
            subscribed_at,
            subscription_expired_at,
            next_lesson_access_at,
            parseInt(userId, 10)
          )
          .run();
        
        console.log('Database update result:', updateResult);
        
        if (!updateResult.success) {
          console.error('Database update error:', updateResult.error);
          throw new Error('Failed to update subscription: ' + (updateResult.error || 'Unknown error'));
        }
        
        // Double-check that the update was successful
        const { results: verifyResults } = await env.USER_DB
          .prepare('SELECT subscribed_at, subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
          .bind(parseInt(userId, 10))
          .all();
        
        if (verifyResults.length > 0) {
          console.log('Subscription successfully updated:', {
            user_id: userId,
            subscribed_at: verifyResults[0].subscribed_at,
            subscription_expired_at: verifyResults[0].subscription_expired_at
          });
        }
        
        // Notify user about successful subscription
        try {
          console.log(`Sending notification to user ${userId}`);
          await sendMessageWithSubscriptionCheck(userId,
            "🎉 Your subscription has been activated! You now have access to daily personalized English lessons.",
            env,
            { reply_markup: { inline_keyboard: [[{ text: "Start Lesson Now", callback_data: "lesson:start" }]] } }
          );
          console.log(`Notification sent to user ${userId}`);
        } catch (msgError) {
          console.error('Error sending subscription notification:', msgError);
          // Continue even if notification fails
        }
        
        console.log('==== TRIBUTE WEBHOOK PROCESSING COMPLETED SUCCESSFULLY ====');
        
        return new Response(JSON.stringify({ 
          status: 'success',
          message: 'Subscription activated successfully',
          user_id: userId,
          expiry_date: subscription_expired_at
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
        
      } catch (error) {
        console.error('Error processing subscription:', error);
        return new Response(JSON.stringify({ 
          status: 'error', 
          message: 'Database error: ' + error.message 
        }), { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    } else {
      console.log('Not identified as a new subscription event, skipping processing');
      return new Response(JSON.stringify({
        status: 'success',
        message: 'Event received but not processed (not identified as a new subscription)'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
  } catch (error) {
    console.error('Unhandled error in handleTributeWebhook:', error);
    return new Response(JSON.stringify({ 
      status: 'error', 
      message: 'Internal server error: ' + error.message 
    }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Verify Tribute webhook signature
async function verifyTributeSignature(payload, signature, apiKey) {
  if (!payload || !signature || !apiKey) {
    throw new Error('Missing required parameters for signature verification');
  }

  try {
    // Tribute uses standard HMAC-SHA256 for signature verification
    // 1. Create a crypto key from the API key
    const encoder = new TextEncoder();
    const keyData = encoder.encode(apiKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
    
    // 2. Calculate HMAC of the payload
    const payloadData = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      payloadData
    );
    
    // 3. Convert to hex
    const calculatedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // 4. Compare with the provided signature
    // Note: Depending on how Tribute formats their signature, you might need to adjust this comparison
    // Some services use base64 encoding, others use hex
    console.log('Calculated signature:', calculatedSignature);
    console.log('Provided signature:', signature);
    
    return calculatedSignature === signature;
  } catch (error) {
    console.error('Error during signature verification:', error);
    throw new Error('Signature verification failed: ' + error.message);
  }
}

// Keep existing Stripe webhook handler for backward compatibility
async function handleStripeWebhook(request, env) {
  // Проверяем метод запроса
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  
  // Получаем сигнатуру для проверки
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    console.error('Missing stripe-signature header');
    return new Response('Missing signature', { status: 400 });
  }
  
  // Получаем тело запроса
  const payload = await request.text();
  
  try {
    // Проверяем подпись вебхука
    let event;
    try {
      event = await verifyStripeSignature(payload, signature, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
    
    console.log('Received Stripe webhook event:', event.type);
    
    // Обрабатываем только событие завершения checkout сессии
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      
      // Проверяем статус платежа
      if (session.payment_status === 'paid') {
        console.log('Payment successful for session:', session.id);
        
        // Получаем ID пользователя из метаданных сессии
        const telegramId = session.metadata?.telegram_id;
        
        if (!telegramId) {
          console.error('No telegram_id in session metadata');
          return new Response('Invalid session metadata', { status: 400 });
        }
        
        // Проверяем, не обработан ли уже этот платеж
        const { results: paymentResults } = await env.USER_DB
          .prepare('SELECT * FROM payment_history WHERE stripe_session_id = ?')
          .bind(session.id)
          .all();
        
        if (paymentResults.length > 0) {
          console.log(`Payment for session ${session.id} already processed, skipping`);
          return new Response(JSON.stringify({ received: true, status: 'already_processed' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }
        
        // Логируем платеж в базу данных
        try {
          await env.USER_DB
            .prepare(`
              INSERT INTO payment_history (
                telegram_id, 
                amount, 
                status, 
                stripe_session_id,
                created_at
              ) VALUES (?, ?, ?, ?, ?)
            `)
            .bind(
              parseInt(telegramId, 10),
              session.amount_total / 100, // Конвертируем центы в доллары
              'completed',
              session.id,
              new Date().toISOString()
            )
            .run();
            
          console.log(`Payment logged for session ${session.id}, user ${telegramId}`);
        } catch (dbError) {
          console.error('Error logging payment to database:', dbError);
          // Продолжаем, даже если не удалось записать платеж
        }
        
        // Обрабатываем подписку через payment worker
        const paymentResponse = await env.PAYMENT.fetch('https://internal/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            telegram_id: telegramId,
            action: 'process_subscription',
            session_id: session.id
          })
        });
        
        if (!paymentResponse.ok) {
          const errorText = await paymentResponse.text();
          throw new Error(`Payment processing failed: ${errorText}`);
        }
        
        // Отправляем пользователю сообщение о успешной оплате
        try {
          await sendMessageWithSubscriptionCheck(
            telegramId,
            "🎉 Your payment has been processed successfully! Your subscription is now active.",
            env,
            { reply_markup: { inline_keyboard: [[{ text: "Start Lesson Now", callback_data: "lesson:start" }]] } }
          );
        } catch (msgError) {
          console.error('Error sending confirmation message:', msgError);
        }
        
        // Сбрасываем флаг обработки платежа
        try {
          await env.USER_DB
            .prepare('UPDATE user_profiles SET payment_processing = 0, stripe_session_id = NULL WHERE telegram_id = ?')
            .bind(parseInt(telegramId, 10))
            .run();
        } catch (resetError) {
          console.error('Error resetting payment flags:', resetError);
        }
        
        console.log(`Successfully processed subscription for user ${telegramId}`);
      } else {
        console.log(`Payment not yet completed for session: ${session.id}`);
      }
    }
    
    // Отвечаем успехом
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('Webhook processing error:', error.message);
    return new Response(`Webhook Error: ${error.message}`, { status: 400 });
  }
}

// Verify Stripe webhook signature - kept for backward compatibility
async function verifyStripeSignature(payload, signature, secret) {
  if (!payload || !signature || !secret) {
    throw new Error('Missing required parameters for signature verification');
  }

  // В реальном производственном коде здесь должна быть полная
  // проверка HMAC-SHA256 подписи с использованием crypto API.
  // В этом примере мы просто проверяем наличие подписи и парсим JSON.
  
  // Разбор заголовка подписи для базовой проверки
  const timestampAndSignatures = signature.split(',').map(item => {
    const [key, value] = item.split('=');
    return { key, value };
  });

  const timestamp = timestampAndSignatures.find(item => item.key === 't')?.value;
  
  if (!timestamp) {
    throw new Error('Unable to extract timestamp from signature');
  }

  // Проверка актуальности запроса (не старше 5 минут)
  const currentTimestamp = Math.floor(Date.now() / 1000);
  if (currentTimestamp - parseInt(timestamp) > 300) {
    throw new Error('Webhook timeout');
  }

  try {
    return JSON.parse(payload);
  } catch (error) {
    throw new Error('Invalid payload JSON');
  }
}

// UPDATED: Function to send Tribute channel link for subscription
async function sendTributeChannelLink(chatId, env) {
  console.log(`[DEBUG] sendTributeChannelLink called for user ${chatId}`);
  
  // Get channel link from environment variable
  let channelLink = env.TRIBUTE_CHANNEL_LINK;
  
  // Если переменная окружения недоступна, используем тестовую ссылку
  if (!channelLink || channelLink.trim() === '') {
    console.warn(`[DEBUG] TRIBUTE_CHANNEL_LINK not found in environment, using fallback link`);
    channelLink = "https://t.me/LinguaPulseSubscribe"; // Замените на актуальную ссылку
  }

  const message = "🔑 To unlock premium lessons, please subscribe to our channel:\n\n" +
                 "1. Click the button below to open our channel\n" +
                 "2. Press the 'Subscribe' button in the channel ($1/week)\n" +
                 "3. After payment, you'll receive a confirmation message from the bot\n\n" +
                 "Your subscription will give you access to daily personalized English lessons!";
  
  // Использовать inline_keyboard с кнопкой подписки
  if (channelLink) {
    await sendMessageViaTelegram(chatId, message, env, {
      reply_markup: {
        inline_keyboard: [[{ text: "Subscribe for $1/week", url: channelLink }]]
      }
    });
  } else {
    await sendMessageViaTelegram(chatId, message, env);
  }
}

// KV prefix for transient test state
const STATE_PREFIX = 'state:';

/* ──── helper: send a text via Telegram Bot API ──── */
async function sendMessageViaTelegram(chatId, text, env, options = null) {
  try {
    console.log(`[DEBUG] sendMessageViaTelegram for user ${chatId}:`, text.substring(0, 50) + (text.length > 50 ? "..." : ""));
    
    const payload = { chat_id: chatId, text };
    
    if (options) {
      console.log(`[DEBUG] Message options type:`, typeof options);
      
      // If options already has a reply_markup
      if (options.reply_markup) {
        console.log(`[DEBUG] reply_markup found:`, JSON.stringify(options.reply_markup).substring(0, 200));
        payload.reply_markup = options.reply_markup;
      }
      // DEPRECATED: If options is directly a keyboard (for backward compatibility)
      else if (options.inline_keyboard) {
        console.log(`[DEBUG] Direct inline_keyboard found - DEPRECATED FORMAT:`, JSON.stringify(options).substring(0, 200));
        console.warn(`DEPRECATED: Passing inline_keyboard directly is deprecated. Use reply_markup.inline_keyboard instead.`);
        // Convert to correct format
        payload.reply_markup = { inline_keyboard: options.inline_keyboard };
      }
      // If options is an object with other properties
      else {
        console.log(`[DEBUG] Other options found:`, JSON.stringify(options).substring(0, 200));
        
        // Handle parse_mode option
        if (options.parse_mode) {
          payload.parse_mode = options.parse_mode;
        }
      }
    }
    
    console.log(`[DEBUG] Final payload for Telegram API:`, JSON.stringify(payload).substring(0, 400));
    
    const response = await callTelegram('sendMessage', payload, env);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG] Telegram API error:`, errorText);
      throw new Error(`Telegram API error: ${errorText}`);
    }
    
    console.log(`[DEBUG] Message sent successfully to ${chatId}`);
    return response;
  } catch (error) {
    console.error(`[DEBUG] Error sending message to ${chatId}:`, error);
    throw error; // Re-throw to handle at the caller level
  }
}

/* ──── helper: add subscription button to message if user has no active subscription ──── */
async function sendMessageWithSubscriptionCheck(chatId, text, env, options = null) {
  try {
    console.log(`[DEBUG] sendMessageWithSubscriptionCheck for user ${chatId}, text: ${text.substring(0, 30)}...`);
    
    // Всегда проверяем активную подписку
    const isSubscribed = await hasActiveSubscription(chatId, env);
    console.log(`[DEBUG] User ${chatId} is subscribed: ${isSubscribed}`);
    
    // Всегда проверяем наличие channelLink
    let channelLink = env.TRIBUTE_CHANNEL_LINK;
    
    // Если переменная окружения недоступна, используем тестовую ссылку
    if (!channelLink || channelLink.trim() === '') {
      console.warn(`[DEBUG] TRIBUTE_CHANNEL_LINK not found in environment, using fallback link`);
      channelLink = "https://t.me/LinguaPulseSubscribe"; // Замените на актуальную ссылку
    }
    
    // Проверяем, что ссылка имеет корректный формат и начинается с https:// или http://
    if (channelLink && !channelLink.match(/^https?:\/\//)) {
      console.warn(`[DEBUG] Channel link doesn't start with http:// or https://, fixing: ${channelLink}`);
      channelLink = "https://" + channelLink.replace(/^[\/\\]+/, '');
    }
    
    console.log(`[DEBUG] Using channel link: ${channelLink}`);
    
    // Если нет активной подписки и есть ссылка на канал - добавляем кнопку
    if (!isSubscribed && channelLink) {
      // Создаем безопасную копию опций или инициализируем, если их нет
      let messageOptions;
      
      try {
        if (options) {
          messageOptions = JSON.parse(JSON.stringify(options));
        } else {
          messageOptions = {};
        }
      } catch (error) {
        console.error(`[DEBUG] Error cloning options, creating new object:`, error);
        messageOptions = {};
        
        // Переносим базовые свойства вручную, если клонирование не удалось
        if (options) {
          if (options.parse_mode) messageOptions.parse_mode = options.parse_mode;
          
          // Безопасно скопировать reply_markup, если он есть
          if (options.reply_markup) {
            messageOptions.reply_markup = { inline_keyboard: [] };
            
            // Копируем существующую клавиатуру, если она есть
            if (options.reply_markup.inline_keyboard && Array.isArray(options.reply_markup.inline_keyboard)) {
              options.reply_markup.inline_keyboard.forEach(row => {
                if (Array.isArray(row)) {
                  const newRow = [];
                  row.forEach(button => {
                    newRow.push({...button});
                  });
                  messageOptions.reply_markup.inline_keyboard.push(newRow);
                }
              });
            }
          }
        }
      }
      
      console.log(`[DEBUG] Original message options:`, JSON.stringify(messageOptions));
      
      // Добавляем или объединяем reply_markup с кнопкой подписки
      if (!messageOptions.reply_markup) {
        // Нет кнопок - создаем новую клавиатуру
        messageOptions.reply_markup = {
          inline_keyboard: [[{ text: "Subscribe for $1/week", url: channelLink }]]
        };
      } else {
        // Уже есть кнопки
        if (!messageOptions.reply_markup.inline_keyboard) {
          // Нет именно inline_keyboard, создаем ее
          messageOptions.reply_markup.inline_keyboard = [[{ text: "Subscribe for $1/week", url: channelLink }]];
        } else {
          // Есть inline_keyboard, добавляем новую строку с кнопкой
          messageOptions.reply_markup.inline_keyboard.push([{ text: "Subscribe for $1/week", url: channelLink }]);
        }
      }
      
      console.log(`[DEBUG] Final message options with subscription button:`, JSON.stringify(messageOptions));
      return await sendMessageViaTelegram(chatId, text, env, messageOptions);
    }
    
    // Пользователь подписан или нет ссылки на канал - отправляем обычное сообщение
    console.log(`[DEBUG] Sending regular message without subscription button`);
    return await sendMessageViaTelegram(chatId, text, env, options);
  } catch (error) {
    console.error(`Error in sendMessageWithSubscriptionCheck for user ${chatId}:`, error);
    // Обработка ошибок и возврат к обычной отправке сообщения
    return await sendMessageViaTelegram(chatId, text, env, options);
  }
}

/* ──── helper: call any Telegram API method ──── */
async function callTelegram(method, payload, env) {
  try {
    console.log(`[DEBUG] Calling Telegram API ${method} with payload:`, JSON.stringify(payload).substring(0, 300));
    
    if (!env.BOT_TOKEN) {
      console.error(`[DEBUG] Missing BOT_TOKEN in environment`);
      throw new Error("Missing BOT_TOKEN");
    }
    
    const apiUrl = `https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`;
    console.log(`[DEBUG] API URL:`, apiUrl);
    
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    console.log(`[DEBUG] Telegram API ${method} response status:`, response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[DEBUG] Telegram API ${method} error:`, errorText);
      try {
        const errorJson = JSON.parse(errorText);
        console.error(`[DEBUG] Telegram API error details:`, JSON.stringify(errorJson));
      } catch (e) {
        // Ignore if not JSON
      }
    } else {
      console.log(`[DEBUG] Telegram API ${method} call successful`);
    }
    
    return response;
  } catch (error) {
    console.error(`[DEBUG] Error calling Telegram API ${method}:`, error);
    throw error;
  }
}

/* ──── helper: proxy payload to another Worker ──── */
function forward(service, payload) {
  return service.fetch('https://internal/', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify(payload)
  });
}

/* ──── helper: check if user has completed test ──── */
async function hasCompletedTest(chatId, env) {
  const { results } = await env.USER_DB
    .prepare('SELECT eng_level FROM user_profiles WHERE telegram_id = ?')
    .bind(parseInt(chatId, 10))
    .all();
  
  return results[0]?.eng_level ? true : false;
}

/* ──── helper: handle lesson command ──── */
async function handleLessonCommand(chatId, env) {
  try {
    console.log(`handleLessonCommand started for user ${chatId}`);
    
    // Get user profile with all necessary fields
    console.log(`Querying database for user ${chatId}`);
    const { results } = await env.USER_DB
      .prepare('SELECT * FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    console.log(`Database query results for user ${chatId}:`, results.length ? "Found" : "Not found");
    
    if (!results.length) {
      console.log(`User ${chatId} not found, sending test message`);
      await sendMessageWithSubscriptionCheck(chatId, 
        'You need to take the placement test first. Use /start to begin.', env);
      return;
    }
    
    const profile = results[0];
    console.log(`User ${chatId} profile:`, {
      eng_level: profile.eng_level,
      pass_lesson0_at: !!profile.pass_lesson0_at,
      subscription_expired_at: profile.subscription_expired_at,
      next_lesson_access_at: profile.next_lesson_access_at
    });
    
    // Basic profile info
    const testedAt = profile.tested_at ? new Date(profile.tested_at).toLocaleDateString() : 'N/A';
    const lessonsTotal = profile.number_of_lessons || 0;
    const lessonsStreak = profile.lessons_in_row || 0;
    
    let message = `Your language profile:\n` +
      `Language level: ${profile.eng_level}\n` +
      `Total lessons completed: ${lessonsTotal}\n` +
      `Current lesson streak: ${lessonsStreak}\n\n`;
    
    // Check pass_lesson0_at first
    if (!profile.pass_lesson0_at) {
      console.log(`User ${chatId} hasn't taken free lesson, showing free lesson button`);
      // Free lesson not taken yet - show button
      message += 'You haven\'t taken your free introductory lesson yet.';
      await sendMessageWithSubscriptionCheck(chatId, message, env, {
        reply_markup: {
          inline_keyboard: [[{ text: 'Free audio lesson', callback_data: 'lesson:free' }]]
        }
      });
      return;
    }
    
    // Check subscription status
    const now = new Date();
    const subExpiredAt = profile.subscription_expired_at ? new Date(profile.subscription_expired_at) : null;
    
    if (!subExpiredAt || subExpiredAt.getTime() < now.getTime()) {
      console.log(`User ${chatId} subscription expired or not present, showing subscribe button`);
      // No active subscription or it's expired - show subscribe button to Tribute channel
      message += 'Your subscription has expired or you haven\'t subscribed yet.';
      await sendMessageWithSubscriptionCheck(chatId, message, env);
      return;
    }
    
    // Active subscription - show next lesson access time
    const nextLessonAt = profile.next_lesson_access_at ? new Date(profile.next_lesson_access_at) : null;
    
    if (nextLessonAt && nextLessonAt.getTime() > now.getTime()) {
      console.log(`User ${chatId} lesson not yet available, showing wait message`);
      // Format the time until next lesson
      const timeUntil = formatTimeUntil(nextLessonAt);
      message += `Your next lesson will be available in ${timeUntil}.`;
      await sendMessageWithSubscriptionCheck(chatId, message, env);
      return;
    }
    
    console.log(`User ${chatId} lesson available now, showing start lesson button`);
    // Lesson is available now
    message += 'Your next lesson is available now!';
    await sendMessageWithSubscriptionCheck(chatId, message, env, {
      reply_markup: {
        inline_keyboard: [[{ text: 'Start lesson', callback_data: 'lesson:start' }]]
      }
    });
    
    console.log(`handleLessonCommand completed successfully for user ${chatId}`);
  } catch (error) {
    console.error(`Error in handleLessonCommand for user ${chatId}:`, error);
    // Try to send a fallback message
    try {
      await sendMessageWithSubscriptionCheck(chatId, 
        "Sorry, there was an error processing your command. Please try again later or contact support.", 
        env);
    } catch (sendError) {
      console.error("Failed to send error message:", sendError);
    }
  }
}

/* ──── helper: format time until date in human-readable form ──── */
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

/* ──── helper: check if user has active subscription ──── */
async function hasActiveSubscription(chatId, env) {
  try {
    console.log(`[DEBUG] Checking subscription status for user ${chatId}`);
    
    const { results } = await env.USER_DB
      .prepare('SELECT subscription_expired_at FROM user_profiles WHERE telegram_id = ?')
      .bind(parseInt(chatId, 10))
      .all();
    
    console.log(`[DEBUG] Database query results for subscription check:`, JSON.stringify(results));
    
    if (results.length === 0) {
      console.log(`[DEBUG] User ${chatId} not found in database, subscription status: false`);
      return false;
    }
    
    const now = new Date();
    const subExpiredAt = results[0].subscription_expired_at ? new Date(results[0].subscription_expired_at) : null;
    
    const isActive = subExpiredAt && subExpiredAt > now;
    console.log(`[DEBUG] User ${chatId} subscription status: ${isActive}, expiry date: ${subExpiredAt ? subExpiredAt.toISOString() : 'none'}`);
    
    return isActive;
  } catch (error) {
    console.error(`Error checking subscription status for user ${chatId}:`, error);
    return false; // If we can't verify, assume no subscription
  }
}
