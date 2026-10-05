import {hasActivePhoneEntitlement} from "./entitlement.ts";
export type DeliveryResult={outcome:"accepted"|"retry"|"discarded"|"uncertain",error?:string};
export async function deliverNotification(item:{title:string,body:string},entitlement:unknown,topics:string[],send:typeof fetch=fetch):Promise<DeliveryResult> {
  if(!hasActivePhoneEntitlement(entitlement,Date.now())) return {outcome:"discarded",error:"subscription_required"};
  const topic=topics.find(t=>/^soton-attendance-[a-f0-9]{40}$/.test(t));
  if(!topic) return {outcome:"discarded",error:"ntfy_topic_missing"};
  try {
    const response=await send(`https://ntfy.sh/${topic}`,{method:"POST",headers:{"Content-Type":"text/plain; charset=utf-8","Title":"Soton Attendance","Priority":"high","Tags":"school"},body:`${item.title}\n${item.body}`,signal:AbortSignal.timeout(8000)});
    if(response.ok) return {outcome:"accepted"};
    return {outcome:response.status===429||response.status>=500?"retry":"discarded",error:`ntfy_http_${response.status}`};
  } catch {return {outcome:"uncertain",error:"ntfy_delivery_uncertain"};}
}
