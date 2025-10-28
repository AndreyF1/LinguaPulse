import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import { ConversationStatus, TranscriptEntry, Scenario, FinalFeedback, FeedbackScores, InProgressSessionData } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { BotIcon, StopIcon, UserIcon, HintIcon } from './Icons';

const START_CONVERSATION_SYSTEM_INSTRUCTION = `You are a friendly and patient AI English tutor.
Your user is a native Russian speaker. Their goal is to practice conversational English.
You will have a conversation based on the following scenario.
The user will speak first to begin the roleplay. You must wait for them.

RULES:
1.  **Wait for the User**: DO NOT speak until the user has spoken first. They will initiate the conversation.
2.  **Respond Naturally**: Once the user speaks, respond according to the scenario prompt.
3.  **Gentle Corrections**: If the user makes a grammatical mistake, gently correct them after they finish speaking and explain the correction briefly in English.
4.  **Handle Russian Input**: If the user speaks in Russian, gently guide them back to English. You MUST use Russian for this guidance. For example, say: "Хорошая попытка! Давайте попробуем сказать это на английском. Как бы вы сказали...?"
5.  **Encourage Speaking**: Ask open-ended questions to encourage the user to speak more.
6.  **Keep it Brief**: Keep your responses relatively short to maintain a conversational flow.

--- SCENARIO CONTEXT ---
The user wants to practice a scenario about: {title}.
The situation is: {description}.
You should act as the other person in this scenario. For example, if they are ordering coffee, you are the barista. A possible opening line from you would have been "{prompt}", but you must wait for the user to start.
--- END SCENARIO ---

Now, wait for the user to begin the conversation.
`;

const RECONNECT_SYSTEM_INSTRUCTION_TEMPLATE = `You are an AI English tutor rejoining a conversation that was briefly interrupted.
Your user is a native Russian speaker. Your goal is to help them practice conversational English.
Speak clearly and at a moderate pace.

RULES:
1.  **Continue the conversation**: The conversation so far is provided below. Continue it naturally. DO NOT start over with the initial scenario prompt.
2.  **Gentle Corrections**: If the user makes a grammatical mistake, gently correct them.
3.  **Handle Russian Input**: If the user speaks in Russian, guide them back to English in Russian.
4.  **Encourage Speaking**: Ask open-ended questions.
5.  **Keep it Brief**: Keep your responses short.

--- PREVIOUS CONVERSATION ---
{transcript}
--- END PREVIOUS CONVERSATION ---

Now, please continue the conversation. You could say something like "Sorry about that, where were we?" or just continue the topic.
`;

const FEEDBACK_PROMPT_TEMPLATE = `
Based on the following conversation transcript with a Russian-speaking English learner, provide a detailed but concise feedback report.

**CRITICAL INSTRUCTIONS:**
1.  **The entire response MUST be in Russian.**
2.  Your response must start with a single JSON object containing scores, followed by the text feedback in Markdown. Do not wrap the JSON in markdown backticks.
3.  The JSON object must have the following structure and keys EXACTLY:
    {
      "scores": {
        "pronunciation": <score_out_of_100>,
        "grammar": <score_out_of_100>,
        "vocabulary": <score_out_of_100>,
        "fluency": <score_out_of_100>,
        "comprehension": <score_out_of_100>
      }
    }
4.  After the JSON object, provide a detailed feedback report in Russian Markdown format. Address the following points:
    *   **Произношение (Pronunciation)**: Note any potential pronunciation issues.
    *   **Грамматика (Grammar)**: Point out recurring grammatical mistakes.
    *   **Словарный запас (Vocabulary)**: Suggest alternative words or phrases.
    *   **Беглость речи (Fluency)**: Give an encouraging comment on their conversational flow.
    *   **Общий отзыв (Overall Feedback)**: A summary of their performance.

CONVERSATION TRANSCRIPT:
---
{transcript}
---

Remember: Start with the JSON object, then the Markdown text. Both MUST be in Russian.
`;


interface Props {
    scenario: Scenario;
    startTime: number;
    initialTranscript: TranscriptEntry[];
    onSaveAndExit: (transcript: TranscriptEntry[], finalFeedback: FinalFeedback) => void;
    isSaving: boolean;
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
const IN_PROGRESS_SESSION_KEY = 'in-progress-session';

const ConversationScreen: React.FC<Props> = ({ scenario, startTime, initialTranscript, onSaveAndExit, isSaving }) => {
    const [status, setStatus] = useState<ConversationStatus>(ConversationStatus.CONNECTING);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>(initialTranscript);
    const transcriptRef = useRef<TranscriptEntry[]>(initialTranscript);
    const [error, setError] = useState<string | null>(null);
    const [finalFeedback, setFinalFeedback] = useState<FinalFeedback>({ text: null, scores: null });
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState<boolean>(false);
    const [timeLeft, setTimeLeft] = useState(10 * 60);

    const sessionPromiseRef = useRef<Promise<any> | null>(null);
    const inputAudioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const outputSources = useRef<Set<AudioBufferSourceNode>>(new Set()).current;
    const nextStartTime = useRef(0);
    const isStopping = useRef(false);
    const timerRef = useRef<number | null>(null);
    const messageIdCounter = useRef(initialTranscript.length);

    const handleStopRef = useRef(useCallback(() => {}, []));
    
    const updateQueue = useRef<((prev: TranscriptEntry[]) => TranscriptEntry[])[]>([]);
    const batchUpdateTimeout = useRef<number | null>(null);

    const flushTranscriptUpdates = useCallback(() => {
        if (updateQueue.current.length > 0) {
            const updates = [...updateQueue.current];
            updateQueue.current = [];
            setTranscript(currentTranscript => {
                let nextTranscript = currentTranscript;
                for (const update of updates) {
                    nextTranscript = update(nextTranscript);
                }
                return nextTranscript;
            });
        }
        batchUpdateTimeout.current = null;
    }, []);

    const scheduleUpdate = useCallback((updater: (prev: TranscriptEntry[]) => TranscriptEntry[]) => {
        updateQueue.current.push(updater);
        if (!batchUpdateTimeout.current) {
            batchUpdateTimeout.current = window.setTimeout(flushTranscriptUpdates, 150);
        }
    }, [flushTranscriptUpdates]);

    useEffect(() => {
        if (status !== ConversationStatus.IDLE && transcript.length > 0) {
            const sessionToSave: InProgressSessionData = {
                scenario,
                startTime,
                transcript,
            };
            localStorage.setItem(IN_PROGRESS_SESSION_KEY, JSON.stringify(sessionToSave));
        }
    }, [transcript, scenario, startTime, status]);

    useEffect(() => {
        transcriptRef.current = transcript;
    }, [transcript]);
    
    const partialCleanupForReconnect = useCallback(async () => {
        if (sessionPromiseRef.current) {
            try {
                const session = await sessionPromiseRef.current;
                session.close();
            } catch (e) { /* ignore */ }
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach((track) => track.stop());
            mediaStreamRef.current = null;
        }
        if (inputAudioContextRef.current?.state !== 'closed') {
            try { await inputAudioContextRef.current?.close(); } catch(e) {}
        }
    }, []);

    const cleanupConversationResources = useCallback(async () => {
        isStopping.current = true;
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        if (batchUpdateTimeout.current) {
            clearTimeout(batchUpdateTimeout.current);
            flushTranscriptUpdates();
        }
        await partialCleanupForReconnect();
        
        if (outputAudioContextRef.current?.state !== 'closed') {
             try { await outputAudioContextRef.current?.close(); } catch(e) {}
        }
        outputSources.forEach(source => source.stop());
        outputSources.clear();

        sessionPromiseRef.current = null;
        setStatus(ConversationStatus.IDLE);
    }, [partialCleanupForReconnect, flushTranscriptUpdates, outputSources]);
    
    const handleStop = useCallback(async () => {
        if (status === ConversationStatus.GENERATING_FEEDBACK || isStopping.current) return;
        
        isStopping.current = true;
        setStatus(ConversationStatus.GENERATING_FEEDBACK);
        await cleanupConversationResources();
        
        const currentTranscript = transcriptRef.current;
        const transcriptText = currentTranscript
            .filter(e => e.text.trim())
            .map(entry => `${entry.speaker === 'user' ? 'Learner' : 'Tutor'}: ${entry.text}`)
            .join('\n');
        
        if (currentTranscript.length === 0 || !currentTranscript.some(e => e.speaker === 'user' && e.text.trim())) {
            setFinalFeedback({ scores: null, text: 'Недостаточно данных для отзыва. Попробуйте поговорить подольше.' });
            setIsFeedbackModalOpen(true);
            return;
        }

        try {
            const prompt = FEEDBACK_PROMPT_TEMPLATE.replace('{transcript}', transcriptText);
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
            
            const rawResponse = response.text;
            let parsedScores: FeedbackScores | null = null;
            let textPart: string = rawResponse;

            const jsonEndIndex = rawResponse.lastIndexOf('}');
            if (jsonEndIndex !== -1) {
                const potentialJson = rawResponse.substring(0, jsonEndIndex + 1);
                try {
                    const parsed = JSON.parse(potentialJson);
                    if (parsed.scores) {
                        parsedScores = parsed.scores;
                        textPart = rawResponse.substring(jsonEndIndex + 1).trim();
                    }
                } catch (e) {
                    console.warn("Could not parse leading JSON from feedback response.", e);
                }
            }
            setFinalFeedback({ scores: parsedScores, text: textPart });
        } catch (err) {
            console.error('Error generating feedback:', err);
            setFinalFeedback({ scores: null, text: 'Извините, не удалось сгенерировать отзыв для этой сессии.' });
        } finally {
            setIsFeedbackModalOpen(true);
        }
    }, [cleanupConversationResources, status]);
    
    const startLiveSession = useCallback(async (systemInstruction: string) => {
        isStopping.current = false;
        setStatus(ConversationStatus.CONNECTING);
        setError(null);
    
        try {
            const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
            inputAudioContextRef.current = new AudioContext({ sampleRate: 16000 });
            if (!outputAudioContextRef.current) {
                outputAudioContextRef.current = new AudioContext({ sampleRate: 24000 });
            }
    
            // CRITICAL FIX: Resume AudioContexts immediately to prevent browser suspension.
            if (inputAudioContextRef.current.state === 'suspended') {
                await inputAudioContextRef.current.resume();
            }
            if (outputAudioContextRef.current.state === 'suspended') {
                await outputAudioContextRef.current.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
    
            sessionPromiseRef.current = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    systemInstruction,
                    inputAudioTranscription: {},
                    outputAudioTranscription: {},
                },
                callbacks: {
                    onopen: () => {
                        if (isStopping.current) return;
                        
                        setStatus(ConversationStatus.LISTENING);
                        const source = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;
    
                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            if (isStopping.current) return;
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            sessionPromiseRef.current?.then((session) => {
                                if (!isStopping.current && session._ws?.readyState === WebSocket.OPEN) {
                                    session.sendRealtimeInput({ media: pcmBlob });
                                }
                            }).catch(err => {
                                if (!isStopping.current) console.warn("Could not send audio data:", err);
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                    },
                    onmessage: async (message: LiveServerMessage) => {
                        if (isStopping.current) return;
                        if (message.serverContent?.modelTurn?.parts[0]?.inlineData?.data) {
                            setStatus(ConversationStatus.SPEAKING);
                            const base64Audio = message.serverContent.modelTurn.parts[0].inlineData.data;
                            nextStartTime.current = Math.max(nextStartTime.current, outputAudioContextRef.current!.currentTime);
                            const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContextRef.current!, 24000, 1);
                            const source = outputAudioContextRef.current!.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputAudioContextRef.current!.destination);
                            
                            source.addEventListener('ended', () => {
                                outputSources.delete(source);
                                if (outputSources.size === 0 && !isStopping.current) setStatus(ConversationStatus.LISTENING);
                            });
    
                            source.start(nextStartTime.current);
                            nextStartTime.current += audioBuffer.duration;
                            outputSources.add(source);
                        }
    
                        const processTranscriptUpdate = (speaker: 'user' | 'ai', text: string, isFinal: boolean) => {
                             scheduleUpdate(prev => {
                                const last = prev[prev.length - 1];
                                if (last?.speaker === speaker && !last.isFinal) {
                                    return [...prev.slice(0, -1), { ...last, text: last.text + text, isFinal }];
                                }
                                messageIdCounter.current += 1;
                                return [...prev, { id: `msg-${messageIdCounter.current}`, speaker, text, isFinal }];
                            });
                        };
    
                        if (message.serverContent?.inputTranscription) processTranscriptUpdate('user', message.serverContent.inputTranscription.text, false);
                        if (message.serverContent?.outputTranscription) processTranscriptUpdate('ai', message.serverContent.outputTranscription.text, false);
                        
                        if (message.serverContent?.turnComplete) {
                            scheduleUpdate(prev => prev.map(e => ({ ...e, isFinal: true })));
                        }
                         if (message.serverContent?.interrupted) {
                            outputSources.forEach(source => source.stop());
                            outputSources.clear();
                            nextStartTime.current = 0;
                            if (!isStopping.current) setStatus(ConversationStatus.LISTENING);
                         }
                    },
                    onerror: (e) => {
                        console.error('API Error:', e);
                        setError('An API error occurred. The lesson has been stopped.');
                        cleanupConversationResources();
                    },
                    onclose: () => {
                        console.log('Session closed.');
                        if (!isStopping.current && timeLeft > 15) {
                            setStatus(ConversationStatus.RECONNECTING);
                            partialCleanupForReconnect().then(() => {
                                 const transcriptText = transcriptRef.current
                                    .filter(e => e.isFinal && e.text.trim())
                                    .map(entry => `${entry.speaker === 'user' ? 'Learner' : 'Tutor'}: ${entry.text}`)
                                    .join('\n');
                                const reconnectInstruction = RECONNECT_SYSTEM_INSTRUCTION_TEMPLATE.replace('{transcript}', transcriptText);
                                startLiveSession(reconnectInstruction);
                            });
                        } else if (!isStopping.current) {
                            handleStopRef.current();
                        }
                    },
                },
            });
        } catch (err) {
            console.error('Failed to start conversation:', err);
            setError('Could not access microphone. Check permissions and try again.');
            setStatus(ConversationStatus.ERROR);
            await cleanupConversationResources();
        }
    }, [cleanupConversationResources, outputSources, scheduleUpdate, timeLeft, partialCleanupForReconnect]);


    useEffect(() => {
        handleStopRef.current = handleStop;
    }, [handleStop]);
    
    useEffect(() => {
        // This effect runs once on mount to start the conversation automatically.
        let instruction: string;
        if (initialTranscript.length > 0) {
            // This is a resumed session
             const transcriptText = initialTranscript
                .filter(e => e.isFinal && e.text.trim())
                .map(entry => `${entry.speaker === 'user' ? 'Learner' : 'Tutor'}: ${entry.text}`)
                .join('\n');
            instruction = RECONNECT_SYSTEM_INSTRUCTION_TEMPLATE.replace('{transcript}', transcriptText);
        } else {
            // This is a new session, user speaks first
            instruction = START_CONVERSATION_SYSTEM_INSTRUCTION
                .replace('{title}', scenario.title)
                .replace('{description}', scenario.description)
                .replace('{prompt}', scenario.prompt);
        }
        
        startLiveSession(instruction);
        
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        setTimeLeft(Math.max(0, 10 * 60 - elapsed));
        
        timerRef.current = window.setInterval(() => {
            setTimeLeft(prev => {
                if (prev <= 1) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    if (!isStopping.current) handleStopRef.current();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);

        return () => {
            isStopping.current = true;
            cleanupConversationResources();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    
    const getStatusText = () => {
        switch (status) {
            case ConversationStatus.CONNECTING: return 'Preparing lesson...';
            case ConversationStatus.RECONNECTING: return 'Reconnecting...';
            case ConversationStatus.LISTENING: return 'Listening... Speak now.';
            case ConversationStatus.SPEAKING: return 'Tutor is speaking...';
            case ConversationStatus.GENERATING_FEEDBACK: return 'Generating your feedback...';
            case ConversationStatus.IDLE: return 'Lesson finished.';
            case ConversationStatus.ERROR: return `Error: ${error}`;
            default: return '';
        }
    };
    
    const isConversationActive = status !== ConversationStatus.IDLE && status !== ConversationStatus.ERROR && status !== ConversationStatus.GENERATING_FEEDBACK;

    const formatTime = (seconds: number) => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    };

    return (
        <div className="flex flex-col h-full">
            <FeedbackModal 
                isOpen={isFeedbackModalOpen}
                feedback={finalFeedback}
                onClose={() => onSaveAndExit(transcriptRef.current, finalFeedback)}
                isSaving={isSaving}
            />

            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden">
                <div className="bg-gray-800 p-3 rounded-t-lg border-b border-gray-700 flex justify-between items-center">
                    <div className="w-16"></div> {/* Spacer */}
                    <h2 className="text-xl font-bold text-center text-white">{scenario.title}</h2>
                    <div className="w-16 text-right text-lg font-mono text-cyan-400" aria-label="Time left">
                        {formatTime(timeLeft)}
                    </div>
                </div>
                <div className="flex-1 bg-gray-800 rounded-b-lg p-4 overflow-y-auto mb-4 border border-t-0 border-gray-700">
                    <TranscriptList transcript={transcript} />
                </div>
                <div className="flex flex-col items-center justify-center space-y-4">
                     <div className="relative flex items-center justify-center w-24 h-24">
                        {isConversationActive && (
                             <div className={`absolute inset-0 rounded-full bg-cyan-500/50 ${status === ConversationStatus.LISTENING ? 'animate-pulse' : (status === ConversationStatus.RECONNECTING || status === ConversationStatus.CONNECTING ? 'animate-spin' : '')}`}></div>
                        )}
                        <button
                            onClick={handleStop}
                            disabled={!isConversationActive}
                            className={`relative w-20 h-20 rounded-full flex items-center justify-center text-white transition-all duration-300 ease-in-out shadow-lg
                                ${isConversationActive ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600 cursor-not-allowed'}`}
                            aria-label={isConversationActive ? 'Stop conversation' : 'Conversation ended'}
                        >
                            <StopIcon className="w-8 h-8"/>
                        </button>
                    </div>
                    <p className={`text-center h-6 ${status === ConversationStatus.ERROR ? 'text-red-400' : 'text-gray-400'}`}>
                        {getStatusText()}
                    </p>
                </div>
            </div>
        </div>
    );
};

const TranscriptList = React.memo(({ transcript }: { transcript: TranscriptEntry[] }) => {
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [transcript]);

    return (
        <>
            {transcript.map((entry) => (
                <TranscriptItem key={entry.id} entry={entry} />
            ))}
            <div ref={transcriptEndRef} />
        </>
    );
});

const TranscriptItem = React.memo(({ entry }: { entry: TranscriptEntry }) => {
    const [translatingMessageId, setTranslatingMessageId] = useState<string | null>(null);
    const [translation, setTranslation] = useState<string | undefined>(entry.translation);
    
    const handleGetTranslation = async (id: string, text: string) => {
        if (!text) return;
        setTranslatingMessageId(id);
        try {
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: `Translate the following English text to Russian: "${text}"` });
            setTranslation(response.text);
        } catch (err) {
            console.error('Translation error:', err);
            setTranslation("Translation failed.");
        } finally {
            setTranslatingMessageId(null);
        }
    };

    return (
        <div className={`flex items-start gap-3 my-4 ${entry.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
            {entry.speaker === 'ai' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-cyan-500 flex items-center justify-center"><BotIcon className="w-5 h-5"/></div>}
            <div className={`max-w-xl p-3 rounded-lg flex flex-col ${entry.speaker === 'user' ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'} ${!entry.isFinal ? 'opacity-70' : ''}`}>
                <p>{entry.text}</p>
                {entry.speaker === 'ai' && entry.isFinal && entry.text && (
                     <div className="mt-2 border-t border-gray-600/50 pt-2">
                        {translation ? (
                            <p className="text-sm text-cyan-300 italic">{translation}</p>
                        ) : (
                            <button onClick={() => handleGetTranslation(entry.id, entry.text)} disabled={translatingMessageId === entry.id} className="text-cyan-400 hover:text-cyan-300 text-sm flex items-center gap-1 disabled:opacity-50">
                                <HintIcon className="w-4 h-4" /> {translatingMessageId === entry.id ? 'Translating...' : 'Show Hint'}
                            </button>
                        )}
                    </div>
                )}
            </div>
            {entry.speaker === 'user' && <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center"><UserIcon className="w-5 h-5"/></div>}
        </div>
    );
});

const FeedbackModal: React.FC<{isOpen: boolean, feedback: FinalFeedback, onClose: () => void, isSaving: boolean}> = ({isOpen, feedback, onClose, isSaving}) => {
    if (!isOpen) return null;

    const renderFeedbackText = (text: string) => {
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

    const scores = feedback.scores;
    const overallScore = scores ? Math.round((scores.pronunciation + scores.grammar + scores.vocabulary + scores.fluency + scores.comprehension) / 5) : 0;

    return (
        <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-gray-800 rounded-lg shadow-xl p-6 w-full max-w-2xl border border-gray-700 max-h-[90vh] flex flex-col">
                <h2 className="text-2xl font-bold text-cyan-400 mb-4 text-center">Результаты урока</h2>
                <div className="overflow-y-auto pr-2">
                   {scores && (
                        <div className="mb-6 p-4 bg-gray-900/50 rounded-lg border border-gray-700">
                            <div className="text-center mb-4">
                                <p className="text-gray-400 text-sm">Общий балл</p>
                                <p className="text-5xl font-bold text-cyan-400">{overallScore}</p>
                            </div>
                            <div className="space-y-4">
                                <ScoreDisplay label="Произношение" score={scores.pronunciation} />
                                <ScoreDisplay label="Грамматика" score={scores.grammar} />
                                <ScoreDisplay label="Словарный запас" score={scores.vocabulary} />
                                <ScoreDisplay label="Беглость речи" score={scores.fluency} />
                                <ScoreDisplay label="Понимание" score={scores.comprehension} />
                            </div>
                        </div>
                    )}
                    {feedback.text ? renderFeedbackText(feedback.text) : <p>Загрузка отзыва...</p>}
                </div>
                <button 
                    onClick={onClose} 
                    disabled={isSaving}
                    className="mt-6 bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded transition-colors duration-200 w-full disabled:bg-cyan-800 disabled:cursor-wait"
                >
                    {isSaving ? 'Сохранение...' : 'Сохранить и выйти'}
                </button>
            </div>
        </div>
    );
};

export default ConversationScreen;