#!/usr/bin/env node

// Quick script to check user subscription status in dev database
// Usage: node check-user-subscription.js [telegram_user_id]

const USER_ID = process.argv[2] || '7629847793'; // Default to your test user

async function checkUserStatus() {
  console.log(`🔍 Checking subscription status for user ${USER_ID}...`);
  
  const query = `
    wrangler d1 execute linguapulse-dev --command="
    SELECT 
      telegram_id,
      eng_level,
      pass_lesson0_at,
      subscribed_at,
      subscription_expired_at,
      next_lesson_access_at,
      number_of_lessons,
      lessons_in_row
    FROM user_profiles 
    WHERE telegram_id = ${USER_ID}
    "
  `;
  
  console.log('Query:', query);
  console.log('\n🚀 Run this command to check user status:');
  console.log(query);
  
  console.log('\n📊 Expected results for working subscription:');
  console.log('- eng_level: should be set (A1, A2, B1, etc.)');
  console.log('- pass_lesson0_at: should be set (completed free lesson)');
  console.log('- subscription_expired_at: should be in the future');
  console.log('- next_lesson_access_at: should be now or in the past (available)');
}

checkUserStatus(); 