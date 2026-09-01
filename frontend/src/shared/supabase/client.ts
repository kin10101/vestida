import { createClient } from '@supabase/supabase-js'

// Supabase connection.
//
// Uses the publishable key (sb_publishable_...) so Row Level Security must
// scope data per user/store. Values come from `frontend/.env.local`.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string

export const supabase = createClient(supabaseUrl, supabaseKey)
