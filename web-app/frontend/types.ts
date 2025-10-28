/**
 * Frontend types for LinguaPulse Web
 * 
 * This file combines:
 * - Database types from shared/types/database.ts
 * - UI-specific types for the React app
 */

// Re-export database types
export type {
  User,
  UserInsert,
  UserUpdate,
  LessonSession,
  LessonSessionInsert,
  LessonSessionUpdate,
  AnonymousSession,
  AnonymousSessionInsert,
  AnonymousSessionUpdate,
  Payment,
  PaymentInsert,
  Product,
  AuthProvider,
  Json,
  TranscriptMessage,
} from '../../shared/types/database';

import type { FeedbackScores as DBFeedbackScores } from '../../shared/types/database';

// ============================================
// UI TYPES
// ============================================

export enum ConversationStatus {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  RECONNECTING = 'RECONNECTING',
  LISTENING = 'LISTENING',
  SPEAKING = 'SPEAKING',
  GENERATING_FEEDBACK = 'GENERATING_FEEDBACK',
  ERROR = 'ERROR',
}

export interface TranscriptEntry {
  id: string;
  speaker: 'user' | 'ai';
  text: string;
  isFinal: boolean;
  translation?: string;
}

export interface Scenario {
  title: string;
  description: string;
  prompt: string;
}

// Extended feedback scores for UI (includes all fields expected in the app)
export interface FeedbackScores extends DBFeedbackScores {
  pronunciation: number;
  grammar: number;
  vocabulary: number;
  fluency: number;
  comprehension: number;
}

export interface FinalFeedback {
  text: string | null;
  scores: FeedbackScores | null;
}

// Frontend user type with populated sessions
export interface UserWithSessions extends Omit<import('../../shared/types/database').User, 'id'> {
  id: string;
  username: string;
  sessions: LessonSession[];
}

// Added for saving in-progress lessons to localStorage
export interface InProgressSessionData {
  scenario: Scenario;
  transcript: TranscriptEntry[];
  startTime: number;
}

// Type for new session data (before saving to DB)
export type NewSessionData = Omit<LessonSession, 'id' | 'created_at' | 'user_id' | 'updated_at'>;
