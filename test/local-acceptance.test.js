import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const expectedPath=resolve('tests/local-only/expected.json'),actualPath=resolve('tests/local-only/actual.json'),imagePath=resolve('tests/local-only/CS-timetable.png');
const available=[expectedPath,actualPath,imagePath].every(existsSync);
test('local-only timetable acceptance fixture (private inputs)',{skip:!available},()=>{
  const expected=JSON.parse(readFileSync(expectedPath,'utf8')),actual=JSON.parse(readFileSync(actualPath,'utf8'));
  const fields=['day','date','start','end','code','type','group','room','lecturer'];
  const order=(a,b)=>String(a.day).localeCompare(String(b.day))||String(a.start).localeCompare(String(b.start))||String(a.code).localeCompare(String(b.code));
  expected.sort(order);actual.sort(order);
  assert.equal(actual.length,expected.length,'actual and expected lesson counts differ');
  let exactRows=0;const accuracy=Object.fromEntries(fields.map(field=>[field,{correct:0,total:expected.length}]));
  for(let index=0;index<expected.length;index++) {
    const row=actual[index],target=expected[index],wrong=[];
    for(const field of fields) {if((row[field]??'')===(target[field]??'')) accuracy[field].correct++;else wrong.push(field);}
    if(!wrong.length) exactRows++;else assert.equal(row.needsReview,true,`row ${index+1} has errors (${wrong.join(', ')}) without needsReview`);
    if(row.start!==target.start||row.end!==target.end) assert.equal(row.needsReview,true,`row ${index+1} has an unreviewed time mismatch`);
  }
  for(const value of Object.values(accuracy)) value.percent=Number((value.correct/value.total*100).toFixed(1));
  console.log(JSON.stringify({exactRows,total:expected.length,fieldAccuracy:accuracy,needsReview:actual.filter(row=>row.needsReview).length}));
  assert.ok(exactRows>=Math.ceil(expected.length*.9),'fewer than 90% of rows have all fields exactly correct');
});
