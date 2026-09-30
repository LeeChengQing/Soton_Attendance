import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { gatePhoneNotification } from "../_shared/entitlement.ts";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function topicUrl(topic: string) {
  if (!/^soton-attendance-[a-f0-9]{40}$/.test(topic)) return null;
  return `https://ntfy.sh/${encodeURIComponent(topic)}`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("expected POST", { status: 405 });
  const { data: pending, error } = await db.from("notification_outbox")
    .select("id,device_id,title,body")
    .is("sent_at", null)
    .is("discarded_at", null)
    .lte("available_at", new Date().toISOString())
    .order("created_at", { ascending: true }).limit(100);
  if (error) return new Response(JSON.stringify({ error: "outbox_read_failed" }), { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const item of pending ?? []) {
    const { data: entitlement, error: entitlementError } = await db.from("entitlements")
      .select("status,phone_notifications,starts_at,expires_at")
      .eq("device_id", item.device_id)
      .maybeSingle();
    if (entitlementError) {
      await db.from("notification_outbox").update({ last_error: "entitlement_check_failed" }).eq("id", item.id);
      failed += 1;
      continue;
    }

    let discardFailed = false;
    const authorized = await gatePhoneNotification(entitlement, Date.now(), async () => {
      const { error: discardError } = await db.from("notification_outbox").update({
        last_error: "subscription_required",
        discarded_at: new Date().toISOString(),
      }).eq("id", item.id);
      discardFailed = discardError !== null;
    });
    if (discardFailed) {
      return new Response(JSON.stringify({ error: "outbox_discard_failed" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!authorized) {
      failed += 1;
      continue;
    }

    const { data: subscriptions } = await db.from("push_subscriptions")
      .select("provider_token")
      .eq("device_id", item.device_id).eq("provider", "ntfy").eq("enabled", true);
    let delivered = false;
    let lastError = "没有可用的 ntfy 主题";
    for (const subscription of subscriptions ?? []) {
      const topic = subscription.provider_token ?? "";
      const url = topicUrl(topic);
      if (!url) {
        lastError = "ntfy 主题格式无效";
        continue;
      }
      try {
        const result = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain; charset=utf-8", "Title": "Soton Attendance", "Priority": "high", "Tags": "school" },
          body: `${item.title}\n${item.body}`,
        });
        if (result.ok) {
          delivered = true;
          break;
        }
        lastError = `ntfy 返回 HTTP ${result.status}`;
      } catch (sendError) {
        lastError = sendError instanceof Error ? sendError.message : "ntfy 请求失败";
      }
    }
    if (delivered) {
      await db.from("notification_outbox").update({ sent_at: new Date().toISOString(), last_error: null }).eq("id", item.id);
      sent += 1;
    } else {
      await db.from("notification_outbox").update({ last_error: lastError }).eq("id", item.id);
      failed += 1;
    }
  }
  return new Response(JSON.stringify({ ok: true, pending: pending?.length ?? 0, sent, failed }), { headers: { "Content-Type": "application/json" } });
});
