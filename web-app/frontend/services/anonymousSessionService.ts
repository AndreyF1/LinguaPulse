/**
 * Anonymous Session Service
 * Tracks funnel progression and demo completion for anonymous users
 */

import { supabase } from '../supabaseClient';

const STORAGE_KEY = 'anon_session_id';

interface FunnelAnswer {
  question: number;
  answer: string;
}

interface DemoTranscriptEntry {
  role: 'user' | 'ai';
  content: string;
}

interface DemoScores {
  grammar?: number;
  vocabulary?: number;
  fluency?: number;
  pronunciation?: number;
  listening?: number;
}

/**
 * Get UTM parameters from URL
 */
function getUTMParams(): Record<string, string> {
  const params = new URLSearchParams(window.location.search);
  return {
    utm_source: params.get('utm_source') || '',
    utm_medium: params.get('utm_medium') || '',
    utm_campaign: params.get('utm_campaign') || '',
    utm_content: params.get('utm_content') || '',
    utm_term: params.get('utm_term') || '',
  };
}

/**
 * Get referrer
 */
function getReferrer(): string {
  return document.referrer || '';
}

/**
 * Get user agent
 */
function getUserAgent(): string {
  return navigator.userAgent;
}

/**
 * Create a new anonymous session
 */
export async function createAnonymousSession(): Promise<string | null> {
  try {
    const utm = getUTMParams();
    const referrer = getReferrer();
    const userAgent = getUserAgent();

    const { data, error } = await supabase
      .from('anonymous_sessions')
      .insert({
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_content: utm.utm_content || null,
        utm_term: utm.utm_term || null,
        referrer: referrer || null,
        user_agent: userAgent,
        funnel_answers: [],
        funnel_completed: false,
        demo_completed: false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('❌ Failed to create anonymous session:', error);
      return null;
    }

    const sessionId = data.id;
    localStorage.setItem(STORAGE_KEY, sessionId);
    console.log('✅ Anonymous session created:', sessionId);
    return sessionId;
  } catch (err) {
    console.error('❌ Error creating anonymous session:', err);
    return null;
  }
}

/**
 * Get or create anonymous session ID
 */
export async function getOrCreateSessionId(): Promise<string> {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    console.log('📦 Using existing anonymous session:', existing);
    return existing;
  }
  
  const sessionId = await createAnonymousSession();
  if (sessionId) {
    return sessionId;
  }
  
  // Fallback: create local-only session if Supabase insert fails
  console.warn('⚠️ Failed to create Supabase session, using local fallback');
  const fallbackId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  localStorage.setItem(STORAGE_KEY, fallbackId);
  return fallbackId;
}

/**
 * Save funnel answers
 */
export async function saveFunnelAnswers(
  sessionId: string,
  answers: FunnelAnswer[],
  completed: boolean
): Promise<boolean> {
  // Skip Supabase save if using local fallback
  if (sessionId.startsWith('local_')) {
    console.warn('⚠️ Using local session, skipping Supabase save for funnel answers');
    return true;
  }
  
  try {
    const { error } = await supabase
      .from('anonymous_sessions')
      .update({
        funnel_answers: answers,
        funnel_completed: completed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) {
      console.error('❌ Failed to save funnel answers:', error);
      return false;
    }

    console.log('✅ Funnel answers saved:', { sessionId, answerCount: answers.length, completed });
    return true;
  } catch (err) {
    console.error('❌ Error saving funnel answers:', err);
    return false;
  }
}

/**
 * Save demo session data
 */
export async function saveDemoSession(
  sessionId: string,
  transcript: DemoTranscriptEntry[],
  feedback: string | null,
  scores: DemoScores | null,
  completed: boolean
): Promise<boolean> {
  // Skip Supabase save if using local fallback
  if (sessionId.startsWith('local_')) {
    console.warn('⚠️ Using local session, skipping Supabase save for demo session');
    return true;
  }
  
  try {
    const { error } = await supabase
      .from('anonymous_sessions')
      .update({
        demo_transcript: transcript,
        demo_feedback: feedback,
        demo_scores: scores,
        demo_completed: completed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) {
      console.error('❌ Failed to save demo session:', error);
      return false;
    }

    console.log('✅ Demo session saved:', { sessionId, transcriptLength: transcript.length, completed });
    return true;
  } catch (err) {
    console.error('❌ Error saving demo session:', err);
    return false;
  }
}

/**
 * Mark session as converted (when user signs up)
 */
export async function markSessionAsConverted(
  sessionId: string,
  userId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('anonymous_sessions')
      .update({
        converted_to_user_id: userId,
        converted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);

    if (error) {
      console.error('❌ Failed to mark session as converted:', error);
      return false;
    }

    console.log('✅ Session marked as converted:', { sessionId, userId });
    return true;
  } catch (err) {
    console.error('❌ Error marking session as converted:', err);
    return false;
  }
}

/**
 * Clear session ID from localStorage
 */
export function clearSessionId(): void {
  localStorage.removeItem(STORAGE_KEY);
  console.log('🗑️ Anonymous session ID cleared');
}

