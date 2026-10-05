import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackup,validateBackup,restoreBackup,recoveryForRecord} from '../src/backup.js';
const session={id:'a',kind:'weekly',course:'COMP1311',weekday:1,time:'09:00',endTime:'10:00',exceptions:[],enabled:true};
const occ={...session,date:'2026-09-28',key:'comp1311:2026-09-28:09:00'};
test('backup includes terminal history but excludes paid identity, secrets, tabs and in-flight records',()=>{
  const backup=createBackup({attendanceProfile:{student:'123',name:'A',studentType:'local'},attendanceSessions:[session],attendanceBindings:{},attendanceCloudToken:'secret',attendanceNtfyTopic:'secret-topic',attendanceRecords:{done:{state:'unknown',occ,at:'2026-09-28T01:00:00Z',tabId:3},active:{state:'pending',occ}}});
  assert.equal(JSON.stringify(backup).includes('secret'),false);assert.equal(Object.keys(backup.records).length,1);assert.equal(backup.records.done.tabId,undefined);
  assert.throws(()=>validateBackup({...backup,attendanceCloudToken:'injected'}));
});
test('restore retains local terminal records and schedules only future triggers without replacing credentials',()=>{
  const backup=createBackup({attendanceSessions:[session],attendanceRecords:{done:{state:'success',occ,at:'2026-09-28T01:00:00Z'}}});
  const restored=restoreBackup(backup,{attendanceRecords:{[occ.key]:{state:'unknown',occ,at:'2026-09-28T01:00:00Z'}},attendanceCloudToken:'local-token'},'2026-10-01T00:00:00Z');
  assert.equal(restored.attendanceCloudToken,undefined);assert.equal(restored.attendanceRecords[occ.key].state,'unknown');assert.equal(restored.attendanceSessions[0].createdAt,'2026-10-01T00:00:00Z');
  assert.throws(()=>validateBackup({...backup,sessions:[{...session,exceptions:['2026-02-30']}]}));
});
test('unknown result offers manual inspection and never an automatic resubmit',()=>{
  const recovery=recoveryForRecord({state:'unknown',occ});
  assert.match(recovery.description,/手动核对/);assert.equal(recovery.action,'inspect');
  assert.equal(recoveryForRecord({state:'failed',detail:'表单题目发生变化'}).action,'binding');
});
