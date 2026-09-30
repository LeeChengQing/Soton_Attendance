import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashActivationKey, normalizeActivationKey } from "../_shared/activation.ts";

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

async function ensureNtfyTopic(deviceId: string) {
  const existing = await db.from("push_subscriptions").select("provider_token")
    .eq("device_id", deviceId).eq("provider", "ntfy").eq("enabled", true).maybeSingle();
  if (existing.data?.provider_token) return existing.data.provider_token;
  const topic = `soton-attendance-${randomHex(20)}`;
  const { error } = await db.from("push_subscriptions").insert({
    device_id: deviceId,
    provider: "ntfy",
    provider_token: topic,
  });
  if (error) throw error;
  return topic;
}

async function deviceForToken(token: string) {
  if (!token) return null;
  const hash = await sha256(token);
  const direct = await db.from("devices").select("id,device_key,device_name").eq("auth_token_hash", hash).maybeSingle();
  return direct.data ?? null;
}

function validCourse(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(value.trim());
}

function validUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /microsoft\.com$|forms\.office\.com$|forms\.cloud\.microsoft$/.test(url.hostname);
  } catch {
    return false;
  }
}

async function registerDevice(input: Record<string, unknown>) {
  const deviceKey = typeof input.deviceKey === "string" ? input.deviceKey.trim() : "";
  if (deviceKey.length < 8 || deviceKey.length > 160) return response({ error: "invalid_device_key" }, 400);
  const deviceToken = randomHex(32);
  const { data: device, error } = await db.from("devices").upsert({
    device_key: deviceKey,
    device_name: typeof input.deviceName === "string" ? input.deviceName.slice(0, 100) : null,
    auth_token_hash: await sha256(deviceToken),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "device_key" }).select("id,device_key,device_name").single();
  if (error || !device) return response({ error: "device_register_failed" }, 500);
  await db.from("notification_preferences").upsert({ device_id: device.id }, { onConflict: "device_id" });
  const ntfyTopic = await ensureNtfyTopic(device.id);
  return response({ deviceId: device.id, deviceToken, ntfyTopic });
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

async function authenticatedDevice(request: Request) {
  const device = await deviceForToken(bearer(request));
  if (!device) return null;
  await db.from("devices").update({ last_seen_at: new Date().toISOString() }).eq("id", device.id);
  return device;
}

async function syncDevice(request: Request, input: Record<string, unknown>) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const schedules = Array.isArray(input.schedules) ? input.schedules : [];
  if (schedules.length > 200) return response({ error: "too_many_schedules" }, 400);
  const normalized = schedules.map((item) => ({
    device_id: device.id,
    course_code: typeof item?.courseCode === "string" ? item.courseCode.trim().toUpperCase() : "",
    course_name: typeof item?.courseName === "string" ? item.courseName.slice(0, 160) : null,
    weekday: Number(item?.weekday),
    start_time: item?.startTime,
    end_time: item?.endTime,
    form_url: item?.formUrl,
    timezone: typeof item?.timezone === "string" ? item.timezone : "Asia/Kuala_Lumpur",
    enabled: item?.enabled !== false,
  }));
  if (normalized.some((item) => !validCourse(item.course_code) || !Number.isInteger(item.weekday) || item.weekday < 0 || item.weekday > 6 || typeof item.start_time !== "string" || typeof item.end_time !== "string" || !validUrl(item.form_url))) {
    return response({ error: "invalid_schedule" }, 400);
  }
  const { error: deleteError } = await db.from("schedules").delete().eq("device_id", device.id);
  if (deleteError) return response({ error: "schedule_replace_failed" }, 500);
  if (normalized.length) {
    const { error } = await db.from("schedules").insert(normalized);
    if (error) return response({ error: "schedule_save_failed" }, 500);
  }
  const preferences = input.preferences && typeof input.preferences === "object" ? input.preferences as Record<string, unknown> : {};
  await db.from("notification_preferences").upsert({
    device_id: device.id,
    timezone: typeof preferences.timezone === "string" ? preferences.timezone : "Asia/Kuala_Lumpur",
    reminder_time: typeof preferences.reminderTime === "string" ? preferences.reminderTime : "19:30",
    reminders_enabled: preferences.remindersEnabled !== false,
    success_notifications_enabled: preferences.successNotificationsEnabled !== false,
  }, { onConflict: "device_id" });
  return response({ ok: true, scheduleCount: normalized.length });
}

async function reportEvent(request: Request, input: Record<string, unknown>) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const status = input.status;
  if (!["scheduled", "launched", "success", "failed", "unknown", "missed"].includes(String(status))) return response({ error: "invalid_status" }, 400);
  const courseCode = typeof input.courseCode === "string" ? input.courseCode.trim().toUpperCase() : "";
  const occurrenceKey = typeof input.occurrenceKey === "string" ? input.occurrenceKey.slice(0, 180) : "";
  if (!validCourse(courseCode) || !occurrenceKey || typeof input.classDate !== "string") return response({ error: "invalid_event" }, 400);
  const row = {
    device_id: device.id,
    occurrence_key: occurrenceKey,
    course_code: courseCode,
    class_date: input.classDate,
    start_time: input.startTime ?? null,
    end_time: input.endTime ?? null,
    form_url: validUrl(input.formUrl) ? input.formUrl : null,
    status,
    detail: typeof input.detail === "string" ? input.detail.slice(0, 500) : null,
    source: "extension",
    occurred_at: new Date().toISOString(),
  };
  const { error } = await db.from("attendance_logs").upsert(row, { onConflict: "device_id,occurrence_key" });
  if (error) return response({ error: "event_save_failed" }, 500);
  if (["success", "failed", "unknown", "missed"].includes(String(status))) {
    const labels: Record<string, [string, string, string]> = {
      success: ["打卡成功", `${courseCode} 已完成自动打卡。`, "attendance_success"],
      failed: ["自动打卡失败", `${courseCode} 自动打卡失败，请检查浏览器登录状态。`, "attendance_failed"],
      unknown: ["打卡结果不明", `${courseCode} 的提交结果无法确认，请手动核对。`, "attendance_unknown"],
      missed: ["错过打卡时间", `${courseCode} 未在可用时间内完成打卡，请手动处理。`, "attendance_missed"],
    };
    const [title, body, kind] = labels[String(status)];
    await db.from("notification_outbox").insert({
      device_id: device.id,
      kind,
      title,
      body,
      payload: { courseCode, occurrenceKey, classDate: input.classDate, status },
    });
  }
  return response({ ok: true });
}

async function readLogs(request: Request) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const { data, error } = await db.from("attendance_logs").select("course_code,class_date,start_time,end_time,status,detail,occurred_at,form_url").eq("device_id", device.id).order("class_date", { ascending: false }).order("occurred_at", { ascending: false }).limit(200);
  if (error) return response({ error: "logs_read_failed" }, 500);
  return response({ logs: data ?? [] });
}

async function readNotifications(request: Request) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const { data, error } = await db.from("notification_outbox")
    .select("id,kind,title,body,payload,created_at")
    .eq("device_id", device.id).is("sent_at", null)
    .order("created_at", { ascending: true }).limit(50);
  if (error) return response({ error: "notifications_read_failed" }, 500);
  const ids = (data ?? []).map((item) => item.id);
  if (ids.length) await db.from("notification_outbox").update({ sent_at: new Date().toISOString() }).in("id", ids);
  return response({ notifications: data ?? [] });
}

async function subscribe(request: Request, input: Record<string, unknown>) {
  const device = await authenticatedDevice(request);
  if (!device) return response({ error: "unauthorized" }, 401);
  const provider = String(input.provider ?? "");
  if (!["web_push", "fcm", "telegram", "ntfy"].includes(provider)) return response({ error: "invalid_provider" }, 400);
  const row = {
    device_id: device.id,
    provider,
    endpoint: typeof input.endpoint === "string" ? input.endpoint : null,
    p256dh: typeof input.p256dh === "string" ? input.p256dh : null,
    auth: typeof input.auth === "string" ? input.auth : null,
    provider_token: typeof input.providerToken === "string" ? input.providerToken.slice(0, 300) : null,
    enabled: true,
    last_error: null,
  };
  const { error } = await db.from("push_subscriptions").upsert(row, { onConflict: "device_id,provider,endpoint" });
  if (error) return response({ error: "subscription_save_failed" }, 500);
  return response({ ok: true });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  let input: Record<string, unknown>;
  try {
    input = await request.json();
  } catch {
    return response({ error: "invalid_json" }, 400);
  }
  try {
    switch (input.action) {
      case "register": return await registerDevice(input);
      case "ntfy-topic": return await getNtfyTopic(request);
      case "entitlement-status": return await entitlementStatus(request);
      case "redeem-activation-key": return await redeemActivationKey(request, input);
      case "sync": return await syncDevice(request, input);
      case "event": return await reportEvent(request, input);
      case "logs": return await readLogs(request);
      case "notifications": return await readNotifications(request);
      case "subscribe": return await subscribe(request, input);
      default: return response({ error: "unknown_action" }, 400);
    }
  } catch (error) {
    console.error(error);
    return response({ error: "server_error" }, 500);
  }
});
