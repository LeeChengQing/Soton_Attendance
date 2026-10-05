import { createChatgptProxy } from '../business/functions/chatgpt-proxy/chatgpt-proxy.ts';
import { createActivationHandler } from '../china/functions/activate-license/activate-license.ts';

const key = '11111111-1111-4111-8111-111111111111';
const device = '22222222-2222-4222-8222-222222222222';
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function request(headers: Record<string, string> = {}, body: unknown = { messages: [{ role: 'user', content: 'Hello' }] }) {
  return new Request('https://global.example.com/functions/v1/chatgpt-proxy', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-license-key': key, 'x-device-id': device, ...headers }, body: JSON.stringify(body),
  });
}
function harness({ row = { is_active: true, bound_devices: [device], expires_at: null }, dbError = false, quota = 'ok', upstreamStatus = 200 }: {
  row?: { is_active: boolean; bound_devices: string[]; expires_at: string | null };
  dbError?: boolean; quota?: string; upstreamStatus?: number;
} = {}) {
  let calls = 0;
  let payload: Record<string, unknown> = {};
  // External boundary doubles; the production handler and its validation are real.
  const china = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: dbError ? { code: 'offline' } : null }) }) }) }),
    rpc: async () => ({ data: quota, error: dbError ? { code: 'offline' } : null }),
  };
  const handler = createChatgptProxy({
    china: china as never, model: 'server-model', apiKey: 'server-only-secret', allowedOrigins: new Set(['chrome-extension://trusted']),
    fetch: async (_url, init) => {
      calls++;
      const headers = new Headers(init?.headers);
      equal(headers.get('x-license-key'), null);
      equal(headers.get('authorization'), 'Bearer server-only-secret');
      payload = JSON.parse(init?.body as string);
      return Response.json({ choices: [{ message: { content: 'Hi' } }] }, { status: upstreamStatus });
    },
  });
  return { handler, calls: () => calls, payload: () => payload };
}

Deno.test('revoked, expired, unbound and missing license headers never invoke OpenAI', async () => {
  for (const row of [
    { is_active: false, bound_devices: [device], expires_at: null },
    { is_active: true, bound_devices: [], expires_at: null },
    { is_active: true, bound_devices: [device], expires_at: '2000-01-01T00:00:00Z' },
  ]) {
    const h = harness({ row });
    equal((await h.handler(request())).status, 403);
    equal(h.calls(), 0);
  }
  const h = harness();
  equal((await h.handler(request({ 'x-license-key': '' }))).status, 403);
  equal(h.calls(), 0);
});
Deno.test('China outage fails closed, quota rejects before upstream execution', async () => {
  const offline = harness({ dbError: true });
  equal((await offline.handler(request())).status, 503);
  equal(offline.calls(), 0);
  const limited = harness({ quota: 'rate_limited' });
  equal((await limited.handler(request())).status, 429);
  equal(limited.calls(), 0);
  const revoked = harness({ quota: 'forbidden' });
  equal((await revoked.handler(request())).status, 403);
  equal(revoked.calls(), 0);
});
Deno.test('client cannot select a model, streaming or arbitrary OpenAI options', async () => {
  const h = harness();
  const response = await h.handler(request({}, { messages: [{ role: 'user', content: 'Hello' }], model: 'expensive', stream: true, max_completion_tokens: 999999 }));
  equal(response.status, 200);
  equal(h.payload(), { model: 'server-model', messages: [{ role: 'user', content: 'Hello' }], max_completion_tokens: 1024, stream: false });
  equal((await response.json()).choices[0].message.content, 'Hi');
});
Deno.test('invalid payload, unsupported method and disallowed origin fail early', async () => {
  const h = harness();
  equal((await h.handler(request({}, { messages: [] }))).status, 400);
  equal((await h.handler(request({ origin: 'https://attacker.example' }))).status, 403);
  equal((await h.handler(new Request('https://global.example.com', { method: 'GET' }))).status, 405);
  equal((await h.handler(request({}, { messages: [{ role: 'user', content: 'x'.repeat(40000) }] }))).status, 413);
  equal(h.calls(), 0);
});
Deno.test('upstream failures are sanitized and preflight permits custom headers', async () => {
  const h = harness({ upstreamStatus: 500 });
  const failed = await h.handler(request());
  equal(failed.status, 502);
  equal(await failed.json(), { error: 'upstream_unavailable' });
  const preflight = await h.handler(new Request('https://global.example.com', { method: 'OPTIONS', headers: { origin: 'chrome-extension://trusted' } }));
  equal(preflight.status, 204);
  if (!preflight.headers.get('access-control-allow-headers')?.includes('x-device-id')) throw new Error('Missing CORS header');
});
Deno.test('activation accepts only validated RPC status and maps device limit errors', async () => {
  for (const [result, expected] of [['ok', 200], ['maximum_devices', 403], ['forbidden', 403], ['unexpected', 503]] as const) {
    const handler = createActivationHandler({ china: { rpc: async () => ({ data: result, error: null }) } as never, allowedOrigins: new Set() });
    const response = await handler(request({}, { licenseKey: key, deviceId: device }));
    equal(response.status, expected);
  }
});
