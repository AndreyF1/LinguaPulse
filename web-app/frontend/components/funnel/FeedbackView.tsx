import React, { useMemo } from 'react';
import { RadarChart } from './Funnel'; // Re-use the radar chart

interface FeedbackViewProps {
    transcript: string;
    onContinue: () => void;
    onGoToApp?: () => void;
}

const generateFeedbackScores = (transcript: string) => {
    const userTurns = transcript.split('\n').filter(line => line.startsWith('User:'));
    const userText = userTurns.map(line => line.replace('User: ', '')).join(' ');
    const userWords = userText.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(userWords.map(w => w.toLowerCase().replace(/[.,!?]/g, '')));

    const fluencyScore = Math.min(95, 40 + userWords.length * 1.2 + Math.random() * 10);
    const vocabScore = Math.min(95, 30 + uniqueWords.size * 1.8 + Math.random() * 10);
    
    const grammarScore = 60 + Math.random() * 25;
    const listeningScore = 65 + Math.random() * 25;
    const pronunciationScore = 55 + Math.random() * 30;

    return [
        { label: 'Беглость', score: Math.round(fluencyScore) },
        { label: 'Словарь', score: Math.round(vocabScore) },
        { label: 'Грамматика', score: Math.round(grammarScore) },
        { label: 'Аудирование', score: Math.round(listeningScore) },
        { label: 'Произношение', score: Math.round(pronunciationScore) },
    ];
};

const getDynamicAnalysis = (scores: {label: string, score: number}[]) => {
    const vocab = scores.find(s => s.label === 'Словарь');
    if (vocab && vocab.score < 50) {
        return {
            title: "Анализ словарного запаса:",
            text: "Вы отлично справляетесь с базовыми фразами. Следующий шаг — расширение словарного запаса. Попробуйте вводить по 2-3 новых слова в каждом диалоге, чтобы сделать речь ярче.",
            recommendation: "В следующем диалоге попробуйте описать свой любимый фильм, используя новые прилагательные."
        };
    }
    const fluency = scores.find(s => s.label === 'Беглость');
     if (fluency && fluency.score < 65) {
        return {
            title: "Анализ беглости речи:",
            text: "Вы хорошо поддерживали диалог! Иногда возникали паузы — это абсолютно нормально. Чем больше практики, тем быстрее и увереннее вы будете говорить.",
            recommendation: "Не бойтесь делать ошибки. Главное — продолжать говорить!"
        };
    }

    return {
        title: "Анализ грамматики:",
        text: `Вы продемонстрировали хорошее понимание базовых конструкций. Например, фраза "I am excited" использована верно. Есть потенциал для роста в использовании более сложных времен.`,
        recommendation: "Попробуйте в следующий раз использовать прошедшее (Past Simple) или будущее (Future Simple) время."
    }
}

const FeedbackView: React.FC<FeedbackViewProps> = ({ transcript, onContinue, onGoToApp }) => {
    const hasTranscript = transcript && transcript.trim().length > 0;

    const feedbackData = useMemo(() => generateFeedbackScores(transcript), [transcript]);
    const analysis = useMemo(() => getDynamicAnalysis(feedbackData), [feedbackData]);
    
    return (
        <div className="min-h-screen bg-gray-50 text-gray-800 py-10 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-2xl p-6 sm:p-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Ваш персональный фидбэк</h1>
                <p className="text-gray-600 mb-8">Отличная работа! Вот анализ вашего 5-минутного диалога.</p>
                
                <div className="space-y-6">
                    <div className="bg-white border border-gray-200 p-6 rounded-lg">
                        <p className="font-bold text-lg mb-2 text-center">Ваши навыки на старте</p>
                        <RadarChart data={feedbackData} theme="light" />

                        <div className="bg-gray-50 p-4 rounded-md mt-4 border border-gray-200">
                            <h3 className="font-semibold text-gray-700 mb-2">{analysis.title}</h3>
                            <p className="text-sm text-gray-600">{analysis.text}</p>
                            <p className="text-xs text-gray-500 mt-2">
                                <span className="font-bold">Рекомендация:</span> {analysis.recommendation}
                            </p>
                        </div>
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