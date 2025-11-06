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
    setView(AppView.EMAIL_FORM);
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
          />
        );
      case AppView.EMAIL_FORM:
        const transcriptText = demoTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n');
        return <EmailForm onEmailSubmitted={handleEmailSubmitted} anonymUserId={anonymUserId} transcript={transcriptText} />;
      case AppView.FEEDBACK_VIEW:
        const feedbackTranscript = demoTranscript.map(t => `${t.speaker}: ${t.text}`).join('\n');
        return <FeedbackView transcript={feedbackTranscript} onContinue={handleReturnToPaywall} onGoToApp={handleGoToMainApp} />;
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

