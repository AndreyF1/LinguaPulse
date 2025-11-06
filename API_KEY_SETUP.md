# 🔐 Настройка Gemini API ключа

## ⚠️ Проблема

Старый API ключ был заблокирован Google, так как попал в публичный репозиторий GitHub.

---

## ✅ Решение

### 1️⃣ Создайте новый API ключ

1. Откройте: https://ai.google.dev/gemini-api/docs/api-key
2. Нажмите **"Get an API key"**
3. Выберите проект или создайте новый
4. Скопируйте ключ (начинается с `AIza...`)

---

### 2️⃣ Локальная разработка

Создайте файл `.env` в `/web-app/frontend/`:

```bash
cd "/home/andrei/Documents/Extra incomes/AI tutor/LinguaPulse git/LinguaPulse/web-app/frontend"
cat > .env << 'EOF'
VITE_GEMINI_API_KEY=AIza_YOUR_NEW_KEY_HERE
EOF
```

**Важно:** `.env` уже в `.gitignore`, он НЕ попадёт в Git!

---

### 3️⃣ Cloudflare Pages (Production)

1. Откройте: https://dash.cloudflare.com/
2. **Workers & Pages** → **linguapulse-ai**
3. **Settings** → **Environment variables**
4. **Add variable:**
   - Name: `VITE_GEMINI_API_KEY`
   - Value: `AIza_YOUR_NEW_KEY_HERE`
   - Environment: **Production** ✅
5. **Save**
6. **Deployments** → **Retry deployment** (последний деплой)

---

### 4️⃣ Проверка

Локально:
```bash
npm run dev
# Откройте http://localhost:5173/welcome
# Проверьте демо-хук в воронке
```

Production:
- https://linguapulse.ai/welcome
- Попробуйте демо-хук (должен работать)

---

## 🔒 Безопасность

✅ **Сейчас:**
- Ключ в переменных окружения
- `.env` в `.gitignore`
- `import.meta.env.VITE_GEMINI_API_KEY`

❌ **Раньше:**
- Ключ хардкодился в код
- Попал в GitHub → заблокирован

---

## 📝 Что изменилось в коде

**До:**
```typescript
const ai = new GoogleGenAI({ 
    apiKey: 'AIzaSyBRp8FXE_lU1-jIlQvUZvrR6qSna1d_i-E' // 🚫 ПЛОХО
});
```

**После:**
```typescript
const ai = new GoogleGenAI({ 
    apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' // ✅ ХОРОШО
});
```

Изменённые файлы:
- `components/ConversationScreen.tsx`
- `components/HistoryScreen.tsx`
- `components/funnel/Funnel.tsx`
- `components/funnel/Dialogue.tsx`

---

## ❓ Troubleshooting

**Ошибка: "API Key not found"**
→ Проверьте `.env` файл и переменную `VITE_GEMINI_API_KEY`

**Ошибка: "API key was reported as leaked"**
→ Создайте НОВЫЙ ключ (старый заблокирован навсегда)

**Не работает на Cloudflare**
→ Добавьте переменную в Settings → Environment variables
→ Retry deployment после добавления

---

🚀 После настройки всё должно работать!

