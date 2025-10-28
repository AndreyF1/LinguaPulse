import React, { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { UserWithSessions, NewSessionData, LessonSession } from '../types';
import { supabase } from '../supabaseClient';
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
        // 1. Fetch user from users table
        const { data: userData, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('id', supabaseUser.id)
            .single();

        if (userError && userError.code !== 'PGRST116') { // PGRST116: no rows found
            throw new Error(`Error fetching user: ${userError.message}. Check your RLS policies for the 'users' table.`);
        }

        let user = userData;

        // 2. If user doesn't exist in users table, create it
        if (!user) {
            const newUsername = supabaseUser.email!.split('@')[0];
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({
                    id: supabaseUser.id,
                    username: newUsername,
                    email: supabaseUser.email,
                    auth_provider: 'magic_link' as const,
                    email_verified: !!supabaseUser.email_confirmed_at,
                    lessons_left: 0,
                    total_lessons_completed: 0,
                    current_streak: 0,
                    onboarding_completed: false,
                })
                .select()
                .single();

            if (insertError) {
                throw new Error(`Error creating user: ${insertError.message}. Check your RLS policies for the 'users' table.`);
            }
            user = newUser;
        }
        
        // 3. Fetch user lesson sessions from the 'lesson_sessions' table
        const { data: sessionsData, error: sessionsError } = await supabase
            .from('lesson_sessions')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (sessionsError) {
             console.error(`Error fetching lesson sessions: ${sessionsError.message}. Check your RLS policies.`);
             // We can still continue without sessions
        }

        // Fallback username from email
        const displayUsername = user.username || supabaseUser.email?.split('@')[0] || 'User';

        return {
            ...user,
            username: displayUsername,
            sessions: (sessionsData as LessonSession[]) || [],
        };
    }, []);

    useEffect(() => {
        setLoading(true);

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (event, session) => {
                try {
                    if (session?.user) {
                        const profile = await fetchUserProfile(session.user);
                        setCurrentUser(profile);
                    } else {
                        setCurrentUser(null);
                    }
                } catch (error: any) {
                    console.error("Auth state change error:", error);
                    setAuthMessage(error.message || "An authentication error occurred.");
                    setCurrentUser(null);
                } finally {
                    setLoading(false);
                }
            }
        );

        return () => {
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
            // Save session directly to Supabase (RLS policies will handle security)
            const { data: newSession, error: insertError } = await supabase
                .from('lesson_sessions')
                .insert({
                    ...sessionData,
                    user_id: currentUser.id,
                })
                .select()
                .single();

            if (insertError) {
                console.error('Error inserting session:', insertError);
                throw new Error(insertError.message || 'Failed to save session');
            }

            console.log("Session saved successfully:", newSession.id);

            // Update local state by refetching all sessions
            const { data: refreshedSessions, error: selectError } = await supabase
                .from('lesson_sessions')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });

            if (selectError) {
                console.error(`Session was saved, but failed to refetch: ${selectError.message}`);
            } else {
                // Update the local state with the fresh list of sessions
                setCurrentUser(prevUser => {
                    if (!prevUser) return null;
                    return { ...prevUser, sessions: (refreshedSessions as LessonSession[]) || [] };
                });
            }
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