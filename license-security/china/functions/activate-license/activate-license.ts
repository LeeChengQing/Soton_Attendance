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
