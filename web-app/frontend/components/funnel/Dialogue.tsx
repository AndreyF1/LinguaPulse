import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveServerMessage, Blob } from '@google/genai';
import { MicrophoneIcon } from './IconComponents';
import { encode, decode, decodeAudioData } from '../../services/audioService';

interface DialogueProps {
    onDialogueEnd: (transcript: string) => void;
    anonymUserId: string;
}

const DIALOGUE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

type TranscriptEntry = { speaker: 'User' | 'AI'; text: string; };

const TranscriptDisplay: React.FC<{ history: TranscriptEntry[] }> = ({ history }) => {
    const endOfMessagesRef = useRef<null | HTMLDivElement>(null);

    useEffect(() => {
        endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [history]);
    
    return (
        <div className="w-full h-48 bg-gray-900/50 border border-gray-700 rounded-lg p-3 overflow-y-auto mt-6 space-y-3 text-left">
            {history.map((entry, index) => (
                <div key={index} className={`flex ${entry.speaker === 'User' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`px-3 py-2 rounded-xl max-w-[85%] break-words ${entry.speaker === 'User' ? 'bg-cyan-600' : 'bg-gray-700'}`}>
                        <p className="text-sm">{entry.text}</p>
                    </div>
                </div>
            ))}
            <div ref={endOfMessagesRef} />
        </div>
    );
}

const Dialogue: React.FC<DialogueProps> = ({ onDialogueEnd }) => {
    const [status, setStatus] = useState('Initializing...');
    const [timeLeft, setTimeLeft] = useState(DIALOGUE_DURATION_MS / 1000);
    const [isFinishing, setIsFinishing] = useState(false);
    const [transcriptHistory, setTranscriptHistory] = useState<TranscriptEntry[]>([]);
    
    const sessionRef = useRef<any>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const outputAudioContextRef = useRef<AudioContext | null>(null);
    const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
    const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const transcriptRef = useRef<{input: string, output: string, full: string[]}>({ input: '', output: '', full: [] });
    const activeAudioSources = useRef(new Set<AudioBufferSourceNode>()).current;
    const hasFinishedRef = useRef(false);
    const failsafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isFinishingRef = useRef(isFinishing);
    isFinishingRef.current = isFinishing;
    
    const finishSession = useCallback(() => {
        if (hasFinishedRef.current) return;
        hasFinishedRef.current = true;
        
        if (failsafeTimerRef.current) {
            clearTimeout(failsafeTimerRef.current);
        }

        if(sessionRef.current) {
            sessionRef.current.close();
            sessionRef.current = null;
        }
        if (scriptProcessorRef.current) {
            scriptProcessorRef.current.disconnect();
            scriptProcessorRef.current = null;
        }
        if(mediaStreamSourceRef.current) {
            mediaStreamSourceRef.current.disconnect();
            mediaStreamSourceRef.current = null;
        }
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close().catch(console.error);
        }
         if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
            outputAudioContextRef.current.close().catch(console.error);
        }
        onDialogueEnd(transcriptRef.current.full.join('\n'));
    }, [onDialogueEnd]);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout>;
        if (timeLeft > 0 && status === 'Connected') {
            timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
        } else if (timeLeft <= 0 && !isFinishingRef.current) {
            setIsFinishing(true);
            setStatus('Завершаем сессию...');
            
            scriptProcessorRef.current?.disconnect();
            
            sessionRef.current?.sendText('Time is up. Please say a brief, friendly goodbye now.');

            failsafeTimerRef.current = setTimeout(() => {
                console.warn("Failsafe timer triggered. Forcing session end.");
                finishSession();
            }, 8000); 
        }
        return () => clearTimeout(timer);
    }, [timeLeft, status, finishSession]);

    useEffect(() => {
        async function startSession() {
            const apiKey = import.meta.env.GEMINI_API_KEY;
            if (!apiKey) {
                setStatus('API Key is not configured. Please set GEMINI_API_KEY.');
                return;
            }

            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                setStatus('Connecting to AI...');

                const ai = new GoogleGenAI({ apiKey });
                
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                
                let nextStartTime = 0;

                const sessionPromise = ai.live.connect({
                    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                    config: {
                        responseModalities: [Modality.AUDIO],
                        inputAudioTranscription: {},
                        outputAudioTranscription: {},
                        systemInstruction: 'You are a friendly and patient English tutor. Start with a simple greeting and ask "How are you today?". Keep your responses concise.',
                    },
                    callbacks: {
                        onopen: () => {
                            setStatus('Connected');
                            mediaStreamSourceRef.current = audioContextRef.current!.createMediaStreamSource(stream);
                            scriptProcessorRef.current = audioContextRef.current!.createScriptProcessor(4096, 1, 1);
                            
                            scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                                const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                                const l = inputData.length;
                                const int16 = new Int16Array(l);
                                for (let i = 0; i < l; i++) {
                                    const s = Math.max(-1, Math.min(1, inputData[i]));
                                    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                                }
                                const pcmBlob: Blob = {
                                    data: encode(new Uint8Array(int16.buffer)),
                                    mimeType: 'audio/pcm;rate=16000',
                                };
                                sessionPromise.then((session) => {
                                    if (!isFinishingRef.current) session.sendRealtimeInput({ media: pcmBlob });
                                });
                            };
                            
                            mediaStreamSourceRef.current.connect(scriptProcessorRef.current);
                            scriptProcessorRef.current.connect(audioContextRef.current!.destination);
                        },
                        onmessage: async (message: LiveServerMessage) => {
                           if (message.serverContent?.inputTranscription) {
                                transcriptRef.current.input += message.serverContent.inputTranscription.text;
                           }
                           if (message.serverContent?.outputTranscription) {
                                transcriptRef.current.output += message.serverContent.outputTranscription.text;
                           }
                           if(message.serverContent?.turnComplete) {
                                const userInput = transcriptRef.current.input.trim();
                                const aiOutput = transcriptRef.current.output.trim();

                                if (userInput) {
                                    transcriptRef.current.full.push(`User: ${userInput}`);
                                    setTranscriptHistory(prev => [...prev, { speaker: 'User', text: userInput }]);
                                }
                                if (aiOutput) {
                                    transcriptRef.current.full.push(`AI: ${aiOutput}`);
                                    setTranscriptHistory(prev => [...prev, { speaker: 'AI', text: aiOutput }]);
                                }
                               
                               transcriptRef.current.input = '';
                               transcriptRef.current.output = '';

                               if(isFinishingRef.current && activeAudioSources.size === 0) {
                                   finishSession();
                               }
                           }

                            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                            if (audioData && outputAudioContextRef.current && outputAudioContextRef.current.state === 'running') {
                                nextStartTime = Math.max(nextStartTime, outputAudioContextRef.current.currentTime);
                                const audioBuffer = await decodeAudioData(decode(audioData), outputAudioContextRef.current, 24000, 1);
                                const source = outputAudioContextRef.current.createBufferSource();
                                source.buffer = audioBuffer;
                                source.connect(outputAudioContextRef.current.destination);
                                
                                source.addEventListener('ended', () => {
                                    activeAudioSources.delete(source)
                                    if(isFinishingRef.current && activeAudioSources.size === 0) {
                                        finishSession();
                                    }
                                });

                                source.start(nextStartTime);
                                nextStartTime += audioBuffer.duration;
                                activeAudioSources.add(source);
                            }
                        },
                        onclose: () => {
                             if (!isFinishingRef.current) setStatus('Connection closed.');
                        },
                        onerror: (e: ErrorEvent) => {
                             if (!isFinishingRef.current) setStatus(`Error: ${e.message}`);
                             finishSession();
                        },
                    },
                });

                sessionRef.current = await sessionPromise;

            } catch (error) {
                console.error("Failed to start dialogue session:", error);
                setStatus('Could not access microphone.');
            }
        }

        startSession();
        
        return () => {
            if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
            finishSession();
        };
    }, [finishSession]);

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-4">
            <div className="w-full max-w-md text-center">
                <div className="relative w-48 h-48 mx-auto flex items-center justify-center mb-8">
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
                        <circle className="text-gray-800" strokeWidth="5" stroke="currentColor" fill="transparent" r="45" cx="50" cy="50" />
                        <circle
                            className="text-cyan-500"
                            strokeWidth="5"
                            strokeDasharray={2 * Math.PI * 45}
                            strokeDashoffset={2 * Math.PI * 45 * (1 - (timeLeft / (DIALOGUE_DURATION_MS/1000)))}
                            strokeLinecap="round"
                            stroke="currentColor"
                            fill="transparent"
                            r="45"
                            cx="50"
                            cy="50"
                            style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%', transition: 'stroke-dashoffset 1s linear' }}
                        />
                    </svg>
                    <MicrophoneIcon className={`h-16 w-16 text-white transition-all duration-300 ${status === 'Connected' ? 'text-cyan-400 animate-pulse shadow-lg shadow-cyan-500/50' : ''}`} />
                </div>
                
                <h2 className="text-3xl font-bold mb-2">{`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`}</h2>
                <p className="text-lg text-gray-300">{status}</p>

                <TranscriptDisplay history={transcriptHistory} />

                {isFinishing && !hasFinishedRef.current && (
                    <div className="mt-6 text-xl animate-fade-in">
                        <p>Потрясающая работа! Готовим ваш фидбэк...</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Dialogue;