import test from 'node:test';
import assert from 'node:assert/strict';
import {reserveSubmissionRecord,transition} from '../src/state.js';

function record(){return {state:'launched',tabId:7,occ:{key:'COMP1311:2026-10-05:15:00'}};}

test('first reservation persists the permanent attempt marker and grants one click',()=>{
  const first=reserveSubmissionRecord({run:record()},'run',7,'2026-10-05T07:00:00.000Z');
  assert.equal(first.granted,true);
  assert.equal(first.records.run.submissionKey,'run');
  assert.equal(first.records.run.submissionAttemptedAt,'2026-10-05T07:00:00.000Z');
  assert.equal(first.records.run.state,'pending');
  const second=reserveSubmissionRecord(first.records,'run',7,'2026-10-05T07:00:01.000Z');
  assert.deepEqual(second,{granted:false,reason:'already_attempted',records:first.records});
});

test('a persisted reservation denies after restart, timeout, and another scheduler trigger',()=>{
  let records={run:{...record(),submissionKey:'run',submissionAttemptedAt:'2026-10-05T07:00:00.000Z',state:'submitted_pending_confirmation'}};
  for(const now of ['2026-10-05T07:01:00.000Z','2026-10-05T08:00:00.000Z','2026-10-06T07:00:00.000Z']) {
    const result=reserveSubmissionRecord(records,'run',7,now);
    assert.equal(result.granted,false);
    records=result.records;
  }
});

test('pending confirmation is neither success nor failure and only manual confirmation can finish it',()=>{
  assert.equal(transition('pending','submitted_pending_confirmation').state,'submitted_pending_confirmation');
  assert.equal(transition('submitted_pending_confirmation','manual_submitted').state,'success');
  assert.equal(transition('unknown','manual_submitted').state,'success');
  assert.throws(()=>transition('unknown','success'));
  assert.throws(()=>transition('submitted_pending_confirmation','failed'));
});

test('explicit release is the only way to clear a reservation marker',()=>{
  const result=reserveSubmissionRecord({run:{...record(),submissionKey:'run',submissionAttemptedAt:'2026-10-05T07:00:00.000Z'}},'run',7,'2026-10-05T07:01:00.000Z');
  assert.equal(result.granted,false);
  assert.equal(result.reason,'already_attempted');
});
