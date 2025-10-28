/// <reference types="vite/client" />

// Extend ProcessEnv with our custom environment variables
declare namespace NodeJS {
  interface ProcessEnv {
    API_KEY?: string;
    GEMINI_API_KEY?: string;
  }
}

// Vite replaces process.env.API_KEY at build time via vite.config.ts
// This declaration tells TypeScript that it's safe to use

