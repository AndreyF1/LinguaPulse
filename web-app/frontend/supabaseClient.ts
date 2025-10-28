
import { createClient } from '@supabase/supabase-js';

// --- PASTE YOUR SUPABASE CREDENTIALS HERE FOR LOCAL DEVELOPMENT ---
// You can get these from your Supabase project's dashboard under Settings > API.
// IMPORTANT: Do NOT commit these keys to a public git repository.

// The Supabase URL for your project.
export const SUPABASE_URL = 'https://qpqwyvzpwwwyolnvtglw.supabase.co';

// The `anon` key for your project. This key is safe to use in a browser.
// It should be a very long string of random characters.
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwcXd5dnpwd3d3eW9sbnZ0Z2x3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY0ODc4NzksImV4cCI6MjA3MjA2Mzg3OX0.7d8HoIu_-hD4VxUnWerXmik19aVl8YeUpb45A08O698';

// Explicitly configure the client for robust session management.
// This helps prevent session loss on tab switching and ensures clean state.
export const supabase = createClient(SUPABASE_URL, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
    },
});