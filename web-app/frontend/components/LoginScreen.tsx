import React, { useState, useEffect } from 'react';
import { useUser } from '../contexts/UserContext';
import { supabase } from '../supabaseClient';

const LoginScreen: React.FC = () => {
    const [email, setEmail] = useState('');
    const [isWaitingForAuth, setIsWaitingForAuth] = useState(false);
    const { login, loading, authMessage } = useUser();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email.trim()) {
            login(email.trim());
            setIsWaitingForAuth(true);
        }
    };

    // Auto-detect when user clicks magic link (even in another tab)
    useEffect(() => {
        if (!isWaitingForAuth) return;

        // Poll for auth state every 2 seconds
        const interval = setInterval(async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                // User authenticated! The UserContext will handle the rest
                setIsWaitingForAuth(false);
                clearInterval(interval);
            }
        }, 2000);

        // Cleanup: stop polling after 10 minutes
        const timeout = setTimeout(() => {
            clearInterval(interval);
            setIsWaitingForAuth(false);
        }, 10 * 60 * 1000);

        return () => {
            clearInterval(interval);
            clearTimeout(timeout);
        };
    }, [isWaitingForAuth]);

    const isSuccessMessage = authMessage && authMessage.toLowerCase().includes('check your email');

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-gray-100 font-sans">
            <div className="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-lg shadow-lg border border-gray-700">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-cyan-400">LinguaPulse</h1>
                    <p className="mt-2 text-gray-400">
                        {isWaitingForAuth 
                            ? 'Waiting for you to click the magic link...' 
                            : 'Welcome! Please enter your email to sign in or sign up.'}
                    </p>
                </div>
                
                {!isSuccessMessage && !isWaitingForAuth && (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="email" className="sr-only">Email address</label>
                            <input
                                id="email"
                                name="email"
                                type="email"
                                autoComplete="email"
                                required
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="relative block w-full px-3 py-3 border border-gray-600 bg-gray-900 placeholder-gray-500 text-white rounded-md focus:outline-none focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm"
                                placeholder="Your Email Address"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-cyan-500 focus:ring-offset-gray-900 transition-colors disabled:bg-cyan-800 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Sending...' : 'Send Magic Link'}
                        </button>
                    </form>
                )}

                {isWaitingForAuth && (
                    <div className="space-y-6">
                        {/* Email sent confirmation */}
                        <div className="text-center p-4 rounded-md bg-green-900/50 text-green-300">
                            <p className="font-semibold">📧 Check your email!</p>
                            <p className="text-sm mt-1">We sent a magic link to <span className="font-mono">{email}</span></p>
                        </div>

                        {/* Animated waiting indicator */}
                        <div className="flex flex-col items-center justify-center space-y-4 py-8">
                            <div className="relative">
                                <div className="w-16 h-16 border-4 border-cyan-600 border-t-transparent rounded-full animate-spin"></div>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="w-8 h-8 bg-cyan-500 rounded-full animate-pulse"></div>
                                </div>
                            </div>
                            <p className="text-gray-400 text-sm animate-pulse">
                                This page will automatically update when you click the link
                            </p>
                        </div>

                        {/* Tips */}
                        <div className="text-xs text-gray-500 space-y-2 border-t border-gray-700 pt-4">
                            <p>💡 <span className="text-gray-400">Tip: Check your spam folder if you don't see the email</span></p>
                            <p>🔗 <span className="text-gray-400">The link works in any tab or device</span></p>
                        </div>

                        {/* Resend option */}
                        <button
                            onClick={() => {
                                setIsWaitingForAuth(false);
                                setEmail('');
                            }}
                            className="w-full text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Use a different email
                        </button>
                    </div>
                )}

                {authMessage && !isWaitingForAuth && !isSuccessMessage && (
                    <div className="text-center p-3 rounded-md mt-4 bg-red-900/50 text-red-300">
                        <p>{authMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoginScreen;