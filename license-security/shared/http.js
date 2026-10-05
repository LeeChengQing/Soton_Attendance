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
