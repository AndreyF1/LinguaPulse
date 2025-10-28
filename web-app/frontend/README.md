# LinguaPulse Web Frontend

AI-powered English conversation practice app built with React, Vite, Google Gemini Live API, and Supabase.

## 🚀 Tech Stack

- **Frontend**: React 19 + TypeScript
- **Build Tool**: Vite
- **AI**: Google Gemini Live API (multimodal streaming)
- **Backend**: Supabase (Auth, Database, RLS)
- **Styling**: Tailwind CSS (via inline classes)

## 📋 Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Gemini API Key ([Get one here](https://aistudio.google.com/app/apikey))
- Supabase Project (already configured in `supabaseClient.ts`)

## 🔧 Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env.local` file in this directory:

```bash
# Required: Get your API key from https://aistudio.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key_here
```

> **Note**: Supabase credentials are already hardcoded in `supabaseClient.ts`. For production, move them to environment variables.

### 3. Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

## 🏗️ Project Structure

```
frontend/
├── components/           # React components
│   ├── ConversationScreen.tsx  # Main voice conversation UI
│   ├── HistoryScreen.tsx       # Session history & monthly reports
│   ├── LoginScreen.tsx         # Magic link authentication
│   ├── ScenarioSelectionScreen.tsx  # Scenario picker
│   └── Icons.tsx               # SVG icon components
├── contexts/
│   └── UserContext.tsx         # User auth & session management
├── services/
│   └── storageService.ts       # LocalStorage utilities
├── utils/
│   └── audioUtils.ts           # Audio encoding/decoding for Gemini
├── types.ts                    # TypeScript types (imported from shared/)
├── supabaseClient.ts           # Supabase initialization
├── App.tsx                     # Main app component
├── index.tsx                   # React entry point
└── vite.config.ts              # Vite configuration

```

## 📦 Available Scripts

- `npm run dev` - Start development server (port 3000)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run typecheck` - Run TypeScript type checking
- `npm run clean` - Remove build artifacts and node_modules
- `npm run install:clean` - Clean install of dependencies

## 🔑 Features

### ✅ Implemented
- **Magic Link Authentication** (Supabase Auth)
- **Voice Conversations** (Gemini Live API with streaming)
- **Real-time Transcription** (user + AI)
- **AI Feedback Generation** (pronunciation, grammar, vocabulary, fluency, comprehension)
- **Session History** (stored in Supabase `lesson_sessions` table)
- **Monthly Progress Reports** (AI-generated via Gemini)
- **In-Progress Session Recovery** (localStorage + Supabase sync)

### 🚧 TODO
- Onboarding funnel (anonymous user tracking)
- Demo lesson (without registration)
- Payment integration (YooMoney)
- User dashboard (subscription management)
- Progress analytics
- Dynamic difficulty selection

## 🗄️ Database Schema

The app uses the following Supabase tables:

- **`users`** - User accounts (magic link + Telegram)
- **`lesson_sessions`** - Completed lesson sessions with feedback
- **`anonymous_sessions`** - Pre-auth user journey (funnel + demo)
- **`payments`** - Payment records (YooMoney)
- **`products`** - Available subscription packages

See `../../shared/types/database.ts` for full type definitions.

## 🔒 Security

- **Row Level Security (RLS)** enabled on all tables
- **Supabase Auth** handles JWT tokens
- **Service Role Key** never exposed to client
- Sessions auto-saved to prevent data loss

## 🐛 Common Issues

### "Cannot find module 'react'"
Run `npm install` to install dependencies.

### "GEMINI_API_KEY is not defined"
Create `.env.local` file with your Gemini API key (see Setup section).

### "Failed to save session"
Check RLS policies in Supabase dashboard. User must be authenticated.

## 📄 License

Proprietary - LinguaPulse
