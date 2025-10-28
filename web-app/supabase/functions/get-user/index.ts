// Edge Function: get-user
// Gets or creates user profile with their lesson sessions

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Get user JWT from request
    const authHeader = req.headers.get('Authorization')!
    const token = authHeader.replace('Bearer ', '')

    // Verify JWT and get user
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)
    
    if (authError || !user) {
      throw new Error('Unauthorized')
    }

    // Check if user exists in users table
    const { data: existingUser, error: fetchError } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single()

    let userProfile = existingUser

    // If user doesn't exist, create them
    if (fetchError?.code === 'PGRST116') { // No rows found
      const newUsername = user.email!.split('@')[0]
      
      const { data: newUser, error: insertError } = await supabaseAdmin
        .from('users')
        .insert({
          id: user.id,
          username: newUsername,
          email: user.email,
          auth_provider: 'magic_link',
          email_verified: !!user.email_confirmed_at,
          lessons_left: 0,
          total_lessons_completed: 0,
          current_streak: 0,
          onboarding_completed: false,
        })
        .select()
        .single()

      if (insertError) {
        throw new Error(`Error creating user: ${insertError.message}`)
      }

      userProfile = newUser
    } else if (fetchError) {
      throw new Error(`Error fetching user: ${fetchError.message}`)
    }

    // Fetch user's lesson sessions
    const { data: sessions, error: sessionsError } = await supabaseAdmin
      .from('lesson_sessions')
      .select('*')
      .eq('user_id', userProfile.id)
      .order('created_at', { ascending: false })

    if (sessionsError) {
      console.error('Error fetching sessions:', sessionsError)
      // Continue without sessions rather than failing
    }

    return new Response(
      JSON.stringify({
        user: userProfile,
        sessions: sessions || []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      },
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      },
    )
  }
})

