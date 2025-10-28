import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { UserWithSessions, NewSessionData, LessonSession } from '../types';
import { supabase, SUPABASE_URL } from '../supabaseClient';
import type { User as SupabaseUser } from '@supabase/supabase-js';

interface UserContextType {
    currentUser: UserWithSessions | null;
    login: (email: string) => Promise<void>;
    logout: () => Promise<void>;
    addSessionToCurrentUser: (sessionData: NewSessionData) => Promise<void>;
    loading: boolean;
    authMessage: string | null;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentUser, setCurrentUser] = useState<UserWithSessions | null>(null);
    const [loading, setLoading] = useState(true);
    const [authMessage, setAuthMessage] = useState<string | null>(null);

    const fetchUserProfile = useCallback(async (supabaseUser: SupabaseUser): Promise<UserWithSessions | null> => {
        // Get JWT token
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError || !session) {
            throw new Error('Could not retrieve user session');
        }

        // Call Edge Function to get/create user profile and sessions
        const response = await fetch(`${SUPABASE_URL}/functions/v1/get-user`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to fetch user profile');
        }

        const { user, sessions } = await response.json();

        // Fallback username from email
        const displayUsername = user.username || supabaseUser.email?.split('@')[0] || 'User';

        return {
            ...user,
            username: displayUsername,
            sessions: (sessions as LessonSession[]) || [],
        };
    }, []);

    useEffect(() => {
        let isMounted = true;

        const initAuth = async () => {
            setLoading(true);
            
            try {
                // Check for existing session first
                const { data: { session } } = await supabase.auth.getSession();
                
                if (!isMounted) return;
                
                if (session?.user) {
                    const profile = await fetchUserProfile(session.user);
                    if (isMounted) {
                        setCurrentUser(profile);
                    }
                } else {
                    if (isMounted) {
                        setCurrentUser(null);
                    }
                }
            } catch (error: any) {
                console.error("Initial auth check error:", error);
                if (isMounted) {
                    setAuthMessage(error.message || "An authentication error occurred.");
                    setCurrentUser(null);
                }
            } finally {
                if (isMounted) {
                    setLoading(false);
                }
            }
        };

        // Initialize auth
        initAuth();

        // Listen for auth changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                if (!isMounted) return;
                
                try {
                    if (session?.user) {
                        const profile = await fetchUserProfile(session.user);
                        if (isMounted) {
                            setCurrentUser(profile);
                        }
                    } else {
                        if (isMounted) {
                            setCurrentUser(null);
                        }
                    }
                } catch (error: any) {
                    console.error("Auth state change error:", error);
                    if (isMounted) {
                        setAuthMessage(error.message || "An authentication error occurred.");
                        setCurrentUser(null);
                    }
                }
            }
        );

        return () => {
            isMounted = false;
            subscription.unsubscribe();
        };
    }, [fetchUserProfile]);


    const login = async (email: string) => {
        setLoading(true);
        setAuthMessage(null);
        try {
            const { error } = await supabase.auth.signInWithOtp({ 
                email,
                options: {
                    emailRedirectTo: window.location.origin,
                }
            });
            if (error) throw error;
            setAuthMessage('Check your email for the magic link!');
        } catch (error: any) {
            console.error("Login error:", error);
            setAuthMessage(error.error_description || error.message);
        } finally {
            setLoading(false);
        }
    };

    const logout = async () => {
        setLoading(true);
        await supabase.auth.signOut({ scope: 'global' });
        setCurrentUser(null);
        localStorage.removeItem('in-progress-session');
        setLoading(false);
    };

    const addSessionToCurrentUser = async (sessionData: NewSessionData) => {
        if (!currentUser) {
            throw new Error("Cannot add session: no user is logged in.");
        }

        try {
            console.log('🔐 Getting auth session...');
            // Get JWT token
            const { data: { session }, error: sessionError } = await supabase.auth.getSession();
            if (sessionError || !session) {
                console.error('❌ Session error:', sessionError);
                throw new Error('Could not retrieve user session');
            }
            console.log('✅ Auth session retrieved');

            // Call Edge Function to save session
            console.log('📡 Calling save-session Edge Function...');
            const requestUrl = `${SUPABASE_URL}/functions/v1/save-session`;
            console.log('  URL:', requestUrl);
            console.log('  Session data keys:', Object.keys(sessionData));
            
            const response = await fetch(requestUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sessionData }),
            });

            console.log('📬 Response received:', response.status, response.statusText);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Response error:', errorText);
                let errorMessage = 'Failed to save session';
                try {
                    const errorJson = JSON.parse(errorText);
                    errorMessage = errorJson.error || errorMessage;
                } catch {
                    errorMessage = errorText || errorMessage;
                }
                throw new Error(errorMessage);
            }

            const responseData = await response.json();
            console.log('✅ Session saved successfully:', responseData.session?.id);

            const { session: newSession, sessions: allSessions } = responseData;

            // Update local state with fresh sessions list
            setCurrentUser(prevUser => {
                if (!prevUser) return null;
                return { ...prevUser, sessions: (allSessions as LessonSession[]) || [] };
            });

        } catch (error: any) {
            console.error("Error saving session:", error);
            throw error;
        }
    };

    return (
        <UserContext.Provider value={{ currentUser, login, logout, addSessionToCurrentUser, loading, authMessage }}>
            {children}
        </UserContext.Provider>
    );
};

export const useUser = (): UserContextType => {
    const context = useContext(UserContext);
    if (context === undefined) {
        throw new Error('useUser must be used within a UserProvider');
    }
    return context;
};