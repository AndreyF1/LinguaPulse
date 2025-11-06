import React, { useState, useCallback, useMemo, useRef } from 'react';
import ProgressBar from './ProgressBar';
import { QUESTIONS, HOOKS } from './constants';
import type { Answers, Question, Hook } from './funnelTypes';
import { HookType } from './funnelTypes';
import { ChevronLeftIcon, ChevronRightIcon, MicrophoneIcon, StopIcon, SpinnerIcon, CheckCircleIcon } from './IconComponents';
import { GoogleGenAI, Modality } from '@google/genai';
import { decode, decodeAudioData } from '../../services/audioService';

// Avatar will be loaded from /public

// Pre-defined AI responses for demo hook
const AI_RESPONSES = {
    response1: {
        text: "That's great to hear! How are you doing today?",
        staticFile: '/demo-response1.mp3', // Pre-generated audio (instant load)
        cacheKey: 'demo_audio_response1'
    },
    response2: {
        text: "I'm so glad to hear that! It was a pleasure to meet you. I hope to see you in our lessons where I can help you become a true pro in English.",
        staticFile: '/demo-response2.mp3', // Pre-generated audio (instant load)
        cacheKey: 'demo_audio_response2'
    }
};

const HookMicroDemo: React.FC = () => {
    type DemoStep = 'prompt_user1' | 'responding_ai1' | 'prompt_user2' | 'responding_ai2' | 'done';
    type RecordingStatus = 'idle' | 'recording';

    const [demoStep, setDemoStep] = useState<DemoStep>('prompt_user1');
    const [recordingStatus, setRecordingStatus] = useState<RecordingStatus>('idle');
    const [error, setError] = useState<string>('');
    const [aiSpeechText, setAiSpeechText] = useState<string | null>(null);
    const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);

    const audioContextRef = useRef<AudioContext | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const audioCacheRef = useRef<{ [key: string]: string }>({});

    const playAudio = useCallback(async (audioData: string, isUrl: boolean = false) => {
        return new Promise<void>((resolve, reject) => {
            if (isUrl) {
                // Play MP3 directly from URL
                const audio = new Audio(audioData);
                audio.onended = () => resolve();
                audio.onerror = (e) => reject(e);
                audio.play().catch(reject);
            } else {
                // Decode base64 audio (fallback for generated audio)
                try {
                    if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
                        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                    }
                    const audioCtx = audioContextRef.current;
                    decodeAudioData(decode(audioData), audioCtx, 24000, 1).then(audioBuffer => {
                        const source = audioCtx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(audioCtx.destination);
                        source.onended = () => resolve();
                        source.start();
                    }).catch(reject);
                } catch (e) {
                    reject(e);
                }
            }
        });
    }, []);

    // Get audio: try static file first (instant), then generate
    const getAiAudioResponse = useCallback(async (text: string, cacheKey: string, staticFile?: string): Promise<{ data: string, isUrl: boolean }> => {
        // Check memory cache first
        if (audioCacheRef.current[cacheKey]) {
            console.log('📦 Using memory cached audio for:', cacheKey);
            return { data: audioCacheRef.current[cacheKey], isUrl: false };
        }

        // Try loading pre-generated static file (BEST for new users)
        if (staticFile) {
            try {
                console.log('📥 Checking pre-generated audio:', staticFile);
                const response = await fetch(staticFile, { method: 'HEAD' });
                if (response.ok) {
                    console.log('✅ Using static audio file:', staticFile);
                    // For MP3, return URL directly (no need to load content)
                    return { data: staticFile, isUrl: true };
                }
            } catch (e) {
                console.warn('⚠️ Static file not found, will generate:', staticFile);
            }
        }

        // Fallback: generate new audio (slow, for development only)
        console.log('🎤 Generating audio (fallback):', cacheKey);
        const apiKey = import.meta.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("API Key not found. Please set GEMINI_API_KEY.");
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash-preview-tts",
            contents: [{ parts: [{ text: text }] }],
            config: {
                responseModalities: [Modality.AUDIO],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } } },
        });
        const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (!base64Audio) throw new Error("No audio data received from API.");
        
        // Cache it
        audioCacheRef.current[cacheKey] = base64Audio;
        return { data: base64Audio, isUrl: false };
    }, []);

    const stopRecording = useCallback(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        setRecordingStatus('idle');
    }, []);

    const startRecording = useCallback(async () => {
        try {
            streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(streamRef.current);
            mediaRecorderRef.current.start();
            setRecordingStatus('recording');
        } catch (err) {
            console.error("Microphone access denied:", err);
            setError("Не удалось получить доступ к микрофону. Проверьте разрешения.");
            setRecordingStatus('idle');
        }
    }, []);

    const handleInteraction = useCallback(async () => {
        setError('');
        
        if (recordingStatus === 'recording') {
            stopRecording();
            if (demoStep === 'prompt_user1') {
                setDemoStep('responding_ai1');
                setIsLoadingAudio(true);
                const response = AI_RESPONSES.response1;
                setAiSpeechText(response.text);
                try {
                    const { data, isUrl } = await getAiAudioResponse(response.text, response.cacheKey, response.staticFile);
                    setIsLoadingAudio(false);
                    await playAudio(data, isUrl);
                    setDemoStep('prompt_user2');
                } catch (e) {
                    console.error(e);
                    setError('Не удалось получить ответ. Попробуйте снова.');
                    setDemoStep('prompt_user1');
                    setIsLoadingAudio(false);
                } finally {
                    setAiSpeechText(null);
                }
            } else if (demoStep === 'prompt_user2') {
                setDemoStep('responding_ai2');
                setIsLoadingAudio(true);
                const response = AI_RESPONSES.response2;
                setAiSpeechText(response.text);
                try {
                    const { data, isUrl } = await getAiAudioResponse(response.text, response.cacheKey, response.staticFile);
                    setIsLoadingAudio(false);
                    await playAudio(data, isUrl);
                    setDemoStep('done');
                } catch (e) {
                    console.error(e);
                    setError('Не удалось получить ответ. Попробуйте снова.');
                    setDemoStep('prompt_user1');
                    setIsLoadingAudio(false);
                } finally {
                    setAiSpeechText(null);
                }
            }
        } else if (recordingStatus === 'idle') {
            await startRecording();
        }
    }, [recordingStatus, demoStep, stopRecording, startRecording, getAiAudioResponse, playAudio]);
    
    const isResponding = demoStep === 'responding_ai1' || demoStep === 'responding_ai2';

    const getDisplayContent = () => {
        if (isLoadingAudio) {
            return (
                <div className="flex flex-col items-center text-center gap-2 animate-fade-in">
                    <SpinnerIcon className="w-8 h-8 text-cyan-400" />
                    <p className="text-gray-300 text-sm">Подготавливаю ответ...</p>
                </div>
            );
        }
        if (aiSpeechText) {
            return (
                <div className="bg-gray-800 text-sm text-gray-200 p-3 rounded-lg shadow-md relative animate-fade-in w-full max-w-sm mx-auto">
                    <p>{aiSpeechText}</p>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-8 border-l-transparent border-r-8 border-r-transparent border-b-8 border-b-gray-800"></div>
                </div>
            );
        }
        if (demoStep === 'done') {
            return (
                <div className="flex flex-col items-center text-center gap-2 animate-fade-in">
                    <CheckCircleIcon className="w-12 h-12 text-green-400" />
                    <p className="text-gray-200 font-medium text-lg">Отлично! Демо завершено.</p>
                    <p className="text-gray-400 text-sm">Нажмите «Продолжить», чтобы двигаться дальше.</p>
                </div>
            );
        }

        const promptText = (demoStep === 'prompt_user1')
            ? `"I want to improve my English"`
            : `"I'm doing well, thanks for asking!"`;

        return (
            <>
                <p className="font-bold text-lg mb-2">Попробуйте сказать</p>
                <p className="bg-gray-900/70 font-mono text-cyan-300 p-3 rounded-md text-lg transition-opacity duration-500 w-full max-w-sm mx-auto">
                    {promptText}
                </p>
            </>
        );
    };

    let buttonContent: React.ReactNode;
    if (demoStep === 'done') {
        buttonContent = null;
    } else {
        let buttonText = '';
        let ButtonIcon: React.FC<{className?: string}>;
        let buttonClassName = '';
        
        if (recordingStatus === 'recording') {
            buttonText = 'Остановить запись';
            ButtonIcon = StopIcon;
            buttonClassName = 'bg-red-600 hover:bg-red-700';
        } else if (isResponding) {
            buttonText = 'Говорит AI...';
            ButtonIcon = SpinnerIcon;
            buttonClassName = 'bg-gray-500 cursor-wait';
        } else {
            buttonText = 'Начать запись';
            ButtonIcon = MicrophoneIcon;
            buttonClassName = 'bg-cyan-600 hover:bg-cyan-700';
        }

        buttonContent = (
            <button
                onClick={handleInteraction}
                disabled={isResponding}
                className={`flex items-center justify-center gap-3 w-full max-w-xs mx-auto px-6 py-3 text-base font-semibold text-white rounded-lg shadow-md transition-all duration-300 transform hover:scale-105 ${buttonClassName} disabled:opacity-75 disabled:transform-none disabled:cursor-wait`}
                aria-label={buttonText}
            >
                <ButtonIcon className="h-6 w-6" />
                <span>{buttonText}</span>
            </button>
        );
    }

    return (
        <div className="bg-gray-700/50 border border-gray-600 text-white p-6 rounded-lg shadow-lg text-center animate-fade-in space-y-4">
            <div className="flex justify-center">
                <img 
                    src="/tutor-avatar.jpg" 
                    alt="AI Tutor" 
                    className="w-24 h-24 rounded-full object-cover border-2 border-cyan-500/50 shadow-lg" 
                />
            </div>

            <div className="min-h-[120px] flex flex-col justify-center items-center">
                {getDisplayContent()}
            </div>
            
            <div className="min-h-[68px] flex items-center justify-center">
                {buttonContent}
            </div>

            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
        </div>
    );
};


const HookReviews: React.FC = () => (
    <div className="bg-gray-800/90 border border-gray-700 p-6 rounded-lg shadow-sm animate-fade-in text-center">
        <h3 className="text-xl font-bold text-gray-100 mb-2">«20 часов практики ломают языковой барьер»</h3>
        <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
            Это не магия, а доказанный факт. Регулярные короткие сессии эффективнее редких длинных уроков.
        </p>
        <div className="space-y-4 text-left">
            <div className="bg-gray-700/50 p-4 rounded-lg flex items-start gap-4 border border-gray-600">
                <div className="flex-shrink-0">
                    <div className="w-12 h-12 bg-cyan-500 rounded-full flex items-center justify-center font-bold text-white text-xl shadow-md">
                        А
                    </div>
                </div>
                <div>
                    <blockquote className="text-gray-200 italic">
                        «Я боялась даже заказывать кофе. Через месяц спокойно общалась в поездке!»
                    </blockquote>
                    <p className="mt-2 text-sm font-semibold text-gray-300 text-right">– Анна, 32</p>
                </div>
            </div>
            
            <div className="bg-gray-700/50 p-4 rounded-lg flex items-start gap-4 border border-gray-600">
                <div className="flex-shrink-0">
                     <div className="w-12 h-12 bg-sky-500 rounded-full flex items-center justify-center font-bold text-white text-xl shadow-md">
                        М
                    </div>
                </div>
                <div>
                    <blockquote className="text-gray-200 italic">
                        «Наконец-то перестал подбирать слова на созвонах с коллегами.»
                    </blockquote>
                    <p className="mt-2 text-sm font-semibold text-gray-300 text-right">– Марк, 28</p>
                </div>
            </div>
        </div>
    </div>
);

export const RadarChart: React.FC<{ data: { label: string, score: number }[], theme?: 'light' | 'dark' }> = ({ data, theme = 'light' }) => {
    const size = 420; // Увеличили для длинных русских слов
    const center = size / 2;
    const maxRadius = center - 90; // Больше отступ для меток
    const numLevels = 4;
    const numAxes = data.length;
    const angleSlice = (Math.PI * 2) / numAxes;

    const colors = {
        light: {
            grid: '#e5e7eb',
            axis: '#d1d5db',
            label: '#374151',
            subLabel: '#6b7280',
            fill: 'rgba(139, 92, 246, 0.2)',
            stroke: '#8b5cf6',
        },
        dark: {
            grid: '#475569',
            axis: '#64748b',
            label: '#cbd5e1',
            subLabel: '#94a3b8',
            fill: 'rgba(139, 92, 246, 0.3)',
            stroke: '#a78bfa',
        }
    };
    const currentTheme = colors[theme];

    const pointsToString = (points: {x: number, y: number}[]) => {
        return points.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
    };

    const dataPoints = data.map((item, i) => {
        const radius = (item.score / 100) * maxRadius;
        const angle = angleSlice * i - Math.PI / 2;
        return {
            x: center + radius * Math.cos(angle),
            y: center + radius * Math.sin(angle),
        };
    });

    return (
        <div className="flex justify-center items-center my-4">
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                <g>
                    {[...Array(numLevels)].map((_, levelIndex) => {
                        const radius = maxRadius * ((levelIndex + 1) / numLevels);
                        const levelPoints = data.map((_, i) => {
                            const angle = angleSlice * i - Math.PI / 2;
                            return {
                                x: center + radius * Math.cos(angle),
                                y: center + radius * Math.sin(angle),
                            };
                        });
                        return <polygon key={levelIndex} points={pointsToString(levelPoints)} fill="none" stroke={currentTheme.grid} strokeWidth="1" />;
                    })}

                    {data.map((item, i) => {
                        const angle = angleSlice * i - Math.PI / 2;
                        const labelPoint = {
                            x: center + (maxRadius + 30) * Math.cos(angle),
                            y: center + (maxRadius + 30) * Math.sin(angle),
                        };
                        const isTopOrBottom = Math.abs(labelPoint.x - center) < 1;
                        const textAnchor = isTopOrBottom ? "middle" : labelPoint.x < center ? "end" : "start";

                        return (
                    <g key={i}>
                        <line x1={center} y1={center} x2={dataPoints[i].x} y2={dataPoints[i].y} stroke={currentTheme.axis} strokeWidth="1" />
                        <text
                            x={labelPoint.x}
                            y={labelPoint.y}
                            textAnchor={textAnchor}
                            dominantBaseline="middle"
                            fontSize="12"
                            fontWeight="600"
                            fill={currentTheme.label}
                            style={{ maxWidth: '80px' }}
                        >
                            {item.label}
                             <tspan
                                x={labelPoint.x}
                                dy="1.1em"
                                fontSize="11"
                                fontWeight="500"
                                fill={currentTheme.subLabel}
                            >
                                {item.score}/100
                            </tspan>
                        </text>
                    </g>
                        );
                    })}

                    <polygon points={pointsToString(dataPoints)} fill={currentTheme.fill} stroke={currentTheme.stroke} strokeWidth="2" />

                    {dataPoints.map((p, i) => (
                         <circle key={i} cx={p.x} cy={p.y} r="4" fill={currentTheme.stroke} />
                    ))}
                </g>
            </svg>
        </div>
    );
};


const HookFeedback: React.FC = () => {
    const radarData = [
        { label: 'Беглость', score: 70 },
        { label: 'Словарь', score: 55 },
        { label: 'Грамматика', score: 65 },
        { label: 'Аудирование', score: 75 },
        { label: 'Произношение', score: 80 },
    ];

    return (
    <div className="bg-gray-800/90 border border-gray-700 p-6 rounded-lg shadow-sm animate-fade-in">
        <p className="font-bold text-lg mb-2 text-center text-gray-100">Ваш прогресс — наглядно</p>
        <p className="text-sm text-gray-400 text-center mb-4">После каждой сессии вы получаете не просто оценку, а детальный разбор с рекомендациями.</p>
        
        <RadarChart data={radarData} theme="dark" />

        <div className="bg-gray-700/50 p-4 rounded-md">
            <h3 className="font-semibold text-gray-300 mb-2">Пример анализа (Словарный запас):</h3>
            <p className="text-sm text-gray-400">
                Вы уверенно используете базовую лексику. Чтобы сделать речь богаче, попробуйте добавлять синонимы. Например, вместо <code className="bg-gray-600 text-xs px-1 rounded">"good"</code> можно использовать <code className="bg-gray-600 text-xs px-1 rounded">"great"</code>, <code className="bg-gray-600 text-xs px-1 rounded">"excellent"</code> или <code className="bg-gray-600 text-xs px-1 rounded">"wonderful"</code>.
            </p>
             <p className="text-xs text-gray-500 mt-2">
                <span className="font-bold">Рекомендация:</span> В следующем диалоге постарайтесь использовать 3 новых прилагательных.
            </p>
        </div>

        <p className="text-sm text-gray-400 text-center mt-6">В полном отчёте вы увидите такой же детальный разбор по <span className="font-semibold text-gray-300">каждому</span> из пяти аспектов языка.</p>
    </div>
    );
};

const renderHook = (type: HookType) => {
    switch (type) {
        case HookType.REVIEWS: return <HookReviews />;
        case HookType.DEMO: return <HookMicroDemo />;
        case HookType.FEEDBACK: return <HookFeedback />;
        default: return null;
    }
};

interface FunnelProps {
    onComplete: () => void;
    anonymUserId: string;
}

const Funnel: React.FC<FunnelProps> = ({ onComplete, anonymUserId }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [answers, setAnswers] = useState<Answers>({});
    const [showingHook, setShowingHook] = useState<Hook | null>(null);

    const currentQuestion: Question | undefined = QUESTIONS[currentStep];

    const handleAnswer = useCallback((option: string) => {
        if (!currentQuestion) return;
        setAnswers(prev => {
            const existingAnswer = prev[currentQuestion.id];
            if (currentQuestion.type === 'checkbox') {
                const newAnswerSet = new Set(Array.isArray(existingAnswer) ? existingAnswer : []);
                if (newAnswerSet.has(option)) {
                    newAnswerSet.delete(option);
                } else {
                    newAnswerSet.add(option);
                }
                return { ...prev, [currentQuestion.id]: Array.from(newAnswerSet) };
            }
            return { ...prev, [currentQuestion.id]: option };
        });
    }, [currentQuestion]);

    const isNextDisabled = useMemo(() => {
        if (showingHook) return false;
        if (!currentQuestion) return true;
        const answer = answers[currentQuestion.id];
        if (!answer) return true;
        if (Array.isArray(answer) && answer.length === 0) return true;
        return false;
    }, [answers, currentQuestion, showingHook]);

    const handleNext = useCallback(() => {
        if (showingHook) {
            setShowingHook(null);
            if (currentStep < QUESTIONS.length - 1) {
                setCurrentStep(prev => prev + 1);
            } else {
                onComplete();
            }
            return;
        }

        if (!currentQuestion) {
            onComplete();
            return;
        }

        const hookForStep = HOOKS.find(h => h.afterQuestionId === currentQuestion.id);

        if (hookForStep) {
            setShowingHook(hookForStep);
        } else {
            if (currentStep < QUESTIONS.length - 1) {
                setCurrentStep(prev => prev + 1);
            } else {
                onComplete();
            }
        }
    }, [currentStep, onComplete, showingHook, currentQuestion]);

    const handleBack = useCallback(() => {
        if (showingHook) {
            setShowingHook(null);
            return;
        } 
        
        if (currentStep > 0) {
            const prevQuestionId = QUESTIONS[currentStep - 1].id;
            const hookToShow = HOOKS.find(h => h.afterQuestionId === prevQuestionId);
            
            if (hookToShow) {
                setShowingHook(hookToShow);
            } else {
                 setCurrentStep(prev => prev - 1);
            }
        }
    }, [currentStep, showingHook]);

    const progressValue = useMemo(() => {
        if (showingHook) {
            return showingHook.afterQuestionId;
        }
        return currentStep;
    }, [currentStep, showingHook]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4 sm:p-6">
            <div className="w-full max-w-2xl bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl p-6 sm:p-10 transition-all duration-300">
                <div className="mb-6">
                    <ProgressBar current={progressValue} total={QUESTIONS.length} />
                </div>
                
                {showingHook ? (
                    renderHook(showingHook.type)
                ) : (
                    currentQuestion && <>
                        <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 mb-8 text-center">{currentQuestion.text}</h2>
                        <div className="space-y-3 mb-8">
                            {currentQuestion.options.map((option) => {
                                const isChecked = currentQuestion.type === 'checkbox'
                                    ? Array.isArray(answers[currentQuestion.id]) && (answers[currentQuestion.id] as string[]).includes(option)
                                    : answers[currentQuestion.id] === option;
                                
                                return (
                                <label key={option} className="flex items-center p-4 border-2 border-gray-700 rounded-lg cursor-pointer hover:bg-gray-700/50 hover:border-cyan-500 transition-all has-[:checked]:bg-cyan-900/30 has-[:checked]:border-cyan-500">
                                    <input
                                        type={currentQuestion.type}
                                        name={`question-${currentQuestion.id}`}
                                        value={option}
                                        checked={isChecked}
                                        onChange={() => handleAnswer(option)}
                                        className="h-5 w-5 text-cyan-500 focus:ring-cyan-500 border-gray-600 rounded bg-gray-800"
                                    />
                                    <span className="ml-4 text-md font-medium text-gray-200">{option}</span>
                                </label>
                                );
                            })}
                        </div>
                    </>
                )}
                
                <div className="flex justify-between items-center mt-10">
                    <button
                        onClick={handleBack}
                        disabled={currentStep === 0 && !showingHook}
                        className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <ChevronLeftIcon />
                        Назад
                    </button>
                    <button
                        onClick={handleNext}
                        disabled={isNextDisabled}
                        className="flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-cyan-600 rounded-lg shadow-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-500 disabled:opacity-50 disabled:bg-gray-600 disabled:cursor-not-allowed transition-all"
                    >
                        {showingHook ? 'Продолжить' : (currentStep >= QUESTIONS.length -1 ? 'Завершить' : 'Далее')}
                        <ChevronRightIcon />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default Funnel;