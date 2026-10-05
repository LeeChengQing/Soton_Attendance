import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashActivationKey, normalizeActivationKey } from "../_shared/activation.ts";
import {normalizeSchedules,validateEvent} from "../_shared/validation.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function bearer(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function randomHex(bytes = 24) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function recoveryCode() {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const sample = new Uint32Array(1);
  do crypto.getRandomValues(sample); while (sample[0] >= limit);
  return String(sample[0] % 1_000_000).padStart(6, "0");
}

async function recoveryCodeHmac(code: string) {
  const secret = Deno.env.get("ATTENDANCE_SCHEDULER_SECRET") ?? "";
  if (secret.length < 32) throw Error("recovery_secret_unavailable");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`soton-phone-recovery:v1:${code}`),
  );
  return [...new Uint8Array(signature)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function ensureNtfyTopic(deviceId: string) {
  const existing = await db.from("push_subscriptions").select("provider_token")
    .eq("device_id", deviceId).eq("provider", "ntfy").eq("enabled", true).maybeSingle();
  if(existing.error) throw existing.error;
  if (existing.data?.provider_token) return existing.data.provider_token;
  throw Error('device_topic_missing_contact_support');
}

async function deviceForToken(token: string) {
  if (!token) return null;
  const hash = await sha256(token);
  const direct = await db.from("devices").select("id,device_key,device_name").eq("auth_token_hash", hash).maybeSingle();
  if(direct.error) throw direct.error;
  return direct.data ?? null;
}

async function registerDevice(input: Record<string, unknown>,request: Request) {
  const deviceKey = typeof input.deviceKey === "string" ? input.deviceKey.trim() : "";
  if (deviceKey.length < 8 || deviceKey.length > 160) return response({ error: "invalid_device_key" }, 400);
  const proof=bearer(request);
  if(proof&&!/^[a-f0-9]{64}$/.test(proof)) return response({error:'invalid_registration_proof'},400);
  const deviceToken = proof||randomHex(32);
  const {data,error}=await db.rpc('register_attendance_device',{p_key:deviceKey,p_name:typeof input.deviceName==='string'?input.deviceName.slice(0,100):null,p_token_hash:await sha256(deviceToken),p_topic:`soton-attendance-${randomHex(20)}`});
  if(error||!data) return response({error:'device_register_failed'},500);
  if(data.error) return response({error:data.error},409);
  return response({...data,deviceToken});
}

async function getNtfyTopic(request: Request) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  return response({ ntfyTopic: await ensureNtfyTopic(device.id) });
}

async function entitlementStatus(request: Request) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);

  const { data, error } = await db.from("entitlements")
    .select("plan,status,phone_notifications,starts_at,expires_at")
    .eq("device_id", device.id)
    .maybeSingle();
  if (error) return response({ error: "entitlement_status_failed" }, 500);
  if (!data) return response({ entitlement: null });

  let status = data.status;
  if (status === "active") {
    const now = Date.now();
    const startsAt = Date.parse(data.starts_at);
    const expiresAt = Date.parse(data.expires_at);
    if (Number.isFinite(expiresAt) && expiresAt <= now) status = "expired";
    else if (Number.isFinite(startsAt) && startsAt > now) status = "pending";
  }

  return response({
    entitlement: {
      plan: data.plan,
      status,
      phoneNotifications: data.phone_notifications === true,
      startsAt: data.starts_at,
      expiresAt: data.expires_at,
    },
  });
}

async function redeemActivationKey(request: Request, input: Record<string, unknown>) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);

  let normalized: string;
  try {
    normalized = normalizeActivationKey(input.activationKey);
  } catch {
    return response({ error: "invalid_activation_key" }, 400);
  }

  const keyHash = await hashActivationKey(normalized);
  const { data, error } = await db.rpc("redeem_activation_key", {
    p_key_hash: keyHash,
    p_device_id: device.id,
  });
  if (error) {
    console.error("activation redemption RPC failed", error);
    return response({ error: "activation_redemption_failed" }, 500);
  }
  if (!data || typeof data !== "object") return response({ error: "activation_redemption_failed" }, 500);

  const result = data as Record<string, unknown>;
  if (result.ok === true) return response(result);
  const code = result.error;
  const statusCode: Record<string, number> = {
    invalid_activation_key: 400,
    activation_key_used: 409,
    activation_key_revoked: 410,
    activation_key_expired: 410,
  };
  if (typeof code !== "string" || !statusCode[code]) {
    return response({ error: "activation_redemption_failed" }, 500);
  }
  return response({ error: code }, statusCode[code]);
}

async function startPhoneSubscriptionRecovery(input: Record<string, unknown>) {
  let normalized: string;
  try {
    normalized = normalizeActivationKey(input.activationKey);
  } catch {
    return response({ error: "recovery_unavailable" }, 400);
  }
  const targetDeviceKey = typeof input.targetDeviceKey === "string" ? input.targetDeviceKey : "";
  const targetTokenHash = typeof input.targetTokenHash === "string" ? input.targetTokenHash : "";
  if (!/^chrome-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetDeviceKey)
    || !/^[0-9a-f]{64}$/.test(targetTokenHash)) {
    return response({ error: "recovery_unavailable" }, 400);
  }

  const code = recoveryCode();
  const codeHmac = await recoveryCodeHmac(code);
  const { data, error } = await db.rpc("begin_phone_subscription_recovery", {
    p_key_hash: await hashActivationKey(normalized),
    p_target_device_key: targetDeviceKey,
    p_target_token_hash: targetTokenHash,
    p_code_hmac: codeHmac,
  });
  if (error) {
    console.error("phone subscription recovery start RPC failed");
    return response({ error: "recovery_unavailable" }, 503);
  }
  if (!data || typeof data !== "object") return response({ error: "recovery_unavailable" }, 503);
  const result = data as Record<string, unknown>;
  if (result.ok !== true) {
    if (result.error === "recovery_rate_limited") {
      const retryAfterSeconds = Number.isInteger(result.retryAfterSeconds)
        ? Math.max(1, Math.min(86_400, Number(result.retryAfterSeconds)))
        : 60;
      return response({ error: "recovery_rate_limited", retryAfterSeconds }, 429);
    }
    return response({ error: "recovery_unavailable" }, 400);
  }

  const challengeId = typeof result.challengeId === "string" ? result.challengeId : "";
  const expiresAt = typeof result.expiresAt === "string" ? result.expiresAt : "";
  const topic = typeof result.ntfyTopic === "string" ? result.ntfyTopic : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)
    || !Number.isFinite(Date.parse(expiresAt))
    || !/^soton-attendance-[a-f0-9]{40}$/.test(topic)) {
    console.error("phone subscription recovery start returned invalid server data");
    return response({ error: "recovery_unavailable" }, 503);
  }

  try {
    const sent = await fetch(`https://ntfy.sh/${topic}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Title": "Soton Auto-Check Recovery Code",
        "Priority": "3",
      },
      body: `手机提醒订阅恢复验证码：${code}\n验证码 30 分钟内有效。如非本人操作，请忽略此消息。`,
      signal: AbortSignal.timeout(8_000),
    });
    if (!sent.ok) return response({ error: "recovery_delivery_failed" }, 502);
  } catch {
    return response({ error: "recovery_delivery_failed" }, 502);
  }
  return response({ ok: true, challengeId, expiresAt });
}

async function completePhoneSubscriptionRecovery(request: Request, input: Record<string, unknown>) {
  const challengeId = typeof input.challengeId === "string" ? input.challengeId : "";
  const code = typeof input.code === "string" ? input.code : "";
  const token = bearer(request);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(challengeId)
    || !/^\d{6}$/.test(code)
    || !/^[0-9a-f]{64}$/.test(token)) {
    return response({ error: "recovery_unavailable" }, 400);
  }

  const { data, error } = await db.rpc("complete_phone_subscription_recovery", {
    p_challenge_id: challengeId,
    p_code_hmac: await recoveryCodeHmac(code),
    p_target_token_hash: await sha256(token),
  });
  if (error) {
    console.error("phone subscription recovery completion RPC failed");
    return response({ error: "recovery_unavailable" }, 503);
  }
  if (!data || typeof data !== "object") return response({ error: "recovery_unavailable" }, 503);
  const result = data as Record<string, unknown>;
  if (result.ok !== true) {
    const codeStatus: Record<string, number> = {
      recovery_code_invalid: 400,
      recovery_code_expired: 410,
      recovery_attempts_exhausted: 429,
    };
    const codeError = typeof result.error === "string" ? result.error : "";
    if (codeStatus[codeError]) return response({ error: codeError }, codeStatus[codeError]);
    return response({ error: "recovery_unavailable" }, 400);
  }
  const deviceId = typeof result.deviceId === "string" ? result.deviceId : "";
  const topic = typeof result.ntfyTopic === "string" ? result.ntfyTopic : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deviceId)
    || !/^soton-attendance-[a-f0-9]{40}$/.test(topic)) {
    console.error("phone subscription recovery completion returned invalid server data");
    return response({ error: "recovery_unavailable" }, 503);
  }
  return response({ ok: true, deviceId, ntfyTopic: topic, entitlement: result.entitlement ?? null });
}

async function authenticatedDevice(request: Request) {
  const device = await deviceForToken(bearer(request));
  if (!device) return null;
  await db.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  return device;
}

async function syncDevice(request: Request, input: Record<string, unknown>) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  let normalized;
  try {normalized=normalizeSchedules(input.schedules);} catch(error) {return response({error:error instanceof Error?error.message:'invalid_schedule'},400);}
  if(!Number.isSafeInteger(input.version)||Number(input.version)<=0) return response({error:'invalid_snapshot_version'},400);
  const preferences = input.preferences && typeof input.preferences === "object" ? input.preferences as Record<string, unknown> : {};
  if(preferences.timezone!==undefined&&preferences.timezone!=='Asia/Kuala_Lumpur'||preferences.reminderTime!==undefined&&preferences.reminderTime!=='19:30'||preferences.remindersEnabled!==undefined&&typeof preferences.remindersEnabled!=='boolean'||preferences.successNotificationsEnabled!==undefined&&typeof preferences.successNotificationsEnabled!=='boolean') return response({error:'invalid_preferences'},400);
  const {data,error}=await db.rpc('replace_attendance_schedules',{p_device:device.id,p_version:input.version,p_schedules:normalized,p_preferences:{timezone:'Asia/Kuala_Lumpur',reminder_time:'19:30',reminders_enabled:preferences.remindersEnabled!==false,success_notifications_enabled:preferences.successNotificationsEnabled!==false}});
  if(error) return response({error:'schedule_replace_failed'},500);
  return response(data);
}

async function reportEvent(request: Request, input: Record<string, unknown>) {
  const device=await authenticatedDevice(request);
  if(!device) return response({error:'unauthorized'},401);
  let row;
  try {row=validateEvent(input);} catch {return response({error:'invalid_event'},400);}
  const {data,error}=await db.rpc('record_attendance_event',{p_device:device.id,p_event:row});
  if(error) return response({error:'event_save_failed'},500);
  return response(data);
}
async function setupSummary(request: Request,input: Record<string,unknown>) {
  const device=await authenticatedDevice(request);
  if(!device) return response({error:'unauthorized'},401);
  if(typeof input.sessionId!=='string'||!/^[A-Za-z0-9-]{8,100}$/.test(input.sessionId)||!Number.isInteger(input.count)||!Number.isInteger(input.passed)||Number(input.count)<1||Number(input.count)>200||Number(input.passed)<0||Number(input.passed)>Number(input.count)) return response({error:'invalid_setup_summary'},400);
  const {data,error}=await db.rpc('record_setup_summary',{p_device:device.id,p_session:input.sessionId,p_summary:{count:input.count,passed:input.passed}});
  if(error) return response({error:'setup_summary_failed'},500);
  return response(data);
}

async function readLogs(request: Request) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const { data, error } = await db.from("attendance_logs").select("course_code,class_date,start_time,end_time,status,detail,occurred_at,form_url").eq("device_id", device.id).order("class_date", { ascending: false }).order("occurred_at", { ascending: false }).limit(200);
  if (error) return response({ error: "logs_read_failed" }, 500);
  return response({ logs: data ?? [] });
}

async function readNotifications(request: Request) {
  const device=await authenticatedDevice(request);
  if(!device) return response({error:'unauthorized'},401);
  const {data,error}=await db.from('notification_outbox').select('id,kind,title,body,delivery_state,created_at,provider_accepted_at,phone_receipt_confirmed_at,last_error,sent_at').eq('device_id',device.id).order('created_at',{ascending:false}).limit(100);
  if(error) return response({error:'notifications_read_failed'},500);
  const notifications=(data??[]).map(item=>{
    // The currently deployed worker predates delivery_state and records provider acceptance in sent_at.
    const legacyAccepted=item.delivery_state==='queued'&&Boolean(item.sent_at);
    return {...item,delivery_state:legacyAccepted?'accepted':item.delivery_state,provider_accepted_at:item.provider_accepted_at??(legacyAccepted?item.sent_at:null)};
  });
  return response({notifications});
}
async function confirmPhoneReceipt(request: Request,input: Record<string,unknown>) {
  const device=await authenticatedDevice(request);
  if(!device) return response({error:'unauthorized'},401);
  if(typeof input.notificationId!=='string'||!/^[a-f0-9-]{36}$/.test(input.notificationId)) return response({error:'invalid_notification'},400);
  const {data,error}=await db.from('notification_outbox').update({phone_receipt_confirmed_at:new Date().toISOString()}).eq('device_id',device.id).eq('id',input.notificationId).select('id').maybeSingle();
  if(error||!data) return response({error:'receipt_update_failed'},400);
  return response({ok:true});
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  let input: Record<string, unknown>;
  try {
    input = await request.json();
    if(!input||typeof input!=="object"||Array.isArray(input)) return response({error:"invalid_json"},400);
  } catch {
    return response({ error: "invalid_json" }, 400);
  }
  try {
    switch (input.action) {
      case "register": return await registerDevice(input,request);
      case "ntfy-topic": return await getNtfyTopic(request);
      case "entitlement-status": return await entitlementStatus(request);
      case "redeem-activation-key": return await redeemActivationKey(request, input);
      case "recovery-start": return await startPhoneSubscriptionRecovery(input);
      case "recovery-complete": return await completePhoneSubscriptionRecovery(request,input);
      case "sync": return await syncDevice(request, input);
      case "event": return await reportEvent(request, input);
      case "setup-summary": return await setupSummary(request,input);
      case "confirm-receipt": return await confirmPhoneReceipt(request,input);
      case "logs": return await readLogs(request);
      case "notifications": return await readNotifications(request);

      default: return response({ error: "unknown_action" }, 400);
    }
  } catch (error) {
    if (input.action === "recovery-start" || input.action === "recovery-complete") {
      console.error("phone subscription recovery request failed");
    } else {
      console.error(error);
    }
    return response({ error: "server_error" }, 500);
  }
});
