import test from 'node:test';
import assert from 'node:assert/strict';
import {periodTime,parseCellText} from '../src/timetable-fields.js';

test('maps period numbers using the configurable default clock',()=>{
  assert.deepEqual(periodTime(1),{start:'09:00',end:'10:00',needsReview:false});
  assert.deepEqual(periodTime(3,5,{startHour:7}),{start:'10:00',end:'13:00',needsReview:false});
  assert.deepEqual(periodTime(1,2,{startHour:8,minutesPerPeriod:45}),{start:'08:45',end:'10:15',needsReview:false});
});

test('uses detected header times as the source of truth while flagging disagreements',()=>{
  assert.deepEqual(periodTime(1,1,{header:{start:'09:00',end:'10:00'}}),{start:'09:00',end:'10:00',needsReview:false});
  assert.deepEqual(periodTime(1,1,{header:{start:'10:00',end:'11:00'}}),{start:'10:00',end:'11:00',needsReview:true});
  assert.deepEqual(periodTime(1,1,{header:{start:'08:00',end:'09:00'}}),{start:'08:00',end:'09:00',needsReview:true});
});

test('joins split course and type text, removes bars, and records conservative corrections',()=>{
  const parsed=parseCellText('COMP1313\n|-LA8\n3R0G6\nTutor A',{day:'Mo',date:'2026-10-05',start:'09:00',end:'10:00'});
  assert.deepEqual([parsed.code,parsed.type,parsed.room,parsed.lecturer],['COMP1313','LAB','3R006','Tutor A']);
  assert.equal(parsed.needsReview,true);
  assert.ok(parsed.fields.type.raw.includes('LA8'));
  assert.ok(parsed.fields.type.confidence<1);
  assert.equal(parsed.corrections.length,2);
});

test('parses explicit group and permits synthetic room aliases',()=>{
  const parsed=parseCellText('TEST1001 - TUT\nR101\nTutor A\nGroup 2',{day:'We',date:null,start:'11:00',end:'12:00'});
  assert.deepEqual([parsed.code,parsed.type,parsed.group,parsed.room],['TEST1001','TUT','2','R101']);
  assert.equal(parsed.course,'TEST1001-TUT Group 2');
});

test('joins a course code and lesson type separated onto adjacent OCR lines',()=>{
  const parsed=parseCellText('COMP1313\n-LEC',{day:'Mo',date:'2026-10-05',start:'09:00',end:'10:00'});
  assert.deepEqual([parsed.code,parsed.type,parsed.day,parsed.date,parsed.course],['COMP1313','LEC','Mo','2026-10-05','COMP1313-LEC']);
});

test('requires the four-letter and four-digit module code shape',()=>{
  const parsed=parseCellText('ABC1313 - LEC\n3R026\nMarwan',{day:'Mo',start:'10:00',end:'11:00'});
  assert.equal(parsed.code,'');
  assert.equal(parsed.needsReview,true);
});

test('emits a structured course row with date, weekday, type, room and lecturer',()=>{
  const parsed=parseCellText('COMP1313 - LEC\n3R026\nMarwan',{day:'Mo',date:'2026-10-05',start:'10:00',end:'11:00'});
  assert.deepEqual({date:parsed.date,weekday:parsed.day,course:parsed.code,type:parsed.type,room:parsed.room,lecturer:parsed.lecturer},
    {date:'2026-10-05',weekday:'Mo',course:'COMP1313',type:'LEC',room:'3R026',lecturer:'Marwan'});
});
