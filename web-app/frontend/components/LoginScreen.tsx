import React, { useState } from 'react';
import { useUser } from '../contexts/UserContext';

const LoginScreen: React.FC = () => {
    const [email, setEmail] = useState('');
    const { login, loading, authMessage } = useUser();

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (email.trim()) {
            login(email.trim());
        }
    };

    const isSuccessMessage = authMessage && authMessage.toLowerCase().includes('check your email');

    return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-900 text-gray-100 font-sans">
            <div className="w-full max-w-md p-8 space-y-8 bg-gray-800 rounded-lg shadow-lg border border-gray-700">
                <div className="text-center">
                    <h1 className="text-4xl font-bold text-cyan-400">LinguaPulse</h1>
                    <p className="mt-2 text-gray-400">Welcome! Please enter your email to sign in or sign up.</p>
                </div>
                
                {!isSuccessMessage && (
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

                {authMessage && (
                    <div className={`text-center p-3 rounded-md mt-4 ${isSuccessMessage ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
                        <p>{authMessage}</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoginScreen;