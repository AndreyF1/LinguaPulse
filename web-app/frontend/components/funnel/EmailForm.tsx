import React, { useState } from 'react';
import { supabase } from '../../supabaseClient';

interface EmailFormProps {
    onEmailSubmitted: () => void;
    onBackToPaywall: () => void;
    sessionId: string;
    transcript: string;
}

const EmailForm: React.FC<EmailFormProps> = ({ onEmailSubmitted, onBackToPaywall, sessionId, transcript }) => {
    const [email, setEmail] = useState('');
    const [isValid, setIsValid] = useState(true);
    const [isLoading, setIsLoading] = useState(false);
    const [isSent, setIsSent] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        
        if (!emailRegex.test(email)) {
            setIsValid(false);
            return;
        }
        
        setIsValid(true);
        setIsLoading(true);
        
        try {
            // Store sessionId to link it after user signs in
            localStorage.setItem('demo_session_id', sessionId);
            
            // Send magic link
            const { error } = await supabase.auth.signInWithOtp({
                email: email,
                options: {
                    emailRedirectTo: `${window.location.origin}/?view=demo-feedback`,
                }
            });
            
            if (error) {
                console.error('❌ Failed to send magic link:', error);
                alert('Не удалось отправить письмо. Попробуйте еще раз.');
                setIsLoading(false);
                return;
            }
            
            console.log('✅ Magic link sent to:', email);
            setIsSent(true);
            setIsLoading(false);
        } catch (err) {
            console.error('❌ Error sending magic link:', err);
            alert('Произошла ошибка. Попробуйте еще раз.');
            setIsLoading(false);
        }
    };

    // Success screen after sending magic link
    if (isSent) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-gray-900 p-4">
                <div className="w-full max-w-md bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl shadow-xl p-8 text-center">
                    <div className="text-6xl mb-6">✉️</div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-100 mb-4">Отчет отправлен!</h2>
                    <p className="text-gray-300 mb-2">
                        Мы отправили подробный фидбэк по вашему демо-уроку на:
                    </p>
                    <p className="text-cyan-400 font-semibold mb-6">{email}</p>
                    <p className="text-gray-400 text-sm mb-8">
                        Проверьте почту и перейдите по ссылке для доступа к отчету и регистрации.
                    </p>
                    
                    <button
                        onClick={onBackToPaywall}
                        className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-gray-500 transition-all duration-300"
                    >
                        Вернуться назад
                    </button>
                </div>
            </div>
        );
    }
    
    // Email input form
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
                        disabled={isLoading}
                    />
                    {!isValid && <p className="text-red-500 text-sm -mt-2">Пожалуйста, введите корректный email.</p>}
                    
                    <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-cyan-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-800 focus:ring-cyan-500 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isLoading ? 'Отправка...' : 'Получить фидбэк'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default EmailForm;