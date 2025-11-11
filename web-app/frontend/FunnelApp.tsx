import React, { useState, useCallback, useEffect } from 'react';
import Funnel from './components/funnel/Funnel';
import Paywall from './components/funnel/Paywall';
import ConversationScreen from './components/ConversationScreen';
import FeedbackView from './components/funnel/FeedbackView';
import EmailForm from './components/funnel/EmailForm';
import { AppView } from './components/funnel/funnelTypes';
import { TranscriptEntry, FinalFeedback, Scenario } from './types';
import { useNavigate, useLocation } from 'react-router-dom';
import { getOrCreateSessionId, saveDemoSession, markSessionAsConverted } from './services/anonymousSessionService';
import { supabase } from './supabaseClient';
import { useUser } from './contexts/UserContext';

// Demo scenario for funnel
const DEMO_SCENARIO: Scenario = {
  title: 'Quick Introduction',
  description: 'A simple conversation to introduce yourself and share a bit about your goals.',
  prompt: "Hi! I'm Alex, your English tutor. What's your name and what brings you here today?"
};

const FunnelApp: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useUser();
  const [view, setView] = useState<AppView>(AppView.FUNNEL);
  const [demoTranscript, setDemoTranscript] = useState<TranscriptEntry[]>([]);
  const [demoFeedback, setDemoFeedback] = useState<FinalFeedback>({ text: null, scores: null });
  const [isDemoCompleted, setIsDemoCompleted] = useState<boolean>(false);
  const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
  
  // Anonymous session ID (Supabase or local fallback)
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  // Handle magic link return (view=demo-feedback)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlView = params.get('view');
    
    if (urlView === 'demo-feedback' && currentUser) {
      console.log('🔗 Magic link return detected, loading demo feedback...');
      loadDemoFeedback();
    }
  }, [location, currentUser]);
  
  // Load demo feedback from Supabase after magic link login
  const loadDemoFeedback = async () => {
    setIsLoadingFeedback(true);
    
    try {
      const demoSessionId = localStorage.getItem('demo_session_id');
      if (!demoSessionId) {
        console.error('❌ No demo session ID found');
        setView(AppView.PAYWALL);
        setIsLoadingFeedback(false);
        return;
      }
      
      // Get anonymous session data
      const { data, error } = await supabase
        .from('anonymous_sessions')
        .select('*')
        .eq('id', demoSessionId)
        .single();
      
      if (error || !data) {
        console.error('❌ Failed to load demo session:', error);
        setView(AppView.PAYWALL);
        setIsLoadingFeedback(false);
        return;
      }
      
      console.log('✅ Demo session loaded:', data);
      
      // Mark session as converted
      if (currentUser && !data.converted_to_user_id) {
        await markSessionAsConverted(demoSessionId, currentUser.id);
      }
      
      // Reconstruct transcript and feedback
      const transcript: TranscriptEntry[] = (data.demo_transcript as any[])?.map((entry: any, index: number) => ({
        id: `demo-${index}`,
        speaker: entry.role === 'user' ? 'user' as const : 'ai' as const,
        text: entry.content,
        isFinal: true,
      })) || [];
      
      const feedback: FinalFeedback = {
        text: data.demo_feedback,
        scores: data.demo_scores as any,
      };
      
      setDemoTranscript(transcript);
      setDemoFeedback(feedback);
      setIsDemoCompleted(true);
      setView(AppView.FEEDBACK_VIEW);
      setIsLoadingFeedback(false);
      
      // Clean up
      localStorage.removeItem('demo_session_id');
    } catch (err) {
      console.error('❌ Error loading demo feedback:', err);
      setView(AppView.PAYWALL);
      setIsLoadingFeedback(false);
    }
  };
  
  // Create or retrieve anonymous session on mount
  useEffect(() => {
    const initSession = async () => {
      try {
        const id = await getOrCreateSessionId();
        setSessionId(id);
        console.log('📍 Funnel initialized with session:', id);
      } catch (error) {
        console.error('❌ Failed to initialize session:', error);
        // Fallback to local ID
        const fallbackId = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setSessionId(fallbackId);
      }
    };
    initSession();
  }, []);

  const handleFunnelComplete = useCallback(() => {
    setView(AppView.PAYWALL);
  }, []);

  const handleStartDemo = useCallback(() => {
    setView(AppView.DIALOGUE);
  }, []);
  
  const handleStartPaid = useCallback(() => {
    // In production, this would redirect to payment with email capture
    alert('Redirecting to payment gateway... (simulation)');
  }, []);

  const handleDemoEnd = useCallback(async (transcript: TranscriptEntry[], feedback: FinalFeedback) => {
    console.log('🎬 Demo ended, transcript length:', transcript.length);
    console.log('📊 Feedback:', feedback);
    setDemoTranscript(transcript);
    setDemoFeedback(feedback);
    
    // Save demo data to Supabase
    if (sessionId) {
      const isInsufficient = feedback.text === 'INSUFFICIENT_TURNS';
      const demoTranscriptForDb = transcript.map(t => ({
        role: t.speaker === 'user' ? 'user' as const : 'ai' as const,
        content: t.text,
      }));
      
      await saveDemoSession(
        sessionId,
        demoTranscriptForDb,
        isInsufficient ? null : feedback.text,
        isInsufficient ? null : feedback.scores,
        !isInsufficient
      );
    }
    
    // Check if user didn't speak enough
    if (feedback.text === 'INSUFFICIENT_TURNS') {
      console.log('⚠️ Insufficient user turns, showing retry screen');
      setView(AppView.INSUFFICIENT_DEMO);
    } else {
      setView(AppView.EMAIL_FORM);
    }
  }, [sessionId]);

  const handleEmailSubmitted = useCallback(() => {
    // Mark demo as completed and show feedback
    setIsDemoCompleted(true);
    setView(AppView.FEEDBACK_VIEW);
  }, []);
  
  const handleViewFeedback = useCallback(() => {
      setView(AppView.FEEDBACK_VIEW);
  }, []);

  const handleReturnToPaywall = useCallback(() => {
    setView(AppView.PAYWALL);
  }, []);
  
  const handleGoToMainApp = useCallback(() => {
    // Navigate to main product (user should be logged in by now)
    navigate('/');
  }, [navigate]);

  const renderContent = () => {
    // Loading demo feedback after magic link
    if (isLoadingFeedback) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-400 text-lg mb-2">Загружаем ваш фидбэк...</p>
            <p className="text-gray-500 text-sm">Это займет всего пару секунд</p>
          </div>
        </div>
      );
    }
    
    if (!sessionId) {
      return (
        <div className="min-h-screen bg-gray-900 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-gray-400">Загрузка...</p>
          </div>
        </div>
      );
    }
    
    switch (view) {
      case AppView.FUNNEL:
        return <Funnel onComplete={handleFunnelComplete} sessionId={sessionId} />;
      case AppView.PAYWALL:
        return <Paywall onStartDemo={handleStartDemo} onStartPaid={handleStartPaid} isDemoCompleted={isDemoCompleted} />;
      case AppView.DIALOGUE:
        return (
          <ConversationScreen
            scenario={DEMO_SCENARIO}
            startTime={Date.now()}
            initialTranscript={[]}
            onSaveAndExit={handleDemoEnd}
            isSaving={false}
            isDemoMode={true}
            durationMinutes={5}
            tutorAvatarUrl="/tutor-avatar.png"
          />
        );
      case AppView.EMAIL_FORM:
        const transcriptText = demoTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n');
        return <EmailForm onEmailSubmitted={handleEmailSubmitted} onBackToPaywall={handleReturnToPaywall} sessionId={sessionId} transcript={transcriptText} />;
      case AppView.FEEDBACK_VIEW:
        const feedbackTranscript = demoTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n');
        return <FeedbackView feedback={demoFeedback} transcript={feedbackTranscript} onContinue={handleReturnToPaywall} onGoToApp={handleGoToMainApp} />;
      case AppView.INSUFFICIENT_DEMO:
        return (
          <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-700">
              <div className="text-center">
                <div className="text-6xl mb-6">⏱️</div>
                <h1 className="text-3xl font-bold text-gray-100 mb-4">
                  Урок завершён слишком рано
                </h1>
                <p className="text-gray-400 mb-6 leading-relaxed">
                  К сожалению, мы не успели оценить ваши навыки — нужно минимум 3 реплики в диалоге. 
                  Попробуйте снова и поговорите чуть дольше, чтобы получить детальный фидбэк!
                </p>
                <div className="space-y-3">
                  <button
                    onClick={handleStartDemo}
                    className="w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-300 transform hover:scale-105"
                  >
                    🎯 Попробовать демо снова
                  </button>
                  <button
                    onClick={handleReturnToPaywall}
                    className="w-full bg-gray-700 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg transition-all duration-300 transform hover:scale-105"
                  >
                    💳 Купить полный доступ
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      default:
        return <Funnel onComplete={handleFunnelComplete} sessionId={sessionId} />;
    }
  };

  return (
    <main className="min-h-screen w-full bg-gray-900">
      {renderContent()}
    </main>
  );
};

export default FunnelApp;

