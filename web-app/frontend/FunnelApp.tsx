import React, { useState, useCallback } from 'react';
import Funnel from './components/funnel/Funnel';
import Paywall from './components/funnel/Paywall';
import ConversationScreen from './components/ConversationScreen';
import FeedbackView from './components/funnel/FeedbackView';
import EmailForm from './components/funnel/EmailForm';
import { AppView } from './components/funnel/funnelTypes';
import { TranscriptEntry, FinalFeedback, Scenario } from './types';
import { useNavigate } from 'react-router-dom';

// Demo scenario for funnel
const DEMO_SCENARIO: Scenario = {
  title: 'Quick Introduction',
  description: 'A simple conversation to introduce yourself and share a bit about your goals.',
  prompt: "Hi! I'm Alex, your English tutor. What's your name and what brings you here today?"
};

const FunnelApp: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<AppView>(AppView.FUNNEL);
  const [demoTranscript, setDemoTranscript] = useState<TranscriptEntry[]>([]);
  const [demoFeedback, setDemoFeedback] = useState<FinalFeedback>({ text: null, scores: null });
  const [isDemoCompleted, setIsDemoCompleted] = useState<boolean>(false);
  
  // Anonymous user ID (created on first funnel interaction)
  const [anonymUserId] = useState<string>(() => {
    const existing = localStorage.getItem('anonym_user_id');
    if (existing) return existing;
    const newId = `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('anonym_user_id', newId);
    return newId;
  });

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

  const handleDemoEnd = useCallback((transcript: TranscriptEntry[], feedback: FinalFeedback) => {
    console.log('🎬 Demo ended, transcript length:', transcript.length);
    console.log('📊 Feedback:', feedback);
    setDemoTranscript(transcript);
    setDemoFeedback(feedback);
    
    // Check if user didn't speak enough
    if (feedback.text === 'INSUFFICIENT_TURNS') {
      console.log('⚠️ Insufficient user turns, showing retry screen');
      setView(AppView.INSUFFICIENT_DEMO);
    } else {
      setView(AppView.EMAIL_FORM);
    }
  }, []);

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
    switch (view) {
      case AppView.FUNNEL:
        return <Funnel onComplete={handleFunnelComplete} anonymUserId={anonymUserId} />;
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
            tutorAvatarUrl="https://api.dicebear.com/7.x/bottts/svg?seed=linguapulse&backgroundColor=0ea5e9"
          />
        );
      case AppView.EMAIL_FORM:
        const transcriptText = demoTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n');
        return <EmailForm onEmailSubmitted={handleEmailSubmitted} anonymUserId={anonymUserId} transcript={transcriptText} />;
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
        return <Funnel onComplete={handleFunnelComplete} anonymUserId={anonymUserId} />;
    }
  };

  return (
    <main className="min-h-screen w-full bg-gray-900">
      {renderContent()}
    </main>
  );
};

export default FunnelApp;

