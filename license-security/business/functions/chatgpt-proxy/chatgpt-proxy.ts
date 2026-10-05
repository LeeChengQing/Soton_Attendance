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
