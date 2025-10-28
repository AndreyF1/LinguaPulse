# LinguaPulse

AI-powered language learning platform with interactive lessons and real-time feedback.

## 🏗️ Project Structure

This repository contains two versions of LinguaPulse:

### 🤖 Telegram Bot (Archived)
**Location**: `/telegram-bot/` | **Branch**: `telegram-version`

Production Telegram bot with AWS Lambda backend.
- Full conversation practice
- Grammar checking
- Audio transcription
- YooMoney payments

**Status**: ✅ Maintained for existing users

### 🌐 Web Application (Active Development)
**Location**: `/web-app/`

Modern web platform with TypeScript and Supabase.
- Magic Link authentication
- Interactive dashboard
- Lesson history and feedback
- Progress tracking
- Mobile-ready architecture

**Status**: 🚧 In development

## 📚 Documentation

- **[PROJECT_DOCUMENTATION.md](./PROJECT_DOCUMENTATION.md)** - Complete technical documentation
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history
- **[QUICK_REFERENCE.md](./QUICK_REFERENCE.md)** - Quick reference guide

## 🛠️ Tech Stack

### Telegram Bot
- **Backend**: AWS Lambda (Python)
- **Webhook**: Cloudflare Workers
- **Database**: Supabase (PostgreSQL)
- **AI**: OpenAI GPT-4 + Whisper
- **Payments**: YooMoney

### Web App
- **Frontend**: Next.js 14 + TypeScript + Tailwind CSS
- **Backend**: Supabase (Auth, Database, Storage, Edge Functions)
- **AI**: Gemini API / OpenAI
- **Payments**: YooMoney
- **Hosting**: Vercel + Supabase

## 🚀 Getting Started

### For Telegram Bot Development
See `/telegram-bot/README.md`

### For Web App Development
See `/web-app/README.md`

## 📦 Repository Structure

```
LinguaPulse/
├── telegram-bot/              # Telegram bot (archived)
│   ├── AWS Backend/           # Lambda functions
│   │   ├── audio_dialog/
│   │   ├── text_dialog/
│   │   ├── grammar/
│   │   ├── translation/
│   │   ├── payments/
│   │   └── shared/
│   └── Cloudflare Worker/     # Webhook handler
│
├── web-app/                   # Web application (active)
│   ├── frontend/              # Next.js app
│   └── supabase/              # Backend functions
│       ├── functions/         # Edge Functions
│       └── migrations/        # Database migrations
│
├── shared/                    # Shared resources
│   ├── types/                 # TypeScript types
│   └── database/              # SQL schemas
│
└── [docs]                     # Documentation
    ├── PROJECT_DOCUMENTATION.md
    ├── CHANGELOG.md
    └── QUICK_REFERENCE.md
```

## 📝 License

Private project - All rights reserved

## 🤝 Contributing

This is a private project. For questions or suggestions, contact the maintainer.

---

Made with ❤️ for language learners

