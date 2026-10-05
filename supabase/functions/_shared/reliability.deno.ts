import {handler as reminders} from '../send-reminders/index.ts';
import {handler as worker} from '../notification-worker/index.ts';
import {normalizeSchedules,validDate,validFormUrl} from './validation.ts';
import {deliverNotification} from './notification.ts';
function assert(value:unknown,message:string) {if(!value) throw Error(message);}
Deno.test('global handlers reject user and absent credentials before creating database client',async()=>{
  Deno.env.set('ATTENDANCE_SCHEDULER_SECRET','isolated-test-scheduler-secret');
  for(const handler of [reminders,worker]) {
    for(const headers of [new Headers(),new Headers({Authorization:'Bearer ordinary-user-token'})]) {
      const response=await handler(new Request('http://test',{method:'POST',headers}));
      assert(response.status===401,'global worker must deny ordinary callers');
      await response.text();
    }
  }
  Deno.env.delete('ATTENDANCE_SCHEDULER_SECRET');
});
Deno.test('exact URL/calendar and snapshot validation in native runtime',()=>{
  assert(!validDate('2026-02-30'),'invalid date');assert(validDate('2028-02-29'),'leap date');
  assert(!validFormUrl('https://evilforms.office.com/r/x'),'host suffix attack');
  assert(!validFormUrl('https://forms.office.com/edit?id=x'),'wrong page');
  const result=normalizeSchedules([{courseCode:'COMP1311',weekday:1,startTime:'09:00',endTime:'10:00',formUrl:null,automationReady:false,exceptions:['2026-10-05']}]);
  assert(result[0].automation_ready===false,'unbound schedule is explicitly unready');
});
Deno.test('setup-summary send shares entitlement gate and uncertainty semantics',async()=>{
  let sent=0;
  const result=await deliverNotification({title:'设置检查完成',body:'test'},null,['soton-attendance-'+'a'.repeat(40)],async()=>{sent++;return new Response();});
  assert(result.outcome==='discarded'&&sent===0,'unauthorized summary cannot send');
});
