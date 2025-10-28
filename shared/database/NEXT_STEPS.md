# Next Steps - Web Version Implementation

## ✅ Что уже сделано

### 1. **Git Реструктуризация** ✅
- [x] Создана ветка `telegram-version` с текущим кодом
- [x] Перемещены файлы Telegram-бота в `telegram-bot/`
- [x] Создана структура для веб-версии `web-app/`
- [x] Обновлена документация

### 2. **Supabase CLI** ✅
- [x] Установлен Supabase CLI
- [x] Подключен проект (qpqwyvzpwwwyolnvtglw)
- [x] Получена схема существующей БД

### 3. **База данных - Архитектура** ✅
- [x] Спроектирована архитектура для веб-воронки
- [x] Созданы 8 SQL миграций:
  - 001: `web_visitors` (анонимный tracking)
  - 002: `funnel_answers` (10 вопросов)
  - 003: `events` (универсальная аналитика)
  - 004: `demo_sessions` (демо до регистрации)
  - 005: Модификация `users` (email, auth_provider)
  - 006: Модификация `payments`, переименование `sessions`
  - 007: Миграция `profiles` → `users`
  - 008: RLS политики
- [x] Созданы TypeScript типы (`shared/types/database.ts`)
- [x] Документирована архитектура (`WEB_ARCHITECTURE_PLAN.md`)

### 4. **Доступ к БД** ✅
- [x] Настроен REST API доступ через Service Role Key
- [x] Создан скрипт для получения схемы
- [x] Сохранена полная схема в `shared/database/supabase_schema_full.json`

---

## 🚀 Следующие шаги (по порядку)

### **Этап 1: Применить миграции БД** (КРИТИЧНО!)

#### Вариант A: Через SQL Editor (рекомендую для первого раза)
1. Откройте [SQL Editor](https://supabase.com/dashboard/project/qpqwyvzpwwwyolnvtglw/sql)
2. Выполните миграции по порядку (001 → 008)
3. Проверьте результат (SQL запросы в `migrations/README.md`)

**⏱️ Время: ~10 минут**

#### ⚠️ Важно перед миграцией:
```sql
-- Сделайте бэкап в Dashboard:
-- Database → Backups → Create manual backup
```

---

### **Этап 2: Настроить Frontend (Next.js)** 

```bash
cd web-app/frontend

# Инициализация Next.js
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir

# Установка Supabase
npm install @supabase/supabase-js @supabase/auth-ui-react @supabase/auth-ui-shared

# Установка дополнительных библиотек
npm install react-query lucide-react date-fns
npm install -D @types/node
```

**⏱️ Время: ~15 минут**

#### Создать структуру:
```
frontend/
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx         # Magic Link вход
│   │   └── callback/page.tsx      # Auth callback
│   ├── (landing)/
│   │   ├── page.tsx                # Landing с воронкой
│   │   └── demo/page.tsx           # Demo диалог
│   ├── (dashboard)/
│   │   ├── layout.tsx              # Protected layout
│   │   ├── profile/page.tsx        # Личный кабинет
│   │   ├── lessons/page.tsx        # Уроки
│   │   └── feedback/page.tsx       # История фидбеков
│   └── layout.tsx
├── components/
│   ├── funnel/
│   │   ├── FunnelQuestion.tsx
│   │   └── FunnelProgress.tsx
│   ├── demo/
│   │   └── DemoChat.tsx
│   └── dashboard/
│       ├── LessonCard.tsx
│       └── ProgressChart.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # Supabase клиент
│   │   └── server.ts               # Server-side клиент
│   ├── hooks/
│   │   ├── useUser.ts
│   │   ├── useTrackEvent.ts        # Event tracking
│   │   └── useLessons.ts
│   └── api/
│       └── supabase.ts
└── types/
    └── index.ts                    # Re-export from shared/types
```

---

### **Этап 3: Базовая авторизация (Magic Link)**

#### `lib/supabase/client.ts`:
```typescript
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/types/database'

export const supabase = createClientComponentClient<Database>()
```

#### `lib/supabase/server.ts`:
```typescript
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import type { Database } from '@/types/database'

export const createClient = () => {
  return createServerComponentClient<Database>({ cookies })
}
```

#### Environment Variables (`.env.local`):
```env
NEXT_PUBLIC_SUPABASE_URL=https://qpqwyvzpwwwyolnvtglw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key (только для API routes)
```

**⏱️ Время: ~30 минут**

---

### **Этап 4: Воронка + Event Tracking**

#### `lib/hooks/useTrackEvent.ts`:
```typescript
import { supabase } from '@/lib/supabase/client'
import { EventType, EventInsert } from '@/types/database'

export function useTrackEvent() {
  const track = async (
    eventType: EventType, 
    eventData?: Record<string, any>
  ) => {
    // Get or create visitor_id from localStorage
    let visitorId = localStorage.getItem('visitor_id')
    
    if (!visitorId) {
      const { data } = await supabase
        .from('web_visitors')
        .insert({
          utm_source: new URLSearchParams(window.location.search).get('utm_source'),
          utm_medium: new URLSearchParams(window.location.search).get('utm_medium'),
          referrer: document.referrer,
          user_agent: navigator.userAgent,
          session_id: sessionStorage.getItem('session_id') || crypto.randomUUID()
        })
        .select('id')
        .single()
      
      visitorId = data?.id
      if (visitorId) localStorage.setItem('visitor_id', visitorId)
    }

    await supabase.from('events').insert({
      visitor_id: visitorId,
      event_type: eventType,
      event_data: eventData,
      page_url: window.location.href,
      referrer: document.referrer
    })
  }

  return { track }
}
```

**⏱️ Время: ~1 час**

---

### **Этап 5: Supabase Edge Functions**

Миграция AWS Lambda → Supabase Edge Functions:

```bash
cd web-app/supabase/functions

# Создать функции
supabase functions new text-dialog
supabase functions new audio-dialog
supabase functions new grammar-check
supabase functions new yoomoney-webhook
```

#### Пример `text-dialog/index.ts`:
```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { message, lessonId } = await req.json()
  
  // Get user from auth token
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  const { data: { user } } = await supabase.auth.getUser(token!)

  // OpenAI call
  const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [
        { role: 'system', content: 'You are a language tutor...' },
        { role: 'user', content: message }
      ]
    })
  })

  const { choices } = await openaiResponse.json()
  
  return new Response(JSON.stringify({ 
    reply: choices[0].message.content 
  }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
```

**Deploy:**
```bash
supabase functions deploy text-dialog
```

**⏱️ Время: ~3 часа (все функции)**

---

### **Этап 6: Landing Page + Воронка**

Создать лендинг с:
- Hero section с CTA
- 10 вопросов (воронка)
- Paywall
- Demo диалог

**⏱️ Время: ~2 дня**

---

### **Этап 7: Dashboard + Личный кабинет**

- История уроков
- История фидбеков  
- Прогресс-трекер
- Управление подпиской

**⏱️ Время: ~2 дня**

---

### **Этап 8: Платежи (YooMoney)**

Интеграция с существующей системой:
- Переиспользование `payments` таблицы
- Edge Function для webhook
- Связка visitor_id → user_id после оплаты

**⏱️ Время: ~1 день**

---

## 📊 Итоговый Timeline

| Этап | Описание | Время |
|------|----------|-------|
| 1 | Применить миграции БД | 10 мин |
| 2 | Настроить Next.js | 15 мин |
| 3 | Базовая авторизация | 30 мин |
| 4 | Воронка + Tracking | 1 час |
| 5 | Edge Functions | 3 часа |
| 6 | Landing + Воронка UI | 2 дня |
| 7 | Dashboard | 2 дня |
| 8 | Платежи | 1 день |
| **ИТОГО** | **~6 дней** | (при фуллтайме) |

---

## 🎯 Quick Start (Минимальный MVP)

Для быстрого старта можно сделать только:

1. ✅ Миграции БД (10 мин)
2. ✅ Next.js + Auth (1 час)
3. ✅ Простой лендинг с Magic Link (3 часа)
4. ✅ Одна Edge Function (text-dialog) (1 час)
5. ✅ Базовый dashboard (1 день)

**Итого: 2 дня на минимальный MVP**

---

## 📚 Полезные ссылки

- [Supabase Dashboard](https://supabase.com/dashboard/project/qpqwyvzpwwwyolnvtglw)
- [Next.js Docs](https://nextjs.org/docs)
- [Supabase Auth Helpers](https://supabase.com/docs/guides/auth/auth-helpers/nextjs)
- [Edge Functions Guide](https://supabase.com/docs/guides/functions)

---

## ❓ Вопросы для обсуждения

1. **AI модель:** Остаёмся на OpenAI или переходим на Gemini?
2. **Дизайн:** Есть макеты UI или делаем с нуля?
3. **Домен:** Уже есть или нужно подобрать?
4. **Демо:** Голосовой или текстовый для MVP?
5. **Оплата:** До или после регистрации?

---

**Готовы начинать с Этапа 1 (миграции)?** 🚀

