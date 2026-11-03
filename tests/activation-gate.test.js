import test from 'node:test';
import assert from 'node:assert/strict';
import * as gate from '../src/license-gate.js';
import {normalizeGateKey,formatGateKey} from '../src/license-key.js';
import {pluginLicenseClient} from '../src/plugin-license.js';
import {activatePluginLicense} from '../src/cloud.js';

const now=Date.parse('2026-11-03T12:00:00Z');
const active={plan:'semester_license',activatedAt:now-1000,expiresAt:new Date(now+1000).toISOString()};
const expired=hours=>({...active,expiresAt:new Date(now-hours*3600000).toISOString()});
test('all definitive gate states and grace boundaries',()=>{
  assert.equal(gate.resolveGate(null,null,now,'1.1.0').state,'LOCKED_NEW');
  assert.equal(gate.resolveGate(active,{licensed:true,expires_at:active.expiresAt},now,'1.1.0').state,'UNLOCKED');
  assert.equal(gate.resolveGate(expired(72),{licensed:false,reason:'license_expired'},now,'1.1.0').state,'GRACE_WARN');
  assert.equal(gate.resolveGate(expired(73),{licensed:false,reason:'license_expired'},now,'1.1.0').state,'LOCKED_EXPIRED');
  assert.equal(gate.resolveGate(active,{licensed:false,reason:'license_revoked'},now,'1.1.0').state,'LOCKED_REVOKED');
  assert.equal(gate.resolveGate(active,{min_version:'1.2.0'},now,'1.1.0').state,'LOCKED_UPDATE');
  assert.equal(gate.resolveGate(active,{kill_switch:true,announcement:'Maintenance'},now,'1.1.0').state,'LOCKED_MAINT');
  assert.equal(gate.resolveGate(active,{min_version:'1.9.0',licensed:true},now,'1.10.0').state,'UNLOCKED');
});
test('uncertain paid-user responses fail open, even after 72 hours',()=>{
  for(const response of [null,{}, {licensed:false}, {error:'network'}, {error:'server'}, {error:'parse'}]) {
    const result=gate.resolveGate(expired(200),response,now,'1.1.0');
    assert.equal(result.state,'GRACE_WARN');assert.equal(result.allowed,true);
  }
  assert.equal(gate.resolveGate({...active,definitive:{licensed:false,reason:'license_revoked'}},null,now,'1.1.0').state,'LOCKED_REVOKED');
});
test('normalization accepts paste variants and preserves legacy UUID detection',()=>{
  const modern='AC-LIC-ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-ABCD';
  assert.equal(normalizeGateKey(' ac–lic–abcd efgh\njklm—npqr stuv wxyz 2345 abcd '),modern);
  assert.equal(normalizeGateKey('abcd efgh jklm npqr stuv wxyz 2345 abcd'),modern);
  assert.equal(formatGateKey('ac-lic-abcdefghijklmnop'),'ABCD-EFGH-IJKL-MNOP');
  assert.equal(normalizeGateKey('AC-LIC-ABCD-EFGH-IJKL-MNOP'),'AC-LIC-ABCD-EFGH-IJKL-MNOP');
  assert.equal(normalizeGateKey('12345678-1234-1234-1234-123456789abc'),'12345678-1234-1234-1234-123456789abc');
  for(const invalid of ['ABC','!'.repeat(32),'A'.repeat(33),'AC-LIC-'+'0'.repeat(32)]) assert.throws(()=>normalizeGateKey(invalid));
});

test('persisted revocation survives ambiguous status and harmless config replies',()=>{
  const cache={...active,definitive:{licensed:false,reason:'license_revoked'}};
  for(const reply of [{licensed:false,reason:'unknown'},{min_version:'1.0.0'},{error:'parse'},{}])assert.equal(gate.resolveGate(cache,reply,now,'1.1.0').state,'LOCKED_REVOKED');
  assert.equal(gate.resolveGate(cache,{licensed:true,expires_at:null},now,'1.1.0').state,'UNLOCKED');
});
test('activation deadline includes device registration and never starts a late activation request',{timeout:300},async()=>{
  const oldChrome=globalThis.chrome;let signal,calls=0,finish;
  globalThis.chrome={storage:{local:{set:async()=>{throw Error('must not store');}}}};
  try {
    const client=pluginLicenseClient({timeoutMs:25,ensureCloudDevice:options=>{signal=options.signal;return new Promise(resolve=>finish=resolve);},call:async()=>{calls++;return {ok:true};}});
    await assert.rejects(client.activatePluginLicense('AC-LIC-ABCD-EFGH-IJKL-MNOP'),/license_timeout/);
    assert.equal(signal.aborted,true);finish({attendanceCloudToken:'fixture-token'});await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,0);
  }finally {globalThis.chrome=oldChrome;}
});
test('actual license client leak canary: success and failure use one request and never persist or log key',async()=>{
  const oldChrome=globalThis.chrome,oldConsole=console.log;const store={},logs=[],otherRequests=[];
  globalThis.chrome={storage:{local:{set:async values=>Object.assign(store,values)}}};console.log=(...values)=>logs.push(values);
  try {
    for(const accepted of [true,false]) {
      let requests=0;
      const client=pluginLicenseClient({ensureCloudDevice:async()=>({attendanceCloudToken:'fixture-token'}),call:async(action,body)=>{
        if(action==='activate-plugin-license'){requests++;assert.equal(body.licenseKey,'AC-LIC-ZZZZ-YYYY-XXXX-WWWW');if(!accepted)throw Object.assign(Error('invalid_license_key'),{code:'invalid_license_key'});return {ok:true,plan:'lifetime_license',expires_at:null};}
        otherRequests.push(body);
      }});
      const request=client.activatePluginLicense('AC-LIC-ZZZZ-YYYY-XXXX-WWWW');if(accepted)await request;else await assert.rejects(request);
      assert.equal(requests,1);assert.doesNotMatch(JSON.stringify({store,logs,otherRequests}),/ZZZZ-YYYY-XXXX-WWWW/);
    }
  }finally {globalThis.chrome=oldChrome;console.log=oldConsole;}
});

test('a status request started before activation cannot revoke the newly activated license',async()=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;
  const store={attendanceCloudToken:'fixture-token',attendanceCloudDeviceId:'fixture-device',attendanceNtfyTopic:'fixture-topic',attendancePluginLicense:{plan:'old_license',activatedAt:1}};
  let release,started;const waiting=new Promise(resolve=>started=resolve);
  globalThis.chrome={runtime:{getManifest:()=>({version:'1.1.0'})},storage:{local:{get:async()=>({...store}),set:async value=>Object.assign(store,value)}}};
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.action==='plugin-license-status'){started();return new Promise(resolve=>release=()=>resolve(Response.json({licensed:false,reason:'license_revoked'})));}
    return Response.json({ok:true,plan:'lifetime_license',expires_at:null});
  };
  try {
    const pending=gate.getActivationGate({refresh:true});await waiting;
    await activatePluginLicense('AC-LIC-ABCD-EFGH-IJKL-MNOP');release();
    assert.equal((await pending).state,'UNLOCKED');assert.equal(store.attendancePluginLicense.plan,'lifetime_license');assert.equal(store.attendancePluginLicense.definitive,undefined);
  }finally {globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
test('license checks preserve an unresolved attendance alert badge',async()=>{
  const oldChrome=globalThis.chrome;let badge;
  globalThis.chrome={runtime:{getManifest:()=>({version:'1.1.0'})},action:{setBadgeText:async value=>badge=value.text},storage:{local:{get:async()=>({attendancePluginLicense:active,attendanceCloudDeviceId:'fixture-device',unresolvedAlert:{state:'failed'}})}}};
  try {assert.equal((await gate.getActivationGate()).allowed,true);assert.equal(badge,'!');}finally {globalThis.chrome=oldChrome;}
});

test('an alert arriving during license refresh is not cleared by its earlier storage snapshot',async()=>{
  const oldChrome=globalThis.chrome,oldFetch=globalThis.fetch;let badge;
  const store={attendancePluginLicense:active,attendanceCloudToken:'fixture-token',attendanceCloudDeviceId:'fixture-device',attendanceNtfyTopic:'fixture-topic'};
  globalThis.chrome={runtime:{getManifest:()=>({version:'1.1.0'})},action:{setBadgeText:async value=>badge=value.text},storage:{local:{get:async()=>({...store}),set:async value=>Object.assign(store,value)}}};
  globalThis.fetch=async()=>{store.unresolvedAlert={state:'failed'};return Response.json({licensed:true,plan:'lifetime_license',expires_at:null});};
  try {await gate.getActivationGate({refresh:true});assert.equal(badge,'!');}finally {globalThis.chrome=oldChrome;globalThis.fetch=oldFetch;}
});
