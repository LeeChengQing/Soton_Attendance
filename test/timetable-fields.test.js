import test from 'node:test';
import assert from 'node:assert/strict';
import {periodTime,parseCellText} from '../src/timetable-fields.js';

test('maps period numbers using the configurable default clock',()=>{
  assert.deepEqual(periodTime(1),{start:'09:00',end:'10:00',needsReview:false});
  assert.deepEqual(periodTime(3,5,{startHour:7}),{start:'10:00',end:'13:00',needsReview:false});
  assert.deepEqual(periodTime(1,2,{startHour:8,minutesPerPeriod:45}),{start:'08:45',end:'10:15',needsReview:false});
});

test('marks header time conflicts for review instead of overriding mapped time',()=>{
  assert.deepEqual(periodTime(1,1,{header:{start:'09:00',end:'10:00'}}),{start:'09:00',end:'10:00',needsReview:false});
  assert.equal(periodTime(1,1,{header:{start:'08:00',end:'09:00'}}).needsReview,true);
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
});

test('joins a course code and lesson type separated onto adjacent OCR lines',()=>{
  const parsed=parseCellText('COMP1313\n-LEC',{day:'Mo',date:'2026-10-05',start:'09:00',end:'10:00'});
  assert.deepEqual([parsed.code,parsed.type,parsed.day,parsed.date],['COMP1313','LEC','Mo','2026-10-05']);
});
