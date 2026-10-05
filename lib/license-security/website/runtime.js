// SERVER ONLY. Import this module from Next.js route handlers, never browser code.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { createPaymentWebhooks } from './webhooks.js';
import { required, timedFetch } from '../shared/http.js';

const env = name => process.env[name];
const live = required(env, 'STRIPE_LIVE_MODE');
if (!['true', 'false'].includes(live)) throw new Error('STRIPE_LIVE_MODE must be true or false');
const sandbox = required(env, 'TOYYIBPAY_SANDBOX');
if (!['true', 'false'].includes(sandbox)) throw new Error('TOYYIBPAY_SANDBOX must be true or false');
const china = createClient(required(env, 'CHINA_SUPABASE_URL'), required(env, 'CHINA_SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: timedFetch(10000) },
});
export const paymentWebhooks = createPaymentWebhooks({
  china,
  stripe: new Stripe(required(env, 'STRIPE_SECRET_KEY')),
  stripeWebhookSecret: required(env, 'STRIPE_WEBHOOK_SECRET'),
  stripeLiveMode: live === 'true',
  toyyibpaySecret: required(env, 'TOYYIBPAY_USER_SECRET_KEY'),
  toyyibpaySandbox: sandbox === 'true',
});
