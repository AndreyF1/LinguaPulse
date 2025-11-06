import React, { useState, useCallback } from 'react';
import Funnel from './components/Funnel';
import Paywall from './components/Paywall';
import Dialogue from './components/Dialogue';
import FeedbackView from './components/FeedbackView';
import EmailForm from './components/EmailForm';
import { AppView } from './types';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.FUNNEL);
  const [dialogueTranscript, setDialogueTranscript] = useState<string>('');
  const [isDemoCompleted, setIsDemoCompleted] = useState<boolean>(false);

  const handleFunnelComplete = useCallback(() => {
    setView(AppView.PAYWALL);
  }, []);

  const handleStartDemo = useCallback(() => {
    setView(AppView.DIALOGUE);
  }, []);
  
  const handleStartPaid = useCallback(() => {
    alert('Redirecting to payment gateway... (simulation)');
  }, []);

  const handleDialogueEnd = useCallback((transcript: string) => {
    setDialogueTranscript(transcript);
    setView(AppView.EMAIL_FORM);
  }, []);

  const handleEmailSubmitted = useCallback(() => {
    // In a real app, this would happen after an email link is clicked.
    // For the demo, we show a button to navigate there.
    setView(AppView.FEEDBACK_SENT);
    setIsDemoCompleted(true); // Mark demo as completed
  }, []);
  
  const handleViewFeedback = useCallback(() => {
      setView(AppView.FEEDBACK_VIEW);
  }, []);

  const handleReturnToPaywall = useCallback(() => {
    setView(AppView.PAYWALL);
  }, []);

  const renderContent = () => {
    switch (view) {
      case AppView.FUNNEL:
        return <Funnel onComplete={handleFunnelComplete} />;
      case AppView.PAYWALL:
        return <Paywall onStartDemo={handleStartDemo} onStartPaid={handleStartPaid} isDemoCompleted={isDemoCompleted} />;
      case AppView.DIALOGUE:
        return <Dialogue onDialogueEnd={handleDialogueEnd} />;
      case AppView.EMAIL_FORM:
        return <EmailForm onEmailSubmitted={handleEmailSubmitted} />;
      case AppView.FEEDBACK_SENT:
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 p-4 text-center">
                <div className="bg-slate-800 p-8 rounded-2xl shadow-lg max-w-md w-full border border-slate-700">
                    <h2 className="text-2xl font-bold text-slate-100 mb-4">Отлично! Фидбэк отправлен.</h2>
                    <p className="text-slate-400 mb-6">Мы отправили детальный разбор вашего диалога на указанный email. Проверьте почту!</p>
                    <button
                        onClick={handleViewFeedback}
                        className="w-full bg-violet-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-violet-500 transition-all duration-300"
                    >
                        Посмотреть фидбэк сейчас
                    </button>
                </div>
            </div>
        );
      case AppView.FEEDBACK_VIEW:
        return <FeedbackView transcript={dialogueTranscript} onContinue={handleReturnToPaywall} />;
      default:
        return <Funnel onComplete={handleFunnelComplete} />;
    }
  };

  return (
    <main className="min-h-screen w-full">
      {renderContent()}
    </main>
  );
};

export default App;