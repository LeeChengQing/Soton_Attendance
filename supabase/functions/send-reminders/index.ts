import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {schedulerAuthorized} from "../_shared/scheduler.ts";

export async function handler(request:Request) {
  if(request.method!=="POST") return Response.json({error:"method_not_allowed"},{status:405});
  if(!schedulerAuthorized(request,Deno.env.get("ATTENDANCE_SCHEDULER_SECRET")??"")) return Response.json({error:"unauthorized_scheduler"},{status:401});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));
  const date=new Date(parts.year+'-'+parts.month+'-'+parts.day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
  const tomorrow=date.toISOString().slice(0,10);
  const {data,error}=await db.rpc('enqueue_attendance_reminders',{p_date:tomorrow});
  if(error) return Response.json({error:'reminder_enqueue_failed'},{status:500});
  return Response.json({ok:true,classDate:tomorrow,devicesQueued:data});
}
if(import.meta.main) Deno.serve(handler);
