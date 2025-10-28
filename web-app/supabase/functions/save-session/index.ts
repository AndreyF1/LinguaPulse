// Edge Function: save-session
// Saves a completed lesson session for authenticated user

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
    // Create Supabase client with service role
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

    // Parse request body
    const { sessionData } = await req.json()

    // Validate required fields
    if (!sessionData || !sessionData.scenario_title || !sessionData.transcript) {
      throw new Error('Missing required session data')
    }

    // Insert session with user_id
    const { data: newSession, error: insertError } = await supabaseAdmin
      .from('lesson_sessions')
      .insert({
        user_id: user.id,
        scenario_title: sessionData.scenario_title,
        difficulty: sessionData.difficulty || 'intermediate',
        transcript: sessionData.transcript,
        scores: sessionData.scores,
        feedback_text: sessionData.feedback_text,
      })
      .select()
      .single()

    if (insertError) {
      throw new Error(`Error saving session: ${insertError.message}`)
    }

    // Fetch updated list of all user sessions
    const { data: allSessions, error: fetchError } = await supabaseAdmin
      .from('lesson_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })

    if (fetchError) {
      console.error('Error fetching sessions:', fetchError)
      // Return just the new session if we can't fetch all
      return new Response(
        JSON.stringify({ session: newSession, sessions: [newSession] }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        },
      )
    }

    return new Response(
      JSON.stringify({ 
        session: newSession,
        sessions: allSessions 
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

