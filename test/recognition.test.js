import test from 'node:test';
import assert from 'node:assert/strict';
import {rowsFromPage} from '../src/recognition.js';

test('prefers grid cells and also retains dated rows found in extracted text', () => {
  const result=rowsFromPage({text:'2026-10-02 14:00-15:00 COMP1300 Lab',tokens:[
    {text:'Monday',x:100,y:10,width:60,height:15},{text:'Tuesday',x:300,y:10,width:60,height:15},
    {text:'09:00-10:00',x:10,y:50,width:80,height:15},{text:'COMP1311',x:100,y:50,width:90,height:15}
  ]});
  assert.deepEqual(result.map(x=>x.course),['COMP1311','COMP1300 Lab']);
});

test('reads an aSc week grid with days down the page and hour slots across it', () => {
  const tokens=[
    {text:'CS P1 - W1 (28/9-2/10/26) S1',x:90,y:0,width:250,height:20},
    {text:'9:00 - 10:00',x:100,y:50,width:90,height:12},
    {text:'10:00 - 11:00',x:200,y:50,width:90,height:12},
    {text:'11:00 - 12:00',x:300,y:50,width:90,height:12},
    {text:'12:00 - 13:00',x:400,y:50,width:90,height:12},
    {text:'Mo',x:10,y:120,width:30,height:22},
    {text:'COMP1313',x:208,y:107,width:72,height:12},
    {text:'-LEC',x:225,y:121,width:40,height:12},
    {text:'Tu',x:10,y:220,width:30,height:22},
    {text:'Group 1',x:430,y:185,width:55,height:10},
    {text:'COMP1314-LAB',x:310,y:205,width:170,height:14}
  ];
  assert.deepEqual(rowsFromPage({tokens}),[
    {kind:'dated',date:'2026-09-28',time:'10:00',endTime:'11:00',course:'COMP1313-LEC'},
    {kind:'dated',date:'2026-09-29',time:'11:00',endTime:'13:00',course:'COMP1314-LAB Group 1'}
  ]);
});

test('pairs OCR time words within each header cell', () => {
  const tokens=[
    {text:'9:00',x:100,y:40,width:40,height:14},{text:'-',x:145,y:40,width:8,height:14},{text:'10:00',x:160,y:40,width:45,height:14},
    {text:'10:00',x:220,y:40,width:45,height:14},{text:'-',x:270,y:40,width:8,height:14},{text:'11:00',x:285,y:40,width:45,height:14},
    {text:'Mo',x:10,y:100,width:30,height:20},{text:'Tu',x:10,y:200,width:30,height:20},
    {text:'COMP1313',x:230,y:85,width:75,height:14}
  ];
  assert.deepEqual(rowsFromPage({text:'W1 (28/9-2/10/26)',tokens}),[
    {kind:'dated',date:'2026-09-28',time:'10:00',endTime:'11:00',course:'COMP1313'}
  ]);
});
