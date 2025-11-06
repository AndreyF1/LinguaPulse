import React from 'react';
import { RadarChart } from './Funnel';
import { FinalFeedback } from '../../types';

interface FeedbackViewProps {
    feedback: FinalFeedback;
    transcript: string;
    onContinue: () => void;
    onGoToApp?: () => void;
}

const FeedbackView: React.FC<FeedbackViewProps> = ({ feedback, transcript, onContinue, onGoToApp }) => {
    const hasTranscript = transcript && transcript.trim().length > 0;
    
    // Prepare radar data from AI-generated scores
    const radarData = feedback.scores ? [
        { label: 'Речь', score: feedback.scores.pronunciation },
        { label: 'Словарь', score: feedback.scores.vocabulary },
        { label: 'Грамматика', score: feedback.scores.grammar },
        { label: 'Слух', score: feedback.scores.comprehension },
        { label: 'Беглость', score: feedback.scores.fluency },
    ] : [];
    
    const overallScore = feedback.scores 
        ? Math.round((feedback.scores.pronunciation + feedback.scores.grammar + feedback.scores.vocabulary + feedback.scores.fluency + feedback.scores.comprehension) / 5)
        : 0;
    
    // Render markdown-style feedback text
    const renderFeedbackText = (text: string | null) => {
        if (!text) return <p className="text-gray-600">Загрузка отзыва...</p>;
        
        const html = text
            .replace(/### (.*?)(\n|$)/g, '<h3 class="text-xl font-bold text-cyan-700 mt-4 mb-2">$1</h3>')
            .replace(/## (.*?)(\n|$)/g, '<h2 class="text-2xl font-bold text-cyan-700 mt-5 mb-3">$1</h2>')
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-cyan-600">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/(\n)/g, '<br />');
        return <div className="text-gray-700 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
    };
    
    return (
        <div className="min-h-screen bg-gray-50 text-gray-800 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Ваш персональный фидбэк</h1>
                <p className="text-gray-600 mb-8">Отличная работа! Вот анализ вашего 5-минутного диалога.</p>
                
                <div className="space-y-6">
                    {feedback.scores && (
                        <div className="bg-white border border-gray-200 p-6 rounded-lg">
                            <div className="text-center mb-4">
                                <p className="text-gray-600 text-sm mb-1">Общий балл</p>
                                <p className="text-5xl font-bold text-cyan-600">{overallScore}</p>
                            </div>
                            <div className="flex justify-center">
                                <RadarChart data={radarData} theme="light" />
                            </div>
                            <p className="text-xs text-gray-500 text-center mt-3 italic">
                                💡 Слух = Понимание, Речь = Произношение
                            </p>
                        </div>
                    )}
                    
                    <div className="bg-white border border-gray-200 p-6 rounded-lg">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4">Персональный отзыв</h2>
                        {renderFeedbackText(feedback.text)}
                    </div>

                    {hasTranscript && (
                        <div className="bg-gray-50 border border-gray-200 p-5 rounded-lg">
                            <h2 className="text-xl font-semibold text-gray-800 mb-3">Транскрипт диалога</h2>
                            <pre className="bg-white p-3 rounded-md text-sm text-gray-700 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto border border-gray-200">
                                {transcript}
                            </pre>
                        </div>
                    )}

                    <div className="bg-cyan-50 border border-cyan-200 p-5 rounded-lg text-center">
                        <h2 className="text-xl font-semibold text-cyan-800 mb-3">Готовы к большему?</h2>
                        <p className="text-cyan-700 mb-5">Полная подписка откроет доступ к ежедневным диалогам, детальным отчетам и трекингу прогресса.</p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button
                                onClick={onContinue}
                                className="bg-cyan-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 transition-all duration-300 transform hover:scale-105"
                            >
                                Вернуться к paywall
                            </button>
                            {onGoToApp && (
                                <button
                                    onClick={onGoToApp}
                                    className="bg-gray-600 text-white font-bold py-3 px-8 rounded-lg shadow-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 transition-all duration-300 transform hover:scale-105"
                                >
                                    Войти в приложение
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FeedbackView;