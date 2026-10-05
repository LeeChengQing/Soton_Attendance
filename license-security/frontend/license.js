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
