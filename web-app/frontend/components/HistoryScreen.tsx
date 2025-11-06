
import React, { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { useUser } from '../contexts/UserContext';
import { LessonSession, FeedbackScores } from '../types';
import { StarIcon } from './Icons';

const MONTHLY_REPORT_PROMPT_TEMPLATE = `
You are an AI English teaching assistant. Your user is a native Russian speaker.
Analyze the provided session feedback data from the past month and generate a progress report.

**CRITICAL INSTRUCTIONS:**
1.  **The entire response MUST be in Russian.**
2.  The report should be encouraging and constructive.
3.  Structure the report in Markdown with the following sections:
    *   **Общий прогресс (Overall Progress)**: Summarize the user's progress this month. Mention trends in their overall scores.
    *   **Сильные стороны (Strengths)**: Identify areas where the user consistently performs well (e.g., improved fluency, good vocabulary in certain topics).
    *   **Области для улучшения (Areas for Improvement)**: Based on recurring feedback, point out 1-2 key areas to focus on (e.g., specific grammar rules like articles, common pronunciation mistakes).
    *   **Рекомендации (Recommendations)**: Provide specific, actionable tips for the next month based on the "Areas for Improvement".

**FEEDBACK DATA (JSON):**
---
{feedbackData}
---

Remember: The entire report must be in Russian, follow the specified Markdown structure, and be encouraging.
`;

const HistoryScreen: React.FC = () => {
    const { currentUser } = useUser();
    const [selectedSession, setSelectedSession] = useState<LessonSession | null>(null);
    const [monthlyReport, setMonthlyReport] = useState<string | null>(null);
    const [isReportLoading, setIsReportLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sessions = currentUser?.sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()) || [];

    const generateMonthlyReport = async () => {
        setIsReportLoading(true);
        setError(null);
        setMonthlyReport(null);
    
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
        const recentSessions = sessions.filter(s => new Date(s.created_at) > oneMonthAgo && s.scores);
    
        if (recentSessions.length < 1) {
            setError("Недостаточно данных за последний месяц для создания отчета.");
            setIsReportLoading(false);
            return;
        }
    
        const feedbackData = recentSessions.map(s => ({
            date: new Date(s.created_at).toISOString().split('T')[0],
            scenario: s.scenario_title,
            scores: s.scores,
            feedback_text: s.feedback_text,
        }));
    
        try {
            const ai = new GoogleGenAI({ 
                apiKey: import.meta.env.VITE_GEMINI_API_KEY || '' 
            });
            const prompt = MONTHLY_REPORT_PROMPT_TEMPLATE.replace('{feedbackData}', JSON.stringify(feedbackData, null, 2));
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            setMonthlyReport(response.text);
        } catch (err) {
            console.error("Error generating monthly report:", err);
            setError("Произошла ошибка при создании отчета. Пожалуйста, попробуйте еще раз.");
        } finally {
            setIsReportLoading(false);
        }
    };
    

    const renderMarkdown = (text: string) => {
        const html = text
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-cyan-400">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/(\n)/g, '<br />');
        return <div className="text-gray-300 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
    };
    
    const ScoreDisplay = ({ label, score }: { label: string; score: number }) => (
        <div>
            <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium text-gray-300">{label}</span>
                <span className="text-sm font-bold text-white">{score}<span className="text-xs text-gray-400">/100</span></span>
            </div>
            <div className="w-full bg-gray-600 rounded-full h-2.5">
                <div className="bg-cyan-500 h-2.5 rounded-full" style={{ width: `${score}%` }}></div>
            </div>
        </div>
    );
    
    const getOverallScore = (session: LessonSession) => {
        if (!session.scores) return 0;
        
        // Safe type casting: JSONB scores to FeedbackScores
        const scores = session.scores as unknown as FeedbackScores;
        
        // Validate that all required fields exist
        const { pronunciation = 0, grammar = 0, vocabulary = 0, fluency = 0, comprehension = 0 } = scores;
        return Math.round((pronunciation + grammar + vocabulary + fluency + comprehension) / 5);
    }

    return (
        <div className="p-4 md:p-8">
            {selectedSession && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setSelectedSession(null)}>
                    <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl border border-gray-700 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <h2 className="text-2xl font-bold text-cyan-400 mb-4 text-center">Результаты урока: {selectedSession.scenario_title}</h2>
                        <div className="overflow-y-auto pr-2">
                           {selectedSession.scores && (() => {
                                const scores = selectedSession.scores as unknown as FeedbackScores;
                                return (
                                    <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                                        <div className="text-center mb-4">
                                            <p className="text-gray-400 text-sm">Общий балл</p>
                                            <p className="text-5xl font-bold text-cyan-400">{getOverallScore(selectedSession)}</p>
                                        </div>
                                        <div className="space-y-4">
                                            <ScoreDisplay label="Произношение" score={scores.pronunciation || 0} />
                                            <ScoreDisplay label="Грамматика" score={scores.grammar || 0} />
                                            <ScoreDisplay label="Словарный запас" score={scores.vocabulary || 0} />
                                            <ScoreDisplay label="Беглость речи" score={scores.fluency || 0} />
                                            <ScoreDisplay label="Понимание" score={scores.comprehension || 0} />
                                        </div>
                                    </div>
                                );
                            })()}
                            {selectedSession.feedback_text ? renderMarkdown(selectedSession.feedback_text) : <p>Отзыв не найден.</p>}
                        </div>
                        <button onClick={() => setSelectedSession(null)} className="mt-6 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200 w-full">
                            Закрыть
                        </button>
                    </div>
                </div>
            )}
             {monthlyReport && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setMonthlyReport(null)}>
                    <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl border border-gray-700 max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <h2 className="text-2xl font-bold text-cyan-400 mb-4 text-center">Отчет за месяц</h2>
                        <div className="overflow-y-auto pr-2">
                            {renderMarkdown(monthlyReport)}
                        </div>
                        <button onClick={() => setMonthlyReport(null)} className="mt-6 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200 w-full">
                            Закрыть
                        </button>
                    </div>
                </div>
            )}
            <div className="max-w-5xl mx-auto">
                <div className="flex justify-between items-center mb-8">
                    <div>
                        <h2 className="text-3xl font-bold text-white">История уроков</h2>
                        <p className="text-gray-400">Просмотрите свои прошлые сессии и отслеживайте прогресс.</p>
                    </div>
                    <button onClick={generateMonthlyReport} disabled={isReportLoading} className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200 disabled:bg-indigo-800 disabled:cursor-not-allowed">
                        {isReportLoading ? "Создание отчета..." : "Отчет за месяц"}
                    </button>
                </div>
                {error && <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg mb-4">{error}</div>}

                {sessions.length === 0 ? (
                    <div className="text-center py-16 bg-gray-800 rounded-lg border border-gray-700">
                        <p className="text-gray-400">Вы еще не прошли ни одного урока.</p>
                        <p className="text-gray-500 mt-2">Пройдите практику, и ваша история появится здесь.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {sessions.map(session => (
                            <button key={session.id} onClick={() => setSelectedSession(session)} className="w-full bg-gray-800 p-4 rounded-lg border border-gray-700 text-left hover:bg-gray-700 transition-colors flex justify-between items-center">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">{session.scenario_title}</h3>
                                    <p className="text-sm text-gray-400">{new Date(session.created_at).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
                                </div>
                                <div className="flex items-center gap-2 text-xl font-bold text-cyan-400">
                                    <StarIcon className="w-5 h-5 text-yellow-400" />
                                    <span>{getOverallScore(session)}</span>
                                    <span className="text-sm font-normal text-gray-500">/100</span>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default HistoryScreen;