import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Supabase Project Settings -> API
const SUPABASE_URL = "sb_publishable_Sro0yq_dKmWTIxAnqULt5A_xbXun7O3";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB4ZnJ5c3Nmdndkemdia2dyY3VkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MjIwMzksImV4cCI6MjA5MzE5ODAzOX0.S__p_B4G63ifd64FsHOR9MlRpulSRLMbSvYdbnNhEUQ";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
