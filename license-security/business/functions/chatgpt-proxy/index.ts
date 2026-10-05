import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createChatgptProxy } from './chatgpt-proxy.ts';
import { origins, required, timedFetch } from '../../../shared/http.js';

const env = (name: string) => Deno.env.get(name);
// These CHINA credentials are server secrets in the GLOBAL project's runtime.
const china = createClient(required(env, 'CHINA_SUPABASE_URL'), required(env, 'CHINA_SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch(10000) },
});
Deno.serve(createChatgptProxy({
  china, apiKey: required(env, 'OPENAI_API_KEY'), model: required(env, 'OPENAI_MODEL'), allowedOrigins: origins(env),
}));
