import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

function readConfig() {
  const runtimeUrl =
    globalThis?.__ALEVICHAT_CONFIG__?.SUPABASE_URL ||
    document.querySelector('meta[name="supabase-url"]')?.content ||
    "";
  const runtimeAnonKey =
    globalThis?.__ALEVICHAT_CONFIG__?.SUPABASE_ANON_KEY ||
    document.querySelector('meta[name="supabase-anon-key"]')?.content ||
    "";

  const SUPABASE_URL = String(runtimeUrl).trim();
  const SUPABASE_ANON_KEY = String(runtimeAnonKey).trim();

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase config eksik. index.html içinde __ALEVICHAT_CONFIG__ veya meta supabase-url/supabase-anon-key tanımlayın."
    );
  }
  return { SUPABASE_URL, SUPABASE_ANON_KEY };
}

const { SUPABASE_URL, SUPABASE_ANON_KEY } = readConfig();

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
  global: {
    headers: {
      "x-client-info": "alevichat-web",
    },
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});
