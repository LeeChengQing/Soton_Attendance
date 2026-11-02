import test from 'node:test';
import assert from 'node:assert/strict';
import * as state from '../src/state.js';
const occ={id:'manual',course:'COMP1311-LEC',weekStartDate:'2026-10-19',date:'2026-10-22',time:'09:00',endTime:'10:00',enabled:true};
const start=Date.parse('2026-10-22T09:00:00+08:00'),end=start+3600000;
test('manual eligibility is Malaysia start-inclusive and end-exclusive',()=>{
  assert.equal(state.manualCheckInState(occ,undefined,start-1),'not_started');
  assert.equal(state.manualCheckInState(occ,undefined,start),'ready');
  assert.equal(state.manualCheckInState(occ,undefined,end-1),'ready');
  assert.equal(state.manualCheckInState(occ,undefined,end),'ended');
  assert.equal(state.manualCheckInState({...occ,date:'2026-10-23'},undefined,start),'wrong_day');
  assert.equal(state.manualCheckInState({...occ,weekStartDate:'2026-10-12'},undefined,start),'inactive_week');
  assert.equal(state.manualCheckInState({...occ,enabled:false},undefined,start),'paused');
});
test('manual eligibility preserves every durable attempt, success and uncertain outcome',()=>{
  for(const status of ['success','success_manual','unknown','submitted_pending_confirmation','launched','pending']) {
    assert.notEqual(state.manualCheckInState(occ,{state:status},start),'ready');
  }
  for(const marker of ['submissionKey','submissionAttemptedAt']) assert.equal(state.manualCheckInState(occ,{state:'failed',[marker]:'persisted'},start),'attempted');
  assert.equal(state.manualCheckInState(occ,{state:'scheduled'},start),'ready');
  assert.equal(state.manualCheckInState(occ,{state:'failed'},start),'ready');
});
