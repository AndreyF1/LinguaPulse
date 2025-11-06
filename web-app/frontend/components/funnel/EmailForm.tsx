import React, { useState } from 'react';

interface EmailFormProps {
    onEmailSubmitted: () => void;
    anonymUserId: string;
    transcript: string;
}

const EmailForm: React.FC<EmailFormProps> = ({ onEmailSubmitted, anonymUserId, transcript }) => {
    const [email, setEmail] = useState('');
    const [isValid, setIsValid] = useState(true);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(email)) {
            setIsValid(true);
            // TODO: Save to Supabase (create user via magic link + link anonym_user_id)
            // For now, just store email in localStorage and continue
            localStorage.setItem('pending_email', email);
            console.log('📧 Email captured:', email, 'for anonym user:', anonymUserId);
            console.log('📝 Transcript length:', transcript.length);
            onEmailSubmitted();
        } else {
            setIsValid(false);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
            <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl p-8 text-center">
                <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 mb-4">Диалог завершен!</h2>
                <p className="text-gray-400 mb-8">Введите ваш email, чтобы мы прислали подробный фидбэк по вашей речи и рекомендации.</p>
                
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => {
                            setEmail(e.target.value);
                            if (!isValid) setIsValid(true);
                        }}
                        placeholder="your.email@example.com"
                        className={`w-full px-4 py-3 border-2 rounded-lg text-lg focus:outline-none focus:ring-2 transition-all bg-gray-700 text-gray-200 ${
                            isValid ? 'border-gray-600 focus:border-cyan-500 focus:ring-cyan-500/50' : 'border-red-500 focus:border-red-500 focus:ring-red-500/50'
                        }`}
                        required
                    />
                    {!isValid && <p className="text-red-500 text-sm -mt-2">Пожалуйста, введите корректный email.</p>}
                    
                    <button
                        type="submit"
                        className="w-full bg-cyan-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-500 transition-all duration-300"
                    >
                        Получить фидбэк
                    </button>
                </form>
            </div>
        </div>
    );
};

export default EmailForm;