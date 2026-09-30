import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function tomorrowInKualaLumpur() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = formatter.formatToParts(now).reduce<Record<string, string>>((acc, part) => (acc[part.type] = part.value, acc), {});
  const date = new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

Deno.serve(async () => {
  const tomorrow = tomorrowInKualaLumpur();
  const weekday = new Date(`${tomorrow}T12:00:00+08:00`).getUTCDay();
  const { data: schedules, error } = await db.from("schedules").select("device_id,course_code,start_time,end_time").eq("weekday", weekday).eq("enabled", true);
  if (error) return new Response(JSON.stringify({ error: "schedule_read_failed" }), { status: 500 });
  const grouped = new Map<string, Array<Record<string, unknown>>>();
  for (const schedule of schedules ?? []) {
    const list = grouped.get(schedule.device_id) ?? [];
    list.push(schedule);
    grouped.set(schedule.device_id, list);
  }
  let queued = 0;
  for (const [deviceId, classes] of grouped) {
    const { data: preference } = await db.from("notification_preferences").select("reminders_enabled").eq("device_id", deviceId).maybeSingle();
    if (preference?.reminders_enabled === false) continue;
    const courseList = classes.map((item) => `${item.course_code} ${String(item.start_time).slice(0, 5)}`).join("、");
    await db.from("notification_outbox").insert({
      device_id: deviceId,
      kind: "tomorrow_reminder",
      title: "确认明日自动打卡",
      body: `明日课程：${courseList}。请在扩展中确认后才会自动执行。`,
      payload: { classDate: tomorrow, courses: classes },
    });
    queued += 1;
  }
  return new Response(JSON.stringify({ ok: true, classDate: tomorrow, devicesQueued: queued }), { headers: { "Content-Type": "application/json" } });
});
