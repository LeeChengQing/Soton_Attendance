import test from 'node:test';
import assert from 'node:assert/strict';
import {validFormUrl,validDate,normalizeSchedules,validateEvent} from '../supabase/functions/_shared/validation.ts';
import {schedulerAuthorized} from '../supabase/functions/_shared/scheduler.ts';
import {deliverNotification} from '../supabase/functions/_shared/notification.ts';

test('backend validates exact Forms hosts, paths, calendar dates and time ranges',()=>{
  for(const url of ['https://evilforms.office.com/Pages/ResponsePage.aspx?id=1','https://microsoft.com/Pages/ResponsePage.aspx?id=1','https://forms.office.com/edit?id=1','https://user:pass@forms.office.com/r/abc','https://forms.office.com:444/r/abc']) assert.equal(validFormUrl(url),false);
  assert.equal(validFormUrl('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=1'),true);
  assert.equal(validDate('2026-02-30'),false);assert.equal(validDate('2028-02-29'),true);
  const row={courseCode:'COMP1311',weekday:1,startTime:'09:00',endTime:'10:00',formUrl:'https://forms.office.com/r/test',automationReady:true,exceptions:['2026-10-05']};
  assert.deepEqual(normalizeSchedules([row])[0].exceptions,['2026-10-05']);
  for(const patch of [{startTime:'25:00'},{endTime:'08:00'},{exceptions:['2026-02-30']},{weekday:'1'},{automationReady:'true'}]) assert.throws(()=>normalizeSchedules([{...row,...patch}]));
  assert.throws(()=>validateEvent({courseCode:'COMP1311',occurrenceKey:'x',status:'unknown',classDate:'2026-02-30'}));
  assert.throws(()=>validateEvent({courseCode:'COMP1311',occurrenceKey:'occ-1',status:'submitted_pending_confirmation',classDate:'2026-10-05'}));
});
test('scheduler credential denies missing configuration and ordinary user bearer tokens',()=>{
  assert.equal(schedulerAuthorized(new Request('http://test',{headers:{Authorization:'Bearer user'}}),'secret-dedicated'),false);
  assert.equal(schedulerAuthorized(new Request('http://test',{headers:{'x-scheduler-secret':'secret-dedicated'}}),''),false);
  assert.equal(schedulerAuthorized(new Request('http://test',{headers:{'x-scheduler-secret':'secret-dedicated'}}),'secret-dedicated'),true);
});
const entitlement={status:'active',phone_notifications:true,starts_at:'2020-01-01T00:00:00Z',expires_at:'2099-01-01T00:00:00Z'};
test('every send is gated and provider acceptance is separate from phone receipt',async()=>{
  let calls=0;
  const send=async()=>{calls++;return new Response('',{status:200});};
  assert.deepEqual(await deliverNotification({title:'test',body:'body'},null,['soton-attendance-'+'a'.repeat(40)],send),{outcome:'discarded',error:'subscription_required'});
  assert.equal(calls,0);
  const result=await deliverNotification({title:'test',body:'body'},entitlement,['soton-attendance-'+'a'.repeat(40)],send);
  assert.equal(result.outcome,'accepted');assert.equal(result.phoneReceiptConfirmed,undefined);assert.equal(calls,1);
});
test('network uncertainty stops active replay and provider rejection remains retryable',async()=>{
  const topic=['soton-attendance-'+'a'.repeat(40)];
  assert.equal((await deliverNotification({title:'t',body:'b'},entitlement,topic,async()=>{throw Error('timeout');})).outcome,'uncertain');
  assert.equal((await deliverNotification({title:'t',body:'b'},entitlement,topic,async()=>new Response('',{status:503}))).outcome,'retry');
});
