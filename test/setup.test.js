import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVariants,coverageRevision,hasCoverage,confirmItem,updateItem} from '../src/setup.js';
const profile={student:'123',name:'Student',studentType:'local'};
const questions=[{title:'Student ID',type:'text'},{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Lab']}];
const binding={scope:'module',verified:true,url:'https://forms.office.com/Pages/ResponsePage.aspx?id=test',title:'COMP1311 Attendance',questions,mapping:[{...questions[0],field:'student'},{...questions[1],field:'delivery'}]};
const bindings={COMP1311:binding};
test('setup covers each delivery configuration once across all intended classes',()=>{
  const items=buildVariants(['COMP1311-LEC','COMP1311-LEC','COMP1311-LAB','COMP1311-TUT'].map(course=>({course})),bindings,profile);
  assert.equal(items.length,3);assert.equal(new Set(items.map(i=>i.key)).size,3);
});

test('all named course types remain independent even when their form has no delivery question',()=>{
  const simple={...binding,questions:[questions[0]],mapping:[binding.mapping[0]]};
  const items=buildVariants(['COMP1311-LEC','COMP1311-LAB','COMP1311-TUT','COMP1311-LEC'].map(course=>({course})),{COMP1311:simple},profile);
  assert.equal(items.length,3);
  assert.equal(hasCoverage([{items:[{...items[0],state:'passed'}]}],items[1]),false);
});
test('coverage excludes execution dates but changes for profile and binding revisions',()=>{
  const revision=coverageRevision('COMP1311-LEC',binding,profile);
  assert.equal(revision,coverageRevision('COMP1311-LEC',{...binding,lastTestDate:'2026-10-02'},profile));
  assert.notEqual(revision,coverageRevision('COMP1311-LEC',binding,{...profile,student:'456'}));
  assert.notEqual(revision,coverageRevision('COMP1311-LEC',{...binding,title:'Changed'},profile));
  const item=buildVariants([{course:'COMP1311-LEC'}],bindings,profile)[0];
  assert.equal(hasCoverage([{items:[{...item,state:'awaiting_confirmation'}]}],item),false);
  assert.equal(hasCoverage([{items:[{...item,state:'passed'}]}],item),true);
  assert.equal(hasCoverage([{startedAt:'2026-09-01T00:00:00Z',items:[{...item,state:'passed'}]}],item,'2026-10-01T00:00:00Z'),false);
});
test('filling alone cannot pass and stale confirmation is rejected',()=>{
  const item=buildVariants([{course:'COMP1311-LEC'}],bindings,profile)[0];
  const session={id:'check',state:'running',current:0,items:[{...item,state:'filling',tabId:1}]};
  assert.throws(()=>confirmItem(session,1,item.revision));
  const ready=updateItem(session,1,'awaiting_confirmation');
  assert.throws(()=>confirmItem(ready,1,'stale'));
  assert.equal(confirmItem(ready,1,item.revision).items[0].state,'passed');
  assert.equal(updateItem(session,1,'cancelled').items[0].state,'cancelled');
});

test('independent course tabs can finish in either order',()=>{
  const variants=buildVariants([{course:'COMP1311-LEC'},{course:'COMP1311-LAB'}],bindings,profile);
  let session={state:'running',current:0,items:variants.map((i,n)=>({...i,state:'filling',tabId:n+1}))};
  session=updateItem(session,2,'awaiting_confirmation');
  session=confirmItem(session,2,variants[1].revision);
  assert.equal(session.items[1].state,'passed');assert.equal(session.items[0].state,'filling');
  session=updateItem(session,1,'awaiting_confirmation');
  assert.equal(confirmItem(session,1,variants[0].revision).items.every(i=>i.state==='passed'),true);
});
