#!/usr/bin/env node

/**
 * Тест подключения к Lambda функции
 */

const LAMBDA_URL = "https://llcr9578ee.execute-api.us-east-1.amazonaws.com/prod/onboarding";
const LAMBDA_TOKEN = "linguapulse-secret-token-2024";

async function testLambdaConnection() {
  console.log("🧪 Тестирование подключения к Lambda функции...");
  console.log("URL:", LAMBDA_URL);
  console.log("");

  // Тест 1: Простой ping
  console.log("1️⃣ Тест простого ping...");
  try {
    const response = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAMBDA_TOKEN}`
      },
      body: JSON.stringify({
        test: true,
        message: "ping"
      })
    });

    console.log("Status:", response.status);
    console.log("Headers:", Object.fromEntries(response.headers.entries()));
    
    if (response.ok) {
      const result = await response.text();
      console.log("Response:", result);
      console.log("✅ Ping успешен!");
    } else {
      console.log("❌ Ping failed:", response.status);
    }
  } catch (error) {
    console.log("❌ Ошибка ping:", error.message);
  }

  console.log("");

  // Тест 2: Симуляция команды /start
  console.log("2️⃣ Тест команды /start...");
  try {
    const response = await fetch(LAMBDA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LAMBDA_TOKEN}`
      },
      body: JSON.stringify({
        message: {
          text: "/start",
          chat: { id: 123456789 },
          from: { id: 123456789, username: "test_user" }
        }
      })
    });

    console.log("Status:", response.status);
    
    if (response.ok) {
      const result = await response.text();
      console.log("Response:", result);
      console.log("✅ Команда /start обработана!");
    } else {
      console.log("❌ Команда /start failed:", response.status);
    }
  } catch (error) {
    console.log("❌ Ошибка команды /start:", error.message);
  }

  console.log("");
  console.log("🎯 Результат тестирования:");
  console.log("Если оба теста прошли успешно, Lambda функция готова к работе!");
  console.log("Теперь можно настроить Cloudflare Worker с этими переменными.");
}

// Запуск теста
testLambdaConnection().catch(console.error);
