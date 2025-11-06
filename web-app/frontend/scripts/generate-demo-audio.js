/**
 * Script to generate and save demo audio responses
 * Run: node scripts/generate-demo-audio.js
 */

import { GoogleGenAI } from '@google/genai';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RESPONSES = [
    {
        text: "That's great to hear! How are you doing today?",
        filename: 'demo-response1.base64'
    },
    {
        text: "I'm so glad to hear that! It was a pleasure to meet you. I hope to see you in our lessons where I can help you become a true pro in English.",
        filename: 'demo-response2.base64'
    }
];

async function generateAudio() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('❌ GEMINI_API_KEY not set');
        process.exit(1);
    }

    const ai = new GoogleGenAI({ apiKey });
    
    for (const response of RESPONSES) {
        console.log(`🎤 Generating: ${response.text.substring(0, 50)}...`);
        
        try {
            const result = await ai.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: response.text }] }],
                config: {
                    responseModalities: ['AUDIO'],
                    speechConfig: { 
                        voiceConfig: { 
                            prebuiltVoiceConfig: { voiceName: 'Kore' } 
                        } 
                    }
                }
            });
            
            const base64Audio = result.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (!base64Audio) {
                throw new Error('No audio data received');
            }
            
            const outputPath = join(__dirname, '..', 'public', response.filename);
            writeFileSync(outputPath, base64Audio, 'utf8');
            
            console.log(`✅ Saved: ${response.filename} (${Math.round(base64Audio.length / 1024)}KB)`);
        } catch (error) {
            console.error(`❌ Failed to generate ${response.filename}:`, error.message);
        }
    }
    
    console.log('\n✨ Done! Audio files saved to public/');
    console.log('These files will be served instantly to all users via CDN.');
}

generateAudio();

