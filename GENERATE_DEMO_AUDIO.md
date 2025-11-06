# 🎤 Генерация статических аудио для демо-хука

## Проблема
Новые пользователи из рекламы ждут 2-3 секунды пока генерируется аудио ответ от Gemini API.

## Решение
Генерируем аудио **один раз**, сохраняем как статические файлы, которые загружаются мгновенно для всех пользователей через CDN Cloudflare.

---

## 🚀 Быстрый способ (через браузер)

1. **Откройте** https://linguapulse.ai/welcome (локально или prod)
2. **Пройдите** воронку до демо-хука
3. **Откройте консоль** (F12)
4. **Запустите:**

```javascript
// Это скачает оба аудио файла
async function downloadDemoAudio() {
    const responses = [
        { text: "That's great to hear! How are you doing today?", filename: 'demo-response1.base64' },
        { text: "I'm so glad to hear that! It was a pleasure to meet you. I hope to see you in our lessons where I can help you become a true pro in English.", filename: 'demo-response2.base64' }
    ];
    
    const ai = new (await import('@google/genai')).GoogleGenAI({ 
        apiKey: 'YOUR_GEMINI_API_KEY' 
    });
    
    for (const response of responses) {
        console.log(`Generating: ${response.filename}...`);
        const result = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: response.text }] }],
            config: {
                responseModalities: ['AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
            }
        });
        
        const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) { console.error('No audio!'); continue; }
        
        // Скачать файл
        const blob = new Blob([base64Audio], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = response.filename;
        a.click();
        console.log(`✅ Downloaded: ${response.filename}`);
    }
}

await downloadDemoAudio();
```

5. **Сохраните** скачанные файлы в:
```
/home/andrei/Documents/Extra incomes/AI tutor/LinguaPulse git/LinguaPulse/web-app/frontend/public/demo-response1.base64
/home/andrei/Documents/Extra incomes/AI tutor/LinguaPulse git/LinguaPulse/web-app/frontend/public/demo-response2.base64
```

6. **Коммит:**
```bash
cd "/home/andrei/Documents/Extra incomes/AI tutor/LinguaPulse git/LinguaPulse"
git add web-app/frontend/public/demo-response*.base64
git commit -m "feat: add pre-generated demo audio files"
git push
```

---

## 📋 Способ через Node.js

```bash
cd "/home/andrei/Documents/Extra incomes/AI tutor/LinguaPulse git/LinguaPulse/web-app/frontend"
export GEMINI_API_KEY="your_key_here"
node scripts/generate-demo-audio.js
```

Это создаст файлы в `/public/`:
- `demo-response1.base64` (~100KB)
- `demo-response2.base64` (~150KB)

---

## ✅ Результат

**До (с генерацией):**
- Новый пользователь: 2-3 сек ожидания
- Каждый раз API вызов

**После (статические файлы):**
- Все пользователи: <100ms (мгновенная загрузка)
- Через CDN Cloudflare
- 0 API вызовов

---

## 🔧 Как работает

```typescript
// Код пытается загрузить статический файл
const audio = await fetch('/demo-response1.base64');

// Если файла нет - fallback на генерацию (медленно)
// Если файл есть - мгновенно загружается!
```

---

## 📊 Размер файлов

| Файл | Размер | Описание |
|------|--------|----------|
| `demo-response1.base64` | ~100KB | "That's great to hear!" |
| `demo-response2.base64` | ~150KB | "I'm so glad to hear that!" |

**Итого:** ~250KB (ничтожно для CDN)

---

🚀 После добавления файлов демо-хук будет работать **мгновенно** для всех пользователей!

