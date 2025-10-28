/**
 * Database Types for LinguaPulse
 * Generated from Supabase schema
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ============================================
// ENUMS
// ============================================

export type AuthProvider = 'telegram' | 'magic_link' | 'google' | 'email'

// ============================================
// TABLE TYPES
// ============================================

export interface Database {
  public: {
    Tables: {
      users: {
        Row: User
        Insert: UserInsert
        Update: UserUpdate
      }
      anonymous_sessions: {
        Row: AnonymousSession
        Insert: AnonymousSessionInsert
        Update: AnonymousSessionUpdate
      }
      lesson_sessions: {
        Row: LessonSession
        Insert: LessonSessionInsert
        Update: LessonSessionUpdate
      }
      payments: {
        Row: Payment
        Insert: PaymentInsert
        Update: PaymentUpdate
      }
      products: {
        Row: Product
        Insert: ProductInsert
        Update: ProductUpdate
      }
    }
  }
}

// ============================================
// USER
// ============================================

export interface User {
  id: string
  
  // Identity
  telegram_id?: number | null
  email?: string | null
  username?: string | null
  auth_provider: AuthProvider
  email_verified: boolean
  
  // Subscription
  lessons_left: number
  package_expires_at?: string | null
  last_payment_at?: string | null
  
  // Progress
  total_lessons_completed: number
  current_streak: number
  last_lesson_date?: string | null
  
  // Web tracking
  onboarding_completed: boolean
  
  // Meta
  created_at: string
  updated_at: string
}

export type UserInsert = Omit<User, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  created_at?: string
  updated_at?: string
}

export type UserUpdate = Partial<UserInsert>

// ============================================
// ANONYMOUS SESSION
// ============================================

export interface AnonymousSession {
  id: string
  
  // Attribution (UTM tracking)
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  referrer?: string | null
  
  // Funnel data (JSONB)
  funnel_answers: Json // Array: [{"question": 1, "answer": "English"}]
  funnel_completed: boolean
  
  // Demo session data (JSONB)
  demo_scenario?: string | null
  demo_transcript?: Json | null // Array: [{"role": "user", "content": "Hello"}]
  demo_feedback?: string | null
  demo_scores?: Json | null // {"grammar": 8, "vocabulary": 7}
  demo_completed: boolean
  
  // Conversion tracking
  converted_to_user_id?: string | null
  converted_at?: string | null
  
  // Device info
  user_agent?: string | null
  
  // Meta
  created_at: string
  updated_at: string
}

export type AnonymousSessionInsert = Omit<AnonymousSession, 'id' | 'created_at' | 'updated_at'> & {
  id?: string
  created_at?: string
  updated_at?: string
}

export type AnonymousSessionUpdate = Partial<AnonymousSessionInsert>

// ============================================
// LESSON SESSION
// ============================================

export interface LessonSession {
  id: string
  user_id: string
  
  // Lesson data
  scenario_title: string
  difficulty: string
  transcript: Json
  
  // Feedback
  scores?: Json | null
  feedback_text?: string | null
  
  // Timestamps
  created_at: string
  updated_at?: string | null
}

export type LessonSessionInsert = Omit<LessonSession, 'id' | 'created_at'> & {
  id?: string
  created_at?: string
}

export type LessonSessionUpdate = Partial<LessonSessionInsert>

// ============================================
// PAYMENT
// ============================================

export interface Payment {
  id: string
  
  // User identification
  user_id?: string | null
  
  // Payment data
  product_id: string
  amount: number
  status: string
  
  // Provider data
  provider: string
  provider_operation_id: string
  label?: string | null
  raw?: Json
  
  // Timestamp
  created_at: string
}

export type PaymentInsert = Omit<Payment, 'id' | 'created_at'> & {
  id?: string
  created_at?: string
}

export type PaymentUpdate = Partial<PaymentInsert>

// ============================================
// PRODUCT
// ============================================

export interface Product {
  id: string
  name: string
  description?: string | null
  price: number
  duration_days: number
  lessons_granted: number
  is_active: boolean
}

export type ProductInsert = Omit<Product, 'id'> & {
  id?: string
}

export type ProductUpdate = Partial<ProductInsert>

// ============================================
// HELPER TYPES
// ============================================

// Message in transcript (for demo_transcript and lesson transcript)
export interface TranscriptMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
  audio_url?: string
}

// Scores from AI feedback
export interface FeedbackScores {
  grammar?: number
  vocabulary?: number
  pronunciation?: number
  fluency?: number
  overall?: number
}

// Funnel answer item
export interface FunnelAnswerItem {
  question: number
  answer: string
  time_spent?: number
}

