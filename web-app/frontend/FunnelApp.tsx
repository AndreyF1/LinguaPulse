import React, { useState, useCallback } from 'react';
import Funnel from './components/funnel/Funnel';
import Paywall from './components/funnel/Paywall';
import Dialogue from './components/funnel/Dialogue';
import FeedbackView from './components/funnel/FeedbackView';
import EmailForm from './components/funnel/EmailForm';
import { AppView } from './components/funnel/funnelTypes';
import { useNavigate } from 'react-router-dom';

const FunnelApp: React.FC = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<AppView>(AppView.FUNNEL);
  const [dialogueTranscript, setDialogueTranscript] = useState<string>('');
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

  const handleDialogueEnd = useCallback((transcript: string) => {
    setDialogueTranscript(transcript);
    setView(AppView.EMAIL_FORM);
  }, []);

  const handleEmailSubmitted = useCallback(() => {
    // Mark demo as completed
    setView(AppView.FEEDBACK_SENT);
    setIsDemoCompleted(true);
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
        return <Dialogue onDialogueEnd={handleDialogueEnd} anonymUserId={anonymUserId} />;
      case AppView.EMAIL_FORM:
        return <EmailForm onEmailSubmitted={handleEmailSubmitted} anonymUserId={anonymUserId} transcript={dialogueTranscript} />;
      case AppView.FEEDBACK_SENT:
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4 text-center">
                <div className="bg-gray-800 p-8 rounded-2xl shadow-lg max-w-md w-full border border-gray-700">
                    <h2 className="text-2xl font-bold text-gray-100 mb-4">Отлично! Фидбэк отправлен.</h2>
                    <p className="text-gray-400 mb-6">Мы отправили детальный разбор вашего диалога на указанный email. Проверьте почту!</p>
                    <button
                        onClick={handleViewFeedback}
                        className="w-full bg-cyan-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-500 transition-all duration-300"
                    >
                        Посмотреть фидбэк сейчас
                    </button>
                </div>
            </div>
        );
      case AppView.FEEDBACK_VIEW:
        return <FeedbackView transcript={dialogueTranscript} onContinue={handleReturnToPaywall} onGoToApp={handleGoToMainApp} />;
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

