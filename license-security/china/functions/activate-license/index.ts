import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createActivationHandler } from './activate-license.ts';
import { origins, required, timedFetch } from '../../../shared/http.js';

const env = (name: string) => Deno.env.get(name);
// Built-in keys are available only inside the China project's Edge runtime.
const china = createClient(required(env, 'SUPABASE_URL'), required(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch(10000) },
});
Deno.serve(createActivationHandler({ china, allowedOrigins: origins(env) }));
