// Run only against migrated local/isolated Supabase, never a student database.
import postgres from 'npm:postgres@3.4.7';
const connection=Deno.env.get('ATTENDANCE_TEST_DATABASE_URL');
if(!connection) throw Error('Set ATTENDANCE_TEST_DATABASE_URL to a migrated isolated database.');
const host=new URL(connection).hostname;
if(!['localhost','127.0.0.1','[::1]'].includes(host)&&Deno.env.get('ATTENDANCE_ISOLATED_DB')!=='1') throw Error('Remote database requires explicit ATTENDANCE_ISOLATED_DB=1.');
const db=postgres(connection,{max:1}),a=postgres(connection,{max:1}),b=postgres(connection,{max:1});
function assert(value:unknown,message:string) {if(!value) throw Error(message);}
Deno.test('competing workers claim distinct live rows, stale versions lose, bad backlog does not starve healthy messages',async()=>{
  const key=`isolated-${crypto.randomUUID()}`,token=crypto.randomUUID().replaceAll('-','').repeat(2),topic=`soton-attendance-${crypto.randomUUID().replaceAll('-','').slice(0,20).repeat(2)}`;
  let device:string|undefined;
  try {
    const registration=await db`select public.register_attendance_device(${key},'isolated concurrency',${token},${topic}) as result`;
    const deviceId=String(registration[0].result.deviceId);device=deviceId;
    await db`insert into public.notification_outbox(device_id,kind,title,body,attempts,available_at) select ${deviceId},'tomorrow_reminder','bad old','body',4,now()-interval '1 day' from generate_series(1,100)`;
    await db`insert into public.notification_outbox(device_id,kind,title,body) values(${deviceId},'tomorrow_reminder','healthy new','body')`;
    let release!:()=>void,claimed!:()=>void;const gate=new Promise<void>(r=>release=r),firstReady=new Promise<void>(r=>claimed=r);
    let firstRows:postgres.RowList<postgres.Row[]>;
    const first=a.begin(async tx=>{firstRows=await tx`select * from public.claim_attendance_notifications(1)`;claimed();await gate;return firstRows;});
    await firstReady;
    const second=await b`select * from public.claim_attendance_notifications(1)`;release();const result=await first;
    assert(result.length===1&&second.length===1&&result[0].id!==second[0].id,'SKIP LOCKED claims must be distinct');
    assert(result[0].title==='healthy new','low-attempt healthy row must outrank 100 bad old rows');
    const prefs={timezone:'Asia/Kuala_Lumpur',reminder_time:'19:30',reminders_enabled:true,success_notifications_enabled:true};
    const rows=[{course_code:'COMP1311',course_name:'test',weekday:1,start_time:'09:00',end_time:'10:00',form_url:'https://forms.office.com/r/test',timezone:'Asia/Kuala_Lumpur',enabled:true,automation_ready:true,exceptions:[]}];
    await Promise.all([a`select public.replace_attendance_schedules(${deviceId},100,${a.json(rows)},${a.json(prefs)})`,b`select public.replace_attendance_schedules(${deviceId},101,${b.json([])},${b.json(prefs)})`]);
    const version=await db`select schedule_version from public.devices where id=${deviceId}`;assert(Number(version[0].schedule_version)===101,'newer committed snapshot must win');
    const schedules=await db`select count(*) from public.schedules where device_id=${deviceId}`;assert(Number(schedules[0].count)===0,'older snapshot cannot restore removed schedules');
  } finally {
    if(device) await db`delete from public.devices where id=${device}`;
    await Promise.all([db.end(),a.end(),b.end()]);
  }
});
