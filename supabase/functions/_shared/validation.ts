export function validDate(value: unknown): value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validTime(value: unknown): value is string {return typeof value==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);}
export function validCourse(value: unknown): value is string {return typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9 _-]{1,63}$/.test(value.trim());}
export function validFormUrl(value: unknown): value is string {
  if(typeof value!=="string") return false;
  try {
    const u=new URL(value);
    return u.protocol==="https:"&&!u.username&&!u.password&&!u.port&&["forms.office.com","forms.cloud.microsoft"].includes(u.hostname)&&(/^\/r\/[\w-]+\/?$/.test(u.pathname)||(/^\/Pages\/ResponsePage\.aspx$/i.test(u.pathname)&&Boolean(u.searchParams.get("id"))));
  } catch {return false;}
}
export function normalizeSchedules(input: unknown) {
  if(!Array.isArray(input)||input.length>200) throw Error("invalid_schedule");
  const seen=new Set<string>();
  return input.map(item=>{
    if(!item||!validCourse(item.courseCode)||!Number.isInteger(item.weekday)||item.weekday<0||item.weekday>6||!validTime(item.startTime)||!validTime(item.endTime)||item.endTime<=item.startTime) throw Error("invalid_schedule");
    if(item.enabled!==undefined&&typeof item.enabled!=="boolean"||item.automationReady!==undefined&&typeof item.automationReady!=="boolean") throw Error("invalid_schedule");
    if(item.timezone!==undefined&&item.timezone!=="Asia/Kuala_Lumpur") throw Error("invalid_schedule");
    if(item.formUrl!==null&&!validFormUrl(item.formUrl)||item.automationReady===true&&!validFormUrl(item.formUrl)) throw Error("invalid_schedule");
    if(!Array.isArray(item.exceptions??[])||(item.exceptions??[]).length>366||(item.exceptions??[]).some((d:unknown)=>!validDate(d))) throw Error("invalid_schedule");
    const course=item.courseCode.trim().toUpperCase(),key=[course,item.weekday,item.startTime,item.endTime].join("|");
    if(seen.has(key)) throw Error("duplicate_schedule");seen.add(key);
    return {course_code:course,course_name:typeof item.courseName==="string"?item.courseName.slice(0,160):course,weekday:item.weekday,start_time:item.startTime,end_time:item.endTime,form_url:item.formUrl||"",timezone:"Asia/Kuala_Lumpur",enabled:item.enabled!==false,automation_ready:item.automationReady===true,exceptions:[...new Set(item.exceptions??[])]};
  });
}
export function validateEvent(input: Record<string,unknown>) {
  if(!validCourse(input.courseCode)||typeof input.occurrenceKey!=="string"||!input.occurrenceKey||input.occurrenceKey.length>300||!validDate(input.classDate)||!["success","failed","unknown","missed"].includes(String(input.status))) throw Error("invalid_event");
  if(input.startTime!=null&&!validTime(input.startTime)||input.endTime!=null&&!validTime(input.endTime)||input.formUrl!=null&&!validFormUrl(input.formUrl)) throw Error("invalid_event");
  return {occurrence_key:input.occurrenceKey,course_code:input.courseCode.trim().toUpperCase(),class_date:input.classDate,start_time:input.startTime??null,end_time:input.endTime??null,form_url:input.formUrl??null,status:input.status,detail:typeof input.detail==="string"?input.detail.slice(0,500):null};
}
