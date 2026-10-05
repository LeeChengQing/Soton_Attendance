import test from 'node:test';
import assert from 'node:assert/strict';

let collectBindingInspectionTargets;
try {
  ({collectBindingInspectionTargets}=await import('../src/binding-inspection.js'));
} catch {
  collectBindingInspectionTargets=undefined;
}

test('collects every linked binding in card order for one batch',()=>{
  assert.equal(typeof collectBindingInspectionTargets,'function');
  const targets=collectBindingInspectionTargets([
    {key:'COMP1311',url:'https://forms.office.com/r/one'},
    {key:'COMP1312',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=two'}
  ],value=>({href:value}));
  assert.deepEqual(targets,[
    {key:'COMP1311',url:'https://forms.office.com/r/one'},
    {key:'COMP1312',url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=two'}
  ]);
});

test('rejects the batch before opening anything when a card has no link',()=>{
  assert.equal(typeof collectBindingInspectionTargets,'function');
  assert.throws(()=>collectBindingInspectionTargets([
    {key:'COMP1311',url:'https://forms.office.com/r/one'},
    {key:'COMP1312',url:''}
  ],value=>({href:value})),/COMP1312/);
});
