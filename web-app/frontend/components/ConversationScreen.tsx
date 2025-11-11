import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage } from '@google/genai';
import { ConversationStatus, TranscriptEntry, Scenario, FinalFeedback, FeedbackScores, InProgressSessionData } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { BotIcon, StopIcon, UserIcon, HintIcon } from './Icons';
import { RadarChart } from './funnel/Funnel';

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
7.  **Never Say Goodbye**: Continue the conversation naturally. Do NOT end the conversation or say goodbye unless explicitly instructed.

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

const GOODBYE_SYSTEM_INSTRUCTION_TEMPLATE = `You are an AI English tutor. 

⏰ **TIME IS UP!** The lesson has ended. You MUST say goodbye NOW.

--- CONVERSATION TRANSCRIPT ---
{transcript}
--- END TRANSCRIPT ---

**YOUR TASK**: Say a brief, warm goodbye to the learner RIGHT NOW. This is the LAST thing you will say.

**FORMAT**:
- 1-2 sentences maximum
- Thank them for practicing
- Give brief encouragement
- NO questions, NO small talk, NO continuation

**EXAMPLES**:
- "Great job today! Keep practicing and I'll see you next time!"
- "Well done! You did really well. Keep up the good work!"
- "Excellent practice session! I'm proud of your progress. See you soon!"

Now say goodbye and STOP SPEAKING immediately after.
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
    isDemoMode?: boolean; // Demo mode: 5 minutes, no save, just end with transcript
    durationMinutes?: number; // Custom duration (default 10 for main, 5 for demo)
    tutorAvatarUrl?: string; // Optional tutor avatar image URL
}

const ai = new GoogleGenAI({ 
    apiKey: import.meta.env.GEMINI_API_KEY || ''
});
const IN_PROGRESS_SESSION_KEY = 'in-progress-session';

const ConversationScreen: React.FC<Props> = ({ scenario, startTime, initialTranscript, onSaveAndExit, isSaving, isDemoMode = false, durationMinutes = 10, tutorAvatarUrl }) => {
    console.log('⏱️ ConversationScreen initialized with durationMinutes:', durationMinutes, 'isDemoMode:', isDemoMode);
    
    const [status, setStatus] = useState<ConversationStatus>(ConversationStatus.CONNECTING);
    const [transcript, setTranscript] = useState<TranscriptEntry[]>(initialTranscript);
    const transcriptRef = useRef<TranscriptEntry[]>(initialTranscript);
    const [error, setError] = useState<string | null>(null);
    const [finalFeedback, setFinalFeedback] = useState<FinalFeedback>({ text: null, scores: null });
    const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState<boolean>(false);
    const [timeLeft, setTimeLeft] = useState(durationMinutes * 60);
    const hasWarnedAboutTimeRef = useRef(false);
    const shouldSayGoodbyeRef = useRef(false);
    const hasTriggeredGoodbyeRef = useRef(false);
    const isInGoodbyeModeRef = useRef(false);

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
        if (status === ConversationStatus.GENERATING_FEEDBACK || isStopping.current) {
            console.log('⚠️ handleStop blocked:', { status, isStopping: isStopping.current });
            return;
        }
        
        console.log('🛑 Stopping conversation...');
        isStopping.current = true;
        console.log('🔄 Setting status to GENERATING_FEEDBACK');
        setStatus(ConversationStatus.GENERATING_FEEDBACK);
        console.log('🧹 Cleaning up resources...');
        await cleanupConversationResources();
        console.log('✅ Cleanup complete, generating feedback...');
        
        const currentTranscript = transcriptRef.current;
        const transcriptText = currentTranscript
            .filter(e => e.text.trim())
            .map(entry => `${entry.speaker === 'user' ? 'Learner' : 'Tutor'}: ${entry.text}`)
            .join('\n');
        
        // Count user turns
        const userTurns = currentTranscript.filter(e => e.speaker === 'user' && e.text.trim() && e.isFinal).length;
        console.log(`👤 User turns: ${userTurns}`);
        
        // Check minimum data requirement
        if (currentTranscript.length === 0 || userTurns === 0) {
            const emptyFeedback = { scores: null, text: 'Недостаточно данных для отзыва. Попробуйте поговорить подольше.' };
            setFinalFeedback(emptyFeedback);
            
            if (isDemoMode) {
                onSaveAndExit(currentTranscript, emptyFeedback);
            } else {
                setIsFeedbackModalOpen(true);
            }
            return;
        }
        
        // Demo mode: check if user spoke enough (at least 3 turns)
        if (isDemoMode && userTurns < 3) {
            console.log(`⚠️ Demo: insufficient turns (${userTurns} < 3)`);
            const insufficientFeedback = { scores: null, text: 'INSUFFICIENT_TURNS' };
            setFinalFeedback(insufficientFeedback);
            onSaveAndExit(currentTranscript, insufficientFeedback);
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
            
            const generatedFeedback = { scores: parsedScores, text: textPart };
            setFinalFeedback(generatedFeedback);
            
            // Demo mode: skip modal, go straight to email form
            if (isDemoMode) {
                onSaveAndExit(currentTranscript, generatedFeedback);
            } else {
                setIsFeedbackModalOpen(true);
            }
        } catch (err) {
            console.error('Error generating feedback:', err);
            const errorFeedback = { scores: null, text: 'Извините, не удалось сгенерировать отзыв для этой сессии.' };
            setFinalFeedback(errorFeedback);
            
            if (isDemoMode) {
                onSaveAndExit(currentTranscript, errorFeedback);
            } else {
                setIsFeedbackModalOpen(true);
            }
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

            // In goodbye mode, don't start microphone (AI just says goodbye and stops)
            let stream: MediaStream | null = null;
            if (!isInGoodbyeModeRef.current) {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaStreamRef.current = stream;
                console.log('✅ Microphone stream acquired:', stream.getAudioTracks()[0].label);
            } else {
                console.log('🚫 Goodbye mode: microphone not started (AI will say goodbye only)');
            }
    
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
                        
                        console.log('🔗 WebSocket opened');
                        
                        // In goodbye mode, don't setup audio processing (AI will just say goodbye)
                        if (isInGoodbyeModeRef.current) {
                            console.log('👋 Goodbye mode: skipping microphone setup, waiting for AI farewell...');
                            setStatus(ConversationStatus.SPEAKING);
                            return;
                        }
                        
                        // Normal mode: setup audio processing
                        console.log('🔗 Setting up audio processing...');
                        setStatus(ConversationStatus.LISTENING);
                        const source = inputAudioContextRef.current!.createMediaStreamSource(mediaStreamRef.current!);
                        const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
                        scriptProcessorRef.current = scriptProcessor;
                        console.log('🎙️ ScriptProcessor created, connecting audio chain...');
    
                        let audioChunkCount = 0;
                        scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                            if (isStopping.current) return;
                            audioChunkCount++;
                            if (audioChunkCount === 1) {
                                console.log('🎤 First audio chunk received, audio is being captured!');
                            }
                            if (audioChunkCount % 100 === 0) {
                                console.log(`📊 Processed ${audioChunkCount} audio chunks`);
                            }
                            const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                            const pcmBlob = createBlob(inputData);
                            
                            if (audioChunkCount === 1) {
                                console.log('🔍 Checking session state...');
                                console.log('  sessionPromiseRef.current:', !!sessionPromiseRef.current);
                            }
                            
                            sessionPromiseRef.current?.then((session) => {
                                if (audioChunkCount === 1) {
                                    console.log('  session resolved:', !!session);
                                    console.log('  session keys:', Object.keys(session));
                                    console.log('  session._ws:', !!session._ws);
                                    console.log('  session.ws:', !!(session as any).ws);
                                    console.log('  WebSocket.readyState (_ws):', session._ws?.readyState);
                                    console.log('  WebSocket.readyState (ws):', (session as any).ws?.readyState);
                                    console.log('  WebSocket.OPEN:', WebSocket.OPEN);
                                    console.log('  isStopping:', isStopping.current);
                                }
                                
                                // FIX: Remove WebSocket state check - SDK manages connection internally
                                if (!isStopping.current) {
                                    if (audioChunkCount === 1) {
                                        console.log('📤 Sending first audio chunk to Gemini (no WebSocket check)...');
                                    }
                                    session.sendRealtimeInput({ media: pcmBlob });
                                }
                            }).catch(err => {
                                if (!isStopping.current && audioChunkCount === 1) {
                                    console.warn("❌ Session promise rejected:", err);
                                }
                            });
                        };
                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputAudioContextRef.current!.destination);
                        console.log('✅ Audio chain connected: microphone → processor → destination');
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
                            scheduleUpdate(prev => {
                                const finalized = prev.map(e => ({ ...e, isFinal: true }));
                                
                                // If we're in goodbye mode, AI just said goodbye - stop after it finishes
                                if (isInGoodbyeModeRef.current) {
                                    console.log('👋 AI said goodbye, waiting for audio to finish before stopping...');
                                    const checkAndStop = () => {
                                        if (outputSources.size === 0) {
                                            console.log('🛑 Goodbye complete, stopping lesson now');
                                            if (!isStopping.current) {
                                                setTimeout(() => handleStopRef.current(), 500);
                                            }
                                        } else {
                                            console.log('⏳ Waiting for goodbye to finish playing...');
                                            setTimeout(checkAndStop, 500);
                                        }
                                    };
                                    setTimeout(checkAndStop, 500);
                                    return finalized;
                                }
                                
                                // Goodbye logic moved to timer (at 30 seconds mark)
                                
                                return finalized;
                            });
                        }
                         if (message.serverContent?.interrupted) {
                            outputSources.forEach(source => source.stop());
                            outputSources.clear();
                            nextStartTime.current = 0;
                            if (!isStopping.current) setStatus(ConversationStatus.LISTENING);
                         }
                    },
                    onerror: (e) => {
                        console.error('❌ API Error:', e);
                        console.log('Error details:', JSON.stringify(e, null, 2));
                        setError('An API error occurred. The lesson has been stopped.');
                        cleanupConversationResources();
                    },
                    onclose: () => {
                        console.log('🔌 WebSocket closed', isStopping.current ? '(intentional)' : '(unexpected)');
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
            console.error('❌ Failed to start conversation:', err);
            console.log('Error type:', err instanceof Error ? err.name : typeof err);
            console.log('Error message:', err instanceof Error ? err.message : String(err));
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
        setTimeLeft(Math.max(0, durationMinutes * 60 - elapsed));
        
        timerRef.current = window.setInterval(() => {
            setTimeLeft(prev => {
                const next = prev - 1;
                
                // At 0, stop microphone and wait for AI to finish
                if (next <= 0) {
                    if (timerRef.current) clearInterval(timerRef.current);
                    
                    console.log('⏱️ Time expired! Stopping microphone...');
                    
                    // Stop microphone input immediately (user can't speak anymore)
                    if (scriptProcessorRef.current) {
                        try {
                            scriptProcessorRef.current.disconnect();
                            scriptProcessorRef.current = null;
                            console.log('🎤 Microphone stopped (time limit reached)');
                        } catch (e) {
                            console.warn('Failed to stop microphone:', e);
                        }
                    }
                    
                    // Wait for AI to finish speaking before stopping
                    const waitForAudioToFinish = () => {
                        if (outputSources.size === 0 && status !== ConversationStatus.SPEAKING) {
                            console.log('⏱️ Time expired, all audio finished, stopping gracefully');
                            if (!isStopping.current) handleStopRef.current();
                        } else {
                            console.log('⏱️ Time expired, waiting for AI to finish speaking...', { 
                                audioSources: outputSources.size, 
                                status 
                            });
                            // Check again in 500ms
                            setTimeout(waitForAudioToFinish, 500);
                        }
                    };
                    
                    // Start checking
                    waitForAudioToFinish();
                    
                    return 0;
                }
                
                // Warning at 30 seconds
                if (next === 30 && !hasWarnedAboutTimeRef.current) {
                    console.log('⚠️ 30 seconds remaining');
                    hasWarnedAboutTimeRef.current = true;
                }
                
                // At 30 seconds - immediately trigger goodbye
                if (next === 30 && !shouldSayGoodbyeRef.current) {
                    console.log('⏰ 30 seconds! Triggering goodbye NOW...');
                    shouldSayGoodbyeRef.current = true;
                    hasTriggeredGoodbyeRef.current = true;
                    
                    // Wait for AI to finish current response
                    const triggerGoodbye = () => {
                        if (outputSources.size === 0 && status !== ConversationStatus.SPEAKING) {
                            console.log('✅ AI finished, sending goodbye instruction...');
                            
                            // Stop microphone
                            if (scriptProcessorRef.current) {
                                try {
                                    scriptProcessorRef.current.disconnect();
                                    scriptProcessorRef.current = null;
                                    console.log('🎤 Microphone stopped');
                                } catch (e) {
                                    console.warn('Failed to stop microphone:', e);
                                }
                            }
                            
                            // Reconnect with goodbye instruction
                            isInGoodbyeModeRef.current = true;
                            const transcriptText = transcriptRef.current
                                .filter(e => e.isFinal && e.text.trim())
                                .map(entry => `${entry.speaker === 'user' ? 'Learner' : 'Tutor'}: ${entry.text}`)
                                .join('\n');
                            const goodbyeInstruction = GOODBYE_SYSTEM_INSTRUCTION_TEMPLATE.replace('{transcript}', transcriptText);
                            
                            console.log('🔄 Reconnecting with goodbye instruction...');
                            partialCleanupForReconnect().then(() => {
                                startLiveSession(goodbyeInstruction);
                            });
                        } else {
                            console.log('⏳ Waiting for AI to finish before goodbye...');
                            setTimeout(triggerGoodbye, 500);
                        }
                    };
                    
                    setTimeout(triggerGoodbye, 500);
                }
                
                return next;
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

            {/* Full-screen loader for feedback generation */}
            {status === ConversationStatus.GENERATING_FEEDBACK && !isFeedbackModalOpen && (
                <div className="absolute inset-0 bg-gray-900/95 flex flex-col items-center justify-center z-50">
                    <div className="w-24 h-24 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h2 className="text-2xl font-bold text-cyan-400 animate-pulse mb-2">Generating your feedback...</h2>
                    <p className="text-gray-400 text-center max-w-md">
                        Our AI is analyzing your conversation and preparing detailed feedback. This usually takes 10-15 seconds.
                    </p>
                </div>
            )}

            {/* Floating timer - always visible on top */}
            <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 bg-gray-800/95 backdrop-blur-sm px-6 py-2 rounded-full border border-gray-700 shadow-2xl flex items-center gap-4">
                <h2 className="text-lg font-bold text-white">{scenario.title}</h2>
                <div className="text-2xl font-mono text-cyan-400 font-bold" aria-label="Time left">
                    ⏱️ {formatTime(timeLeft)}
                </div>
            </div>

            <div className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden pt-20">
                <div className="flex-1 bg-gray-800 rounded-lg p-4 overflow-y-auto mb-4 border border-gray-700">
                    <TranscriptList transcript={transcript} tutorAvatarUrl={tutorAvatarUrl} />
                </div>
                <div className="flex flex-col items-center justify-center space-y-4">
                     <div className="relative flex items-center justify-center w-24 h-24">
                        {isConversationActive && (
                             <div className={`absolute inset-0 rounded-full bg-cyan-500/50 ${status === ConversationStatus.LISTENING ? 'animate-pulse' : (status === ConversationStatus.RECONNECTING || status === ConversationStatus.CONNECTING ? 'animate-spin' : '')}`}></div>
                        )}
                        {status === ConversationStatus.GENERATING_FEEDBACK && (
                            <div className="absolute inset-0 rounded-full border-4 border-cyan-600 border-t-transparent animate-spin"></div>
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
                    <p className={`text-center h-6 font-semibold ${status === ConversationStatus.ERROR ? 'text-red-400' : (status === ConversationStatus.GENERATING_FEEDBACK ? 'text-cyan-400 animate-pulse' : 'text-gray-400')}`}>
                        {getStatusText()}
                    </p>
                </div>
            </div>
        </div>
    );
};

const TranscriptList = React.memo(({ transcript, tutorAvatarUrl }: { transcript: TranscriptEntry[], tutorAvatarUrl?: string }) => {
    const transcriptEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        transcriptEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, [transcript]);

    return (
        <>
            {transcript.map((entry) => (
                <TranscriptItem key={entry.id} entry={entry} tutorAvatarUrl={tutorAvatarUrl} />
            ))}
            <div ref={transcriptEndRef} />
        </>
    );
});

const TranscriptItem = React.memo(({ entry, tutorAvatarUrl }: { entry: TranscriptEntry, tutorAvatarUrl?: string }) => {
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
            {entry.speaker === 'ai' && (
                tutorAvatarUrl ? (
                    <img src={tutorAvatarUrl} alt="Tutor" className="flex-shrink-0 w-12 h-12 rounded-full object-cover" />
                ) : (
                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-cyan-500 flex items-center justify-center">
                        <BotIcon className="w-7 h-7"/>
                    </div>
                )
            )}
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
            {entry.speaker === 'user' && <div className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center"><UserIcon className="w-7 h-7"/></div>}
        </div>
    );
});

const FeedbackModal: React.FC<{isOpen: boolean, feedback: FinalFeedback, onClose: () => void, isSaving: boolean}> = ({isOpen, feedback, onClose, isSaving}) => {
    if (!isOpen) return null;

    const renderFeedbackText = (text: string) => {
        const html = text
            .replace(/### (.*?)(\n|$)/g, '<h3 class="text-xl font-bold text-cyan-400 mt-4 mb-2">$1</h3>')
            .replace(/## (.*?)(\n|$)/g, '<h2 class="text-2xl font-bold text-cyan-400 mt-5 mb-3">$1</h2>')
            .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-cyan-400">$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/(\n)/g, '<br />');
        return <div className="text-gray-300 whitespace-pre-wrap leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
    };

    const scores = feedback.scores;
    const overallScore = scores ? Math.round((scores.pronunciation + scores.grammar + scores.vocabulary + scores.fluency + scores.comprehension) / 5) : 0;
    
    // Prepare data for RadarChart
    const radarData = scores ? [
        { label: 'Речь', score: scores.pronunciation },
        { label: 'Словарь', score: scores.vocabulary },
        { label: 'Грамматика', score: scores.grammar },
        { label: 'Слух', score: scores.comprehension },
        { label: 'Беглость', score: scores.fluency },
    ] : [];

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
                            <div className="flex justify-center my-4">
                                <RadarChart data={radarData} theme="dark" />
                            </div>
                            <p className="text-xs text-gray-400 text-center mt-2 italic">
                                💡 Слух = Понимание, Речь = Произношение
                            </p>
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