import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSession,saveDraftTasks,nextTrigger} from '../src/configuration.js';
const original={id:'old',kind:'weekly',course:'COMP1311-LEC',weekday:1,time:'09:00',endTime:'10:00',exceptions:[],createdAt:'2020-01-01T00:00:00Z'};
test('cancellation-only imports update the same intended task',()=>{
  const row={...original,id:'draft',exceptions:['2026-10-05']};
  const tasks=saveDraftTasks([original],[row],'2026-10-01T00:00:00Z');
  assert.equal(tasks.length,1);assert.equal(tasks[0].id,'old');assert.deepEqual(tasks[0].exceptions,['2026-10-05']);
});
test('same course at a different time saves both lessons without a comparison step',()=>{
  const row={...original,id:'draft',time:'11:00',endTime:'12:00'};
  assert.equal(saveDraftTasks([original],[row]).length,2);

});
test('session validation rejects invalid calendars/times and paused schedules have no next alarm',()=>{
  for(const patch of [{exceptions:['2026-02-30']},{weekday:7},{time:'24:00'},{endTime:'08:00'}]) assert.throws(()=>validateSession({...original,...patch}));
  for(const weekday of [null,false,'',true,'1',undefined]) assert.throws(()=>validateSession({...original,weekday}));
  assert.throws(()=>validateSession({...original,kind:'unsupported'}));
  assert.equal(nextTrigger({...original,enabled:false},{},Date.parse('2026-10-01T00:00:00Z')),null);
  const next=nextTrigger({...original,exceptions:['2026-10-05']},{},Date.parse('2026-10-01T00:00:00Z'));
  assert.equal(next.date,'2026-10-12');
});
