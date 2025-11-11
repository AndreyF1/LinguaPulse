import React, { useState, useCallback, useEffect } from 'react';
import { useUser } from './contexts/UserContext';
import { Scenario, LessonSession, TranscriptEntry, FinalFeedback, InProgressSessionData, NewSessionData } from './types';
import LoginScreen from './components/LoginScreen';
import ScenarioSelectionScreen from './components/ScenarioSelectionScreen';
import ConversationScreen from './components/ConversationScreen';
import HistoryScreen from './components/HistoryScreen';
import { HistoryIcon, LogoutIcon } from './components/Icons';
import { markSessionAsConverted } from './services/anonymousSessionService';
import { useLocation } from 'react-router-dom';

const scenarios: Scenario[] = [
    { title: 'Ordering Coffee', description: 'Practice ordering a drink at a coffee shop.', prompt: "Hello! Welcome to our coffee shop. What can I get for you today?" },
    { title: 'Introducing Yourself', description: 'Learn how to introduce yourself and ask about others.', prompt: "Hi there! My name is Alex. It's nice to meet you. What's your name?" },
    { title: 'Asking for Directions', description: 'Practice asking for and understanding simple directions.', prompt: "Excuse me, I'm a little lost. Can you help me find the nearest train station?" },
    { title: 'At the Supermarket', description: 'A simple conversation about buying groceries.', prompt: "Hi, can you tell me where I can find the apples?" },
    { title: 'Making Plans', description: 'Practice making simple plans with a friend.', prompt: "Hey! It's great to see you. Are you free this weekend? Maybe we could see a movie." },
];

type View = 'scenarios' | 'history' | 'conversation';
const IN_PROGRESS_SESSION_KEY = 'in-progress-session';

const App: React.FC = () => {
    const location = useLocation();
    const { currentUser, logout, addSessionToCurrentUser, loading } = useUser();
    const [currentView, setCurrentView] = useState<View>('scenarios');
    const [inProgressSession, setInProgressSession] = useState<InProgressSessionData | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showDemoWelcome, setShowDemoWelcome] = useState(false);

    // Handle demo feedback after magic link (link anonymous session to user)
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const urlView = params.get('view');
        
        if (urlView === 'demo-feedback' && currentUser) {
            console.log('🔗 Magic link: linking demo session to user...');
            const demoSessionId = localStorage.getItem('demo_session_id');
            
            if (demoSessionId) {
                markSessionAsConverted(demoSessionId, currentUser.id).then(() => {
                    console.log('✅ Demo session linked to user');
                    localStorage.removeItem('demo_session_id');
                });
            }
            
            setShowDemoWelcome(true);
            
            // Clean URL
            window.history.replaceState({}, '', '/');
        }
    }, [location, currentUser]);

    // Effect to load a saved session from localStorage when the app loads and a user is logged in.
    useEffect(() => {
        if (currentUser) {
            try {
                const savedSession = localStorage.getItem(IN_PROGRESS_SESSION_KEY);
                if (savedSession) {
                    const parsedSession: InProgressSessionData = JSON.parse(savedSession);
                    // Check if session is older than a few hours to avoid stale data
                    if (Date.now() - parsedSession.startTime < 6 * 60 * 60 * 1000) { // 6 hours
                        setInProgressSession(parsedSession);
                        setCurrentView('conversation');
                    } else {
                        localStorage.removeItem(IN_PROGRESS_SESSION_KEY);
                    }
                }
            } catch (error) {
                console.error("Failed to load in-progress session:", error);
                localStorage.removeItem(IN_PROGRESS_SESSION_KEY);
            }
        }
    }, [currentUser]);

    const handleStartConversation = useCallback((scenario: Scenario) => {
        const newSessionData: InProgressSessionData = {
            scenario,
            transcript: [],
            startTime: Date.now(),
        };
        setInProgressSession(newSessionData);
        setCurrentView('conversation');
    }, []);

    const handleSaveAndExit = useCallback(async (transcript: TranscriptEntry[], finalFeedback: FinalFeedback) => {
        if (!inProgressSession || !currentUser || isSaving) {
            console.log('💾 Save blocked:', { hasSession: !!inProgressSession, hasUser: !!currentUser, isSaving });
            return;
        }
        
        console.log('💾 Starting save...');
        setIsSaving(true);
        const newSession: NewSessionData = {
            scenario_title: inProgressSession.scenario.title,
            difficulty: 'intermediate', // TODO: Make this dynamic based on user level
            transcript: transcript as any, // JSONB
            scores: finalFeedback.scores as any, // JSONB
            feedback_text: finalFeedback.text,
        };
        
        console.log('📦 Session data prepared:', {
            title: newSession.scenario_title,
            transcriptLength: transcript.length,
            hasScores: !!finalFeedback.scores,
            hasFeedback: !!finalFeedback.text
        });
        
        try {
            console.log('📤 Calling addSessionToCurrentUser...');
            await addSessionToCurrentUser(newSession);
            console.log('✅ Session saved successfully!');
            // Clean up ONLY on successful save
            localStorage.removeItem(IN_PROGRESS_SESSION_KEY);
            setInProgressSession(null);
            setCurrentView('scenarios');
        } catch (error: any) {
            console.error("❌ Failed to save session:", error);
            console.error("Error details:", { name: error.name, message: error.message, stack: error.stack });
            alert(`Failed to save session. Please try again.\n\nError: ${error.message}`);
        } finally {
            console.log('💾 Save completed (success or failure)');
            setIsSaving(false);
        }

    }, [inProgressSession, addSessionToCurrentUser, currentUser, isSaving]);

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-white space-y-4">
                <div className="flex flex-col items-center space-y-2">
                    <div className="w-12 h-12 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin"></div>
                    <p>Loading session...</p>
                </div>
                {/* Safety valve: if stuck, user can clear cache */}
                <button 
                    onClick={() => {
                        localStorage.clear();
                        window.location.reload();
                    }}
                    className="text-xs text-gray-500 hover:text-gray-300 transition-colors mt-8"
                >
                    Stuck? Clear cache and reload
                </button>
            </div>
        );
    }
    
    if (!currentUser) {
        return <LoginScreen />;
    }

    const renderView = () => {
        switch (currentView) {
            case 'conversation':
                if (inProgressSession) {
                    return (
                        <ConversationScreen
                            key={inProgressSession.startTime} // Re-mount component to reset state on new session
                            scenario={inProgressSession.scenario}
                            startTime={inProgressSession.startTime}
                            initialTranscript={inProgressSession.transcript}
                            onSaveAndExit={handleSaveAndExit}
                            isSaving={isSaving}
                        />
                    );
                }
                // Fallback to scenarios if something is wrong
                setCurrentView('scenarios');
                return null;
            case 'history':
                return <HistoryScreen />;
            case 'scenarios':
            default:
                return <ScenarioSelectionScreen scenarios={scenarios} onSelectScenario={handleStartConversation} />;
        }
    };

    return (
        <div className="flex flex-col h-screen bg-gray-900 text-gray-100 font-sans">
            {/* Demo Welcome Modal */}
            {showDemoWelcome && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
                    <div className="bg-gray-800 rounded-lg shadow-2xl max-w-md w-full p-8 border border-cyan-600">
                        <h2 className="text-2xl font-bold text-cyan-400 mb-4">🎉 Добро пожаловать!</h2>
                        <p className="text-gray-300 mb-6">
                            Спасибо за регистрацию! Ваш отчет по демо-уроку сохранен.
                        </p>
                        <p className="text-gray-300 mb-6">
                            Теперь вы можете купить подписку и практиковать английский с AI без ограничений!
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowDemoWelcome(false);
                                    // TODO: Redirect to payment/subscription page
                                    alert('Страница оплаты в разработке');
                                }}
                                className="flex-1 px-6 py-3 bg-cyan-600 hover:bg-cyan-700 text-white font-semibold rounded-lg transition-colors"
                            >
                                Купить подписку
                            </button>
                            <button
                                onClick={() => setShowDemoWelcome(false)}
                                className="px-6 py-3 border border-gray-600 hover:border-cyan-600 text-gray-300 hover:text-cyan-400 font-semibold rounded-lg transition-colors"
                            >
                                Позже
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <header className="flex items-center justify-between p-4 border-b border-gray-700 bg-gray-800/50 backdrop-blur-sm sticky top-0 z-10">
                <h1 className="text-2xl font-bold text-cyan-400">LinguaPulse</h1>
                <nav className="flex items-center space-x-4">
                    <span className="text-gray-300">Welcome, {currentUser.username}!</span>
                    <button
                        onClick={() => setCurrentView('scenarios')}
                        disabled={currentView === 'conversation'}
                        className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${currentView === 'scenarios' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700'} disabled:opacity-50`}
                    >
                        Practice
                    </button>
                    <button
                        onClick={() => setCurrentView('history')}
                        disabled={currentView === 'conversation'}
                        className={`px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2 ${currentView === 'history' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-gray-700'} disabled:opacity-50`}
                    >
                        <HistoryIcon className="w-5 h-5" /> History
                    </button>
                    <button onClick={logout} className="p-2 rounded-full hover:bg-gray-700 transition-colors" aria-label="Logout">
                        <LogoutIcon className="w-6 h-6" />
                    </button>
                </nav>
            </header>
            <main className="flex-1 overflow-y-auto">
                {renderView()}
            </main>
        </div>
    );
};

export default App;