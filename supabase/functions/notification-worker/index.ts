import {createClient} from "https://esm.sh/@supabase/supabase-js@2";
import {schedulerAuthorized} from "../_shared/scheduler.ts";
import {deliverNotification} from "../_shared/notification.ts";

export async function handler(request:Request) {
  if(request.method!=="POST") return Response.json({error:"method_not_allowed"},{status:405});
  if(!schedulerAuthorized(request,Deno.env.get("ATTENDANCE_SCHEDULER_SECRET")??"")) return Response.json({error:"unauthorized_scheduler"},{status:401});
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:pending,error}=await db.rpc('claim_attendance_notifications',{p_limit:10});
  if(error) return Response.json({error:'outbox_claim_failed'},{status:500});
  let accepted=0,failed=0;
  const results=await Promise.all((pending??[]).map(async (item:{id:string,device_id:string,lease_token:string,title:string,body:string})=>{
    const {data:entitlement,error:entitlementError}=await db.from('entitlements').select('status,phone_notifications,starts_at,expires_at').eq('device_id',item.device_id).maybeSingle();
    let outcome;
    if(entitlementError) outcome={outcome:'retry',error:'entitlement_check_failed'};
    else {
      const {data:subscriptions,error:subscriptionError}=await db.from('push_subscriptions').select('provider_token').eq('device_id',item.device_id).eq('provider','ntfy').eq('enabled',true);
      outcome=subscriptionError?{outcome:'retry',error:'subscription_read_failed'}:await deliverNotification(item,entitlement,(subscriptions??[]).map(s=>s.provider_token??''));
    }
    const {data:saved,error:saveError}=await db.rpc('finish_attendance_notification',{p_id:item.id,p_lease:item.lease_token,p_outcome:outcome.outcome,p_error:outcome.error??null});
    if(saveError||saved!==true) return false;
    if(outcome.outcome==='accepted') accepted++;else failed++;
    return true;
  }));
  if(results.some(ok=>!ok)) return Response.json({error:'delivery_state_update_failed',accepted,failed},{status:500});
  return Response.json({ok:true,claimed:pending?.length??0,accepted,failed});
}
if(import.meta.main) Deno.serve(handler);
