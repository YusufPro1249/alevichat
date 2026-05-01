import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "sb_publishable_Sro0yq_dKmWTIxAnqULt5A_xbXun7O3";
const SUPABASE_ANON_KEY = "sb_secret_fordfy0xiwmeHHtfHWhthA_6HTvVpck";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
