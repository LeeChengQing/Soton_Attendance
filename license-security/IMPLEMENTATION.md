# Complete implementation code

Read [the deployment and security guide](README.md) before integrating. These are the complete source modules, with no test fixtures or mock production data. Frontend table writes are replaced with a China Edge Function and an atomic SQL RPC because clients are untrusted.

## Step 1: China schema and atomic service-only RPCs

Source: [china/schema.sql](china/schema.sql)

```sql
-- Run once in the CHINA Auth project's SQL editor (or add to its migrations).
-- All clients are denied table/RPC access. Only backend service_role may use them.
begin;

-- Checkout creates this record on the server BEFORE redirecting to a provider.
-- Limits/price/expiry come from your server-side product catalog, never the buyer.
create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id text not null check (length(buyer_id) between 1 and 256),
  source text not null check (source in ('stripe', 'toyyibpay')),
  provider_order_id text not null check (length(provider_order_id) between 1 and 256),
  amount_minor integer not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  max_devices integer not null default 1 check (max_devices between 1 and 100),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, provider_order_id),
  unique (id, source)
);

create table public.license_keys (
  key uuid primary key default gen_random_uuid(),
  source text not null default 'card_network'
    check (source in ('card_network', 'stripe', 'toyyibpay')),
  max_devices integer not null default 1 check (max_devices between 1 and 100),
  bound_devices text[] not null default '{}'::text[],
  is_active boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  -- One order issues one license, regardless of webhook retries/event IDs.
  payment_order_id uuid unique,
  payment_reference text,
  foreign key (payment_order_id, source) references public.payment_orders(id, source),
  unique (source, payment_reference),
  check (
    (source = 'card_network' and payment_order_id is null and payment_reference is null)
    or (source in ('stripe', 'toyyibpay') and payment_order_id is not null
        and payment_reference is not null and length(payment_reference) between 1 and 256)
  ),
  check (cardinality(bound_devices) <= max_devices),
  check (array_position(bound_devices, null) is null),
  -- Shared quotas prevent multiplying the allowance across devices/Edge instances.
  requests_per_minute integer not null default 30 check (requests_per_minute > 0),
  requests_per_day integer not null default 1000 check (requests_per_day > 0),
  minute_started_at timestamptz not null default now(),
  minute_requests integer not null default 0 check (minute_requests >= 0),
  usage_day date not null default ((now() at time zone 'UTC')::date),
  day_requests integer not null default 0 check (day_requests >= 0)
);

alter table public.payment_orders enable row level security;
alter table public.license_keys enable row level security;
-- No anon/authenticated policies: default deny, even with leaked public keys.
revoke all on public.payment_orders, public.license_keys from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on public.payment_orders, public.license_keys to service_role;

create function public.bind_license_device(p_key uuid, p_device_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  license public.license_keys%rowtype;
begin
  if p_key is null or p_device_id is null then return 'forbidden'; end if;
  -- Lock first; concurrent requests cannot consume the same remaining slot.
  select * into license from public.license_keys where key = p_key for update;
  if not found or not license.is_active
     or (license.expires_at is not null and license.expires_at <= clock_timestamp()) then
    return 'forbidden';
  end if;
  if p_device_id::text = any(license.bound_devices) then return 'ok'; end if;
  if cardinality(license.bound_devices) >= license.max_devices then
    return 'maximum_devices';
  end if;
  update public.license_keys
    set bound_devices = array_append(bound_devices, p_device_id::text)
    where key = p_key;
  return 'ok';
end;
$$;

create function public.consume_license_request(p_key uuid, p_device_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare
  license public.license_keys%rowtype;
  current_time_utc timestamptz;
  current_day_utc date;
begin
  if p_key is null or p_device_id is null then return 'forbidden'; end if;
  select * into license from public.license_keys where key = p_key for update;
  current_time_utc := clock_timestamp();
  current_day_utc := (current_time_utc at time zone 'UTC')::date;
  if not found or not license.is_active
     or (license.expires_at is not null and license.expires_at <= current_time_utc)
     or not (p_device_id::text = any(license.bound_devices)) then
    return 'forbidden';
  end if;
  if current_time_utc >= license.minute_started_at + interval '1 minute' then
    license.minute_started_at := current_time_utc;
    license.minute_requests := 0;
  end if;
  if license.usage_day <> current_day_utc then
    license.usage_day := current_day_utc;
    license.day_requests := 0;
  end if;
  if license.minute_requests >= license.requests_per_minute
     or license.day_requests >= license.requests_per_day then return 'rate_limited'; end if;
  update public.license_keys set
    minute_started_at = license.minute_started_at,
    minute_requests = license.minute_requests + 1,
    usage_day = license.usage_day,
    day_requests = license.day_requests + 1
    where key = p_key;
  return 'ok';
end;
$$;

-- PostgreSQL functions otherwise inherit EXECUTE from PUBLIC by default.
revoke all on function public.bind_license_device(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_license_request(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bind_license_device(uuid, uuid) to service_role;
grant execute on function public.consume_license_request(uuid, uuid) to service_role;
commit;
```

## Step 2: Verified Stripe/ToyyibPay webhook handlers

Source: [lib/license-security/website/webhooks.js](../lib/license-security/website/webhooks.js)

```js
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { failure, HttpError, json, readJson, readText, UUID } from '../shared/http.js';

function minorUnits(value) {
  // Decimal strings -> exact integer cents; avoid floating-point price checks.
  if (typeof value !== 'string' || !/^\d{1,9}(?:\.\d{1,2})?$/.test(value)) throw new HttpError(409, 'payment_mismatch');
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new HttpError(409, 'payment_mismatch');
  return cents;
}

export function createPaymentWebhooks({ china, stripe, stripeWebhookSecret, stripeLiveMode, toyyibpaySecret, toyyibpaySandbox = false, fetch: fetchApi = fetch }) {
  if (!stripeWebhookSecret || !toyyibpaySecret || typeof stripeLiveMode !== 'boolean') throw new Error('Missing payment webhook server configuration');
  const toyUrl = toyyibpaySandbox
    ? 'https://dev.toyyibpay.com/index.php/api/getBillTransactions'
    : 'https://toyyibpay.com/index.php/api/getBillTransactions';

  async function loadOrder(source, providerOrderId) {
    const { data, error } = await china.from('payment_orders')
      .select('id,source,provider_order_id,amount_minor,currency,max_devices,expires_at')
      .eq('source', source).eq('provider_order_id', providerOrderId).maybeSingle();
    // Retry instead of acknowledging a payment before its local order exists.
    if (error || !data) throw new HttpError(503, 'order_not_available');
    if (data.source !== source || data.provider_order_id !== providerOrderId) throw new HttpError(409, 'payment_mismatch');
    return data;
  }

  async function issueLicense(order, reference) {
    if (typeof reference !== 'string' || reference.length < 1 || reference.length > 256) throw new HttpError(409, 'payment_mismatch');
    // Direct insertion into CHINA. ON CONFLICT DO NOTHING is deliberate:
    // replayed webhooks cannot reset bindings, expiry or a revoked license.
    const { error } = await china.from('license_keys').upsert({
      key: randomUUID(), source: order.source, max_devices: order.max_devices,
      bound_devices: [], is_active: true, expires_at: order.expires_at,
      payment_order_id: order.id, payment_reference: reference,
    }, { onConflict: 'payment_order_id', ignoreDuplicates: true });
    if (error) throw new HttpError(503, 'license_write_failed');
    // Another webhook instance may have won the insert. Always read the winner.
    const { data, error: readError } = await china.from('license_keys')
      .select('key,source,payment_reference').eq('payment_order_id', order.id).maybeSingle();
    if (readError || !data) throw new HttpError(503, 'license_write_failed');
    if (data.source !== order.source || data.payment_reference !== reference) throw new HttpError(409, 'payment_mismatch');
    // Do not send licenses in webhook responses. An authenticated website server
    // can deliver this key only to the buyer recorded on payment_orders.buyer_id.
    return data.key;
  }

  async function stripeWebhook(request) {
    try {
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      const rawBody = await readText(request, 262144);
      let event;
      try {
        // Verify the untouched body before any JSON parsing.
        event = stripe.webhooks.constructEvent(rawBody, request.headers.get('stripe-signature') ?? '', stripeWebhookSecret);
      } catch { throw new HttpError(400, 'invalid_signature'); }
      if (event.livemode !== stripeLiveMode) throw new HttpError(400, 'payment_environment_mismatch');
      if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
        return json({ received: true });
      }
      const session = event.data.object;
      // A completed checkout may still be unpaid for delayed payment methods.
      if (session.payment_status !== 'paid') return json({ received: true });
      if (session.mode !== 'payment' || typeof session.id !== 'string'
        || typeof session.payment_intent !== 'string') throw new HttpError(409, 'payment_mismatch');
      const order = await loadOrder('stripe', session.id);
      if (!Number.isSafeInteger(session.amount_total) || session.amount_total !== order.amount_minor
        || session.currency !== order.currency) throw new HttpError(409, 'payment_mismatch');
      await issueLicense(order, session.payment_intent);
      return json({ received: true });
    } catch (error) {
      // Any storage/network failure returns non-2xx so Stripe can retry.
      return failure(error);
    }
  }

  async function toyyibpayWebhook(request) {
    try {
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')) throw new HttpError(415, 'form_required');
      const fields = new URLSearchParams(await readText(request, 8192));
      const body = {};
      for (const name of ['status', 'order_id', 'refno', 'billcode', 'amount', 'hash']) {
        if (fields.getAll(name).length !== 1) throw new HttpError(400, 'invalid_callback');
        body[name] = fields.get(name);
        if (!body[name] || body[name].length > 256) throw new HttpError(400, 'invalid_callback');
      }
      if (!UUID.test(body.order_id) || !/^[0-9a-f]{32}$/i.test(body.hash)) throw new HttpError(400, 'invalid_callback');
      // Provider-prescribed callback verification; do not invent an HMAC format.
      const expected = createHash('md5')
        .update(toyyibpaySecret + body.status + body.order_id + body.refno + 'ok', 'utf8').digest();
      if (!timingSafeEqual(expected, Buffer.from(body.hash, 'hex'))) throw new HttpError(400, 'invalid_signature');
      if (body.status !== '1') return json({ received: true });

      const order = await loadOrder('toyyibpay', body.billcode);
      // amount and billcode are not protected by ToyyibPay's callback hash.
      if (body.order_id !== order.id || order.currency !== 'myr'
        || minorUnits(body.amount) !== order.amount_minor) throw new HttpError(409, 'payment_mismatch');
      let transactions;
      try {
        const response = await fetchApi(toyUrl, {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ billCode: order.provider_order_id, billpaymentStatus: '1' }),
        });
        if (!response.ok) { await response.body?.cancel(); throw new Error('Provider unavailable'); }
        transactions = await readJson(response, 262144);
      } catch { throw new HttpError(503, 'payment_verification_unavailable'); }
      if (!Array.isArray(transactions)) throw new HttpError(503, 'payment_verification_unavailable');
      const confirmed = transactions.filter(transaction => {
        if (String(transaction.billpaymentStatus) !== '1' || transaction.billExternalReferenceNo !== order.id
          || typeof transaction.billpaymentInvoiceNo !== 'string') return false;
        try { return minorUnits(transaction.billpaymentAmount) === order.amount_minor; } catch { return false; }
      });
      // Bills must be fixed-price, single-use. Ambiguous/missing records need
      // retry/reconciliation; never choose an unrelated transaction as evidence.
      if (confirmed.length !== 1) throw new HttpError(503, 'payment_not_confirmed');
      await issueLicense(order, confirmed[0].billpaymentInvoiceNo);
      return json({ received: true });
    } catch (error) {
      return failure(error);
    }
  }
  return { stripe: stripeWebhook, toyyibpay: toyyibpayWebhook };
}
```

## Step 2: Server environment initialization

Source: [lib/license-security/website/runtime.js](../lib/license-security/website/runtime.js)

```js
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
```

## Step 2: Stripe Next.js adapter

Source: [website/stripe-route.js](website/stripe-route.js)

```js
// Next.js App Router adapter; see README for placement/import paths.
import { paymentWebhooks } from './runtime.js';
export const runtime = 'nodejs';
export const POST = paymentWebhooks.stripe;
```

## Step 2: ToyyibPay Next.js adapter

Source: [website/toyyibpay-route.js](website/toyyibpay-route.js)

```js
import { paymentWebhooks } from './runtime.js';
export const runtime = 'nodejs';
export const POST = paymentWebhooks.toyyibpay;
```

## Steps 3 and 4: Two frontend clients, persistent device identity and activation

Source: [frontend/license.js](frontend/license.js)

```js
import { createClient as supabaseCreateClient } from '@supabase/supabase-js';
import { UUID } from '../shared/http.js';

// Call from trusted extension pages/service worker. Bundle locally for Chrome MV3.
// Configuration contains PUBLIC publishable/legacy anon keys, never service keys.
export function createLicenseFrontend(config, dependencies = {}) {
  const storage = dependencies.storage ?? chrome.storage.local;
  const locks = dependencies.locks ?? navigator.locks;
  const createClient = dependencies.createClient ?? supabaseCreateClient;
  if (!locks?.request) throw new Error('Web Locks are required for persistent device identity');
  for (const name of ['chinaUrl', 'businessUrl']) {
    if (new URL(config[name]).protocol !== 'https:') throw new Error('Supabase URLs must use HTTPS');
  }
  for (const name of ['chinaPublishableKey', 'businessPublishableKey']) {
    const key = config[name];
    let isPublic = typeof key === 'string' && key.startsWith('sb_publishable_');
    if (!isPublic && typeof key === 'string') {
      try {
        const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        isPublic = JSON.parse(atob(encoded)).role === 'anon';
      } catch { /* Reject non-publishable, non-anon keys. */ }
    }
    if (!isPublic) throw new Error('Use public Supabase API keys only');
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const supabaseAuth = createClient(config.chinaUrl, config.chinaPublishableKey, options);
  const supabaseBusiness = createClient(config.businessUrl, config.businessPublishableKey, options);
  const ready = storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  // Attach a rejection observer immediately; consumers still receive the failure.
  ready.catch(() => {});

  async function getDeviceId() {
    await ready;
    // Cross-context lock prevents popup/service-worker first-use races.
    return locks.request('license-device-id', async () => {
      const { deviceId } = await storage.get('deviceId');
      if (deviceId) {
        if (!UUID.test(deviceId)) throw new Error('Invalid stored device ID; restore storage or reactivate');
        return deviceId.toLowerCase();
      }
      const created = crypto.randomUUID();
      await storage.set({ deviceId: created });
      return created;
    });
  }

  async function invoke(client, name, options) {
    const { data, error } = await client.functions.invoke(name, { ...options, timeout: 75000 });
    if (error) {
      let code;
      if (error.context instanceof Response) {
        try { code = (await error.context.clone().json()).error; } catch { /* Network/HTML failure. */ }
      }
      const messages = {
        maximum_devices: 'Maximum devices reached',
        forbidden: 'License is invalid, expired, revoked, or not bound to this device',
        rate_limited: 'License usage limit reached; try again later',
      };
      throw new Error(messages[code] ?? 'License service unavailable; try again later', { cause: error });
    }
    return data;
  }

  async function activateLicense(inputKey) {
    try {
      const licenseKey = String(inputKey ?? '').trim().toLowerCase();
      if (!UUID.test(licenseKey)) throw new Error('Enter a valid UUID license key');
      const deviceId = await getDeviceId();
      // The China service checks existence/active status and appends atomically.
      // Browser table SELECT/UPDATE would expose keys and permit unsafe mutations.
      const data = await invoke(supabaseAuth, 'activate-license', { body: { licenseKey, deviceId } });
      if (data?.ok !== true) throw new Error('Invalid activation response');
      await storage.set({ licenseKey });
      return { licenseKey, deviceId };
    } catch (error) {
      // Failed activation never overwrites a previously working license.
      throw error instanceof Error ? error : new Error('Activation failed');
    }
  }

  async function callChatGPT(messages) {
    try {
      await ready;
      const { licenseKey } = await storage.get('licenseKey');
      if (!UUID.test(licenseKey ?? '')) throw new Error('Activate a license first');
      return await invoke(supabaseBusiness, 'chatgpt-proxy', {
        body: { messages },
        headers: { 'x-license-key': licenseKey.toLowerCase(), 'x-device-id': await getDeviceId() },
      });
    } catch (error) {
      throw error instanceof Error ? error : new Error('AI request failed');
    }
  }

  return { supabaseAuth, supabaseBusiness, getDeviceId, activateLicense, callChatGPT };
}
```

## Step 4: Supporting China activation handler

Source: [china/functions/activate-license/activate-license.ts](china/functions/activate-license/activate-license.ts)

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, failure, HttpError, json, readJson, UUID } from '../../../shared/http.js';

export function createActivationHandler(options: {
  china: Pick<SupabaseClient, 'rpc'>;
  allowedOrigins: Set<string>;
}) {
  return async (request: Request): Promise<Response> => {
    let headers = {};
    try {
      headers = corsHeaders(request, options.allowedOrigins);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'json_required');
      const body = await readJson(request, 1024);
      if (!body || typeof body.licenseKey !== 'string' || typeof body.deviceId !== 'string'
        || !UUID.test(body.licenseKey) || !UUID.test(body.deviceId)) throw new HttpError(403, 'forbidden');
      const { data, error } = await options.china.rpc('bind_license_device', {
        p_key: body.licenseKey.toLowerCase(), p_device_id: body.deviceId.toLowerCase(),
      });
      if (error) throw new HttpError(503, 'license_service_unavailable');
      if (data === 'maximum_devices') throw new HttpError(403, 'maximum_devices');
      if (data === 'forbidden') throw new HttpError(403, 'forbidden');
      if (data !== 'ok') throw new HttpError(503, 'license_service_unavailable');
      return json({ ok: true }, 200, headers);
    } catch (error) {
      return failure(error, headers);
    }
  };
}
```

## Step 4: China activation entry point

Source: [china/functions/activate-license/index.ts](china/functions/activate-license/index.ts)

```ts
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
```

## Step 5: Complete Global ChatGPT proxy handler

Source: [business/functions/chatgpt-proxy/chatgpt-proxy.ts](business/functions/chatgpt-proxy/chatgpt-proxy.ts)

```ts
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';
import { corsHeaders, failure, HttpError, json, readJson, UUID } from '../../../shared/http.js';

export function createChatgptProxy(options: {
  china: Pick<SupabaseClient, 'from' | 'rpc'>;
  apiKey: string;
  model: string;
  allowedOrigins: Set<string>;
  fetch?: typeof fetch;
}) {
  const fetchApi = options.fetch ?? fetch;
  return async (request: Request): Promise<Response> => {
    let headers = {};
    try {
      headers = corsHeaders(request, options.allowedOrigins);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');

      const licenseKey = request.headers.get('x-license-key')?.trim().toLowerCase() ?? '';
      const deviceId = request.headers.get('x-device-id')?.trim().toLowerCase() ?? '';
      if (!UUID.test(licenseKey) || !UUID.test(deviceId)) throw new HttpError(403, 'forbidden');

      // Ultimate authorization: query CHINA every time. Never trust local activation.
      const { data: license, error } = await options.china.from('license_keys')
        .select('is_active,bound_devices,expires_at').eq('key', licenseKey).maybeSingle();
      if (error) throw new HttpError(503, 'license_service_unavailable');
      if (!license || license.is_active !== true || !Array.isArray(license.bound_devices)
        || !license.bound_devices.includes(deviceId)
        || (license.expires_at !== null &&
          (!Number.isFinite(Date.parse(license.expires_at)) || Date.parse(license.expires_at) <= Date.now()))) {
        throw new HttpError(403, 'forbidden');
      }

      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, 'json_required');
      const body = await readJson(request, 32768);
      const messages = body?.messages;
      if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40
        || !messages.every(message => message && ['user', 'assistant'].includes(message.role)
          && typeof message.content === 'string' && message.content.length > 0 && message.content.length <= 16000)) {
        throw new HttpError(400, 'invalid_messages');
      }
      // Only recognized properties cross the trust boundary.
      const safeMessages = messages.map(({ role, content }) => ({ role, content }));

      // Revalidate under a row lock while reserving quota; catches revocation
      // between the initial read and consumption. No cross-instance memory counter.
      const { data: quota, error: quotaError } = await options.china.rpc('consume_license_request', {
        p_key: licenseKey, p_device_id: deviceId,
      });
      if (quotaError) throw new HttpError(503, 'license_service_unavailable');
      if (quota === 'forbidden') throw new HttpError(403, 'forbidden');
      if (quota === 'rate_limited') return json({ error: 'rate_limited' }, 429, { ...headers, 'retry-after': '60' });
      if (quota !== 'ok') throw new HttpError(503, 'license_service_unavailable');

      // Fixed URL and server-owned model/token cap prevent arbitrary proxying/costs.
      let result;
      try {
        const upstream = await fetchApi('https://api.openai.com/v1/chat/completions', {
          method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
          headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({ model: options.model, messages: safeMessages, max_completion_tokens: 1024, stream: false }),
        });
        if (!upstream.ok) {
          await upstream.body?.cancel();
          throw new HttpError(upstream.status === 429 ? 503 : 502, 'upstream_unavailable');
        }
        result = await readJson(upstream, 262144, 60000);
        if (!result || !Array.isArray(result.choices)) throw new HttpError(502, 'upstream_unavailable');
      } catch (error) {
        if (error instanceof HttpError && error.code === 'upstream_unavailable') throw error;
        throw new HttpError(502, 'upstream_unavailable');
      }
      return json(result, 200, headers);
    } catch (error) {
      return failure(error, headers);
    }
  };
}
```

## Step 5: Global proxy entry point

Source: [business/functions/chatgpt-proxy/index.ts](business/functions/chatgpt-proxy/index.ts)

```ts
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
```

## Shared HTTP validation, deadlines and errors

Source: [shared/http.js](shared/http.js)

```js
// Shared by Node webhook routes and Deno Edge Functions. No secrets or SDK state.
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers,
  } });
}

// Enforce actual bytes, including chunked bodies, and a deadline while reading.
export async function readText(message, maxBytes = 32768, timeoutMs = 10000) {
  if (!message.body) throw new HttpError(400, 'missing_body');
  const reader = message.body.getReader();
  const chunks = [];
  let total = 0;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(408, 'body_timeout')), timeoutMs);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new HttpError(413, 'body_too_large');
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readJson(message, maxBytes = 32768, timeoutMs = 10000) {
  const text = await readText(message, maxBytes, timeoutMs);
  try { return JSON.parse(text); } catch { throw new HttpError(400, 'invalid_json'); }
}

// CORS reduces unwanted browser access; it does not authenticate non-browser calls.
export function corsHeaders(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'forbidden');
  return {
    ...(origin ? { 'access-control-allow-origin': origin } : {}),
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-license-key, x-device-id',
    vary: 'Origin',
  };
}

export function failure(error, headers = {}) {
  const known = error instanceof HttpError;
  const status = known ? error.status : 503;
  const code = known ? error.code : 'service_unavailable';
  // Never log request bodies, headers, keys, raw SDK errors or upstream messages.
  if (status >= 500) console.error('License service failure:', code);
  return json({ error: code }, status, headers);
}

export function required(env, name) {
  const value = env(name)?.trim();
  if (!value) throw new Error(`Missing server configuration: ${name}`);
  return value;
}

export function origins(env) {
  return new Set(required(env, 'ALLOWED_ORIGINS').split(',').map(value => value.trim()).filter(Boolean));
}

export function timedFetch(timeoutMs) {
  return (url, init = {}) => fetch(url, { ...init, signal: init.signal
    ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs) });
}
```

## China gateway configuration

Source: [china/config.toml](china/config.toml)

```toml
[functions.activate-license]
# The license credential is verified by the handler, not a Supabase user JWT.
verify_jwt = false
```

## Global gateway configuration

Source: [business/config.toml](business/config.toml)

```toml
[functions.chatgpt-proxy]
# Custom license/device credentials are verified against China on every call.
verify_jwt = false
```
