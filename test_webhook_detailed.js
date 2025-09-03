// Using built-in fetch (Node.js 18+)

async function testWebhook() {
    console.log('🧪 Тестирование Cloudflare Worker с детальными логами...');
    
    const webhookUrl = 'https://telegram-webhook.andreykatkov13.workers.dev/tg';
    
    // Тест 1: Простой ping
    console.log('\n1️⃣ Тест простого ping...');
    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ test: 'ping' })
        });
        
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Response:', text);
    } catch (error) {
        console.error('❌ Ping failed:', error.message);
    }
    
    // Тест 2: Симуляция /start команды
    console.log('\n2️⃣ Тест команды /start...');
    try {
        const startPayload = {
            update_id: 123456789,
            message: {
                message_id: 1,
                from: {
                    id: 123456789,
                    is_bot: false,
                    first_name: "Test",
                    username: "testuser"
                },
                chat: {
                    id: 123456789,
                    first_name: "Test",
                    username: "testuser",
                    type: "private"
                },
                date: Math.floor(Date.now() / 1000),
                text: "/start"
            }
        };
        
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(startPayload)
        });
        
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Response:', text);
    } catch (error) {
        console.error('❌ /start test failed:', error.message);
    }
    
    // Тест 3: Проверка переменных окружения
    console.log('\n3️⃣ Тест переменных окружения...');
    try {
        const envTestPayload = {
            action: 'test_env',
            user_id: 123456789
        };
        
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(envTestPayload)
        });
        
        console.log('Status:', response.status);
        const text = await response.text();
        console.log('Response:', text);
    } catch (error) {
        console.error('❌ Env test failed:', error.message);
    }
}

testWebhook().catch(console.error);
