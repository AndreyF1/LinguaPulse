// Script to set webhook for dev bot with correct token
async function setWebhook() {
  // Правильный токен dev бота
  const devBotToken = '7550281913:AAF7DTE1ptVMYSaGCY_CY9JCtSSFn9N8aTY';
  
  console.log('Setting webhook for dev bot...');
  console.log('Bot token length:', devBotToken.length);
  
  // Set webhook URL
  const webhookUrl = 'https://dev-telegram-webhook.andreykatkov13.workers.dev/tg';
  
  try {
    // Test the token first
    console.log('Testing bot token...');
    const testResponse = await fetch(`https://api.telegram.org/bot${devBotToken}/getMe`);
    const testResult = await testResponse.json();
    
    if (!testResult.ok) {
      console.error('Token test failed:', testResult);
      return;
    }
    
    console.log('Bot info:', testResult.result);
    
    const response = await fetch(`https://api.telegram.org/bot${devBotToken}/setWebhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query']
      })
    });
    
    const result = await response.json();
    console.log('Webhook setup result:', result);
    
    if (result.ok) {
      console.log('✅ Webhook set successfully!');
      console.log('Webhook URL:', webhookUrl);
      
      // Also get current webhook info to verify
      const infoResponse = await fetch(`https://api.telegram.org/bot${devBotToken}/getWebhookInfo`);
      const infoResult = await infoResponse.json();
      console.log('Current webhook info:', infoResult);
      
    } else {
      console.error('❌ Failed to set webhook:', result);
    }
    
  } catch (error) {
    console.error('Error setting webhook:', error);
  }
}

setWebhook(); 