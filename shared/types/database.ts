/**
 * Database Types for LinguaPulse
 * Generated from Supabase schema
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

// ============================================
// ENUMS
// ============================================

export type UserLevel = 'Beginner' | 'Intermediate' | 'Advanced'
export type AuthProvider = 'telegram' | 'magic_link' | 'google' | 'email'
export type DemoEndReason = 'completed' | 'timeout' | 'abandoned' | 'error' | 'user_stopped'
export type EventType = 
  | 'visit'
  | 'question_viewed'
  | 'question_answered'
  | 'funnel_completed'
  | 'paywall_view'
  | 'cta_click'
  | 'demo_start'
  | 'demo_message_sent'
  | 'demo_completed'
  | 'demo_abandoned'
  | 'magic_link_sent'
  | 'magic_link_clicked'
  | 'user_registered'
  | 'payment_started'
  | 'payment_success'
  | 'payment_failed'
  | 'first_lesson_start'
  | 'lesson_completed'
  | 'custom'

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
      web_visitors: {
        Row: WebVisitor
        Insert: WebVisitorInsert
        Update: WebVisitorUpdate
      }
      funnel_answers: {
        Row: FunnelAnswer
        Insert: FunnelAnswerInsert
        Update: FunnelAnswerUpdate
      }
      events: {
        Row: Event
        Insert: EventInsert
        Update: EventUpdate
      }
      demo_sessions: {
        Row: DemoSession
        Insert: DemoSessionInsert
        Update: DemoSessionUpdate
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
      feedback: {
        Row: Feedback
        Insert: FeedbackInsert
        Update: FeedbackUpdate
      }
      text_usage_daily: {
        Row: TextUsageDaily
        Insert: TextUsageDailyInsert
        Update: TextUsageDailyUpdate
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
  username: string
  auth_provider: AuthProvider
  
  // Profile
  display_name?: string | null
  avatar_url?: string | null
  interface_language: string
  current_level?: UserLevel | null
  
  // Subscription
  lessons_left: number
  package_expires_at?: string | null
  last_payment_at?: string | null
  
  // Progress
  total_lessons_completed: number
  current_streak: number
  last_lesson_date?: string | null
  
  // Onboarding
  onboarding_completed: boolean
  target_language?: string | null
  learning_goal?: string | null
  time_commitment?: string | null
  quiz_started_at?: string | null
  quiz_completed_at?: string | null
  
  // Tracking
  visitor_id?: string | null
  text_messages_total: number
  last_text_used_at?: string | null
  
  // Telegram-specific
  ai_mode?: string | null
  
  // Meta
  is_active: boolean
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
// WEB VISITOR
// ============================================

export interface WebVisitor {
  id: string
  
  // Tracking
  first_visit_at: string
  last_visit_at: string
  
  // Attribution
  utm_source?: string | null
  utm_medium?: string | null
  utm_campaign?: string | null
  utm_content?: string | null
  utm_term?: string | null
  referrer?: string | null
  
  // Device/Location
  user_agent?: string | null
  ip_address?: string | null
  country?: string | null
  city?: string | null
  
  // Session
  session_id?: string | null
  
  // Conversion
  converted_to_user_id?: string | null
  converted_at?: string | null
  
  // Metadata
  metadata?: Json
}

export type WebVisitorInsert = Omit<WebVisitor, 'id' | 'first_visit_at'> & {
  id?: string
  first_visit_at?: string
}

export type WebVisitorUpdate = Partial<WebVisitorInsert>

// ============================================
// FUNNEL ANSWER
// ============================================

export interface FunnelAnswer {
  id: string
  
  // User identification
  visitor_id?: string | null
  user_id?: string | null
  
  // Question data
  question_number: number
  question_text: string
  question_type: string
  answer_value: string
  answer_label?: string | null
  
  // Metadata
  answered_at: string
  time_spent_seconds?: number | null
  page_url?: string | null
  metadata?: Json
}

export type FunnelAnswerInsert = Omit<FunnelAnswer, 'id' | 'answered_at'> & {
  id?: string
  answered_at?: string
}

export type FunnelAnswerUpdate = Partial<FunnelAnswerInsert>

// ============================================
// EVENT
// ============================================

export interface Event {
  id: string
  
  // User identification
  visitor_id?: string | null
  user_id?: string | null
  session_id?: string | null
  
  // Event data
  event_type: EventType
  event_name?: string | null
  event_data?: Json
  
  // Context
  page_url?: string | null
  referrer?: string | null
  user_agent?: string | null
  
  // Device
  device_type?: string | null
  os?: string | null
  browser?: string | null
  
  // Timestamp
  created_at: string
}

export type EventInsert = Omit<Event, 'id' | 'created_at'> & {
  id?: string
  created_at?: string
}

export type EventUpdate = Partial<EventInsert>

// ============================================
// DEMO SESSION
// ============================================

export interface DemoSession {
  id: string
  
  // User identification
  visitor_id?: string | null
  user_id?: string | null
  
  // Configuration
  scenario_title: string
  scenario_description?: string | null
  difficulty?: 'beginner' | 'intermediate' | 'advanced' | null
  target_language?: string | null
  
  // Conversation
  transcript: Json // Array of messages
  message_count: number
  
  // Audio
  audio_url?: string | null
  audio_duration_seconds?: number | null
  
  // Feedback
  scores?: Json | null // {grammar: 8, vocabulary: 7, ...}
  feedback_text?: string | null
  feedback_generated_at?: string | null
  
  // Session tracking
  started_at: string
  ended_at?: string | null
  duration_seconds?: number | null
  end_reason?: DemoEndReason | null
  
  // Conversion
  converted_to_payment: boolean
  payment_id?: string | null
  
  // Metadata
  metadata?: Json
}

export type DemoSessionInsert = Omit<DemoSession, 'id' | 'started_at'> & {
  id?: string
  started_at?: string
}

export type DemoSessionUpdate = Partial<DemoSessionInsert>

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
  visitor_id?: string | null
  session_id?: string | null
  
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
// FEEDBACK
// ============================================

export interface Feedback {
  id: string
  user_id: string
  telegram_id?: number | null
  text: string
  created_at: string
}

export type FeedbackInsert = Omit<Feedback, 'id' | 'created_at'> & {
  id?: string
  created_at?: string
}

export type FeedbackUpdate = Partial<FeedbackInsert>

// ============================================
// TEXT USAGE DAILY
// ============================================

export interface TextUsageDaily {
  user_id: string
  day: string
  messages: number
}

export type TextUsageDailyInsert = TextUsageDaily
export type TextUsageDailyUpdate = Partial<TextUsageDaily>

// ============================================
// HELPER TYPES
// ============================================

// Message in transcript
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

// Event data types for different events
export interface VisitEventData {
  landing_page?: string
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
}

export interface QuestionAnsweredEventData {
  question_number: number
  answer: string
  time_spent_ms?: number
}

export interface DemoStartEventData {
  scenario: string
  difficulty: string
}

export interface PaymentSuccessEventData {
  product_id: string
  amount: number
  provider: string
}

// Union type for all event data
export type EventData = 
  | VisitEventData 
  | QuestionAnsweredEventData 
  | DemoStartEventData 
  | PaymentSuccessEventData 
  | Record<string, any>

