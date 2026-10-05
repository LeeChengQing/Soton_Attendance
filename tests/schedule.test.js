import test from 'node:test';
import assert from 'node:assert/strict';
import {parseScheduleText, parseScheduleTokens, occurrencesBetween, mergeSessions, toWeeklySession, triggerTimestamp} from '../src/schedule.js';

test('turns a dated timetable row into an unbounded weekly class', () => {
  const weekly=toWeeklySession({id:'lab',kind:'dated',date:'2026-09-30',course:'COMP1312-LAB Group 1',time:'15:00',endTime:'17:00',createdAt:'2026-09-29T00:00:00.000Z'});
  assert.equal(weekly.kind,'weekly');
  assert.equal(weekly.weekday,3);
  assert.equal(weekly.date,undefined);
  assert.equal(weekly.startDate,undefined);
  assert.equal(weekly.endDate,undefined);
  assert.equal(occurrencesBetween([weekly],'2027-01-06','2027-01-06').length,1);
});

test('removes old term limits and deduplicates the same lesson across imported weeks', () => {
  const old=toWeeklySession({id:'a',kind:'weekly',weekday:1,course:'COMP1311',time:'09:00',endTime:'10:00',startDate:'2026-09-28',endDate:'2026-10-02'});
  const next=toWeeklySession({id:'b',kind:'dated',date:'2026-10-05',course:'COMP1311',time:'09:00',endTime:'10:00'});
  assert.equal(mergeSessions([old],[next]).length,1);
  assert.equal(occurrencesBetween([old],'2027-01-04','2027-01-04').length,1);
});

test('parses a weekly course row and a dated course row', () => {
  const rows = parseScheduleText('Monday 09:00-10:30 COMP1311 Lecture\n2026-10-02 14:00-15:00 COMP1300 Lab');
  assert.deepEqual(rows.map(({course,time,kind})=>({course,time,kind})), [
    {course:'COMP1311 Lecture',time:'09:00',kind:'weekly'},
    {course:'COMP1300 Lab',time:'14:00',kind:'dated'}
  ]);
});

test('expands weekly and dated sessions without excluding a second class on the same day', () => {
  const sessions=[
    {id:'a',course:'COMP1311',kind:'weekly',weekday:5,time:'09:00',endTime:'10:00',startDate:'2026-10-01',endDate:'2026-10-31',exceptions:[]},
    {id:'b',course:'COMP1311',kind:'weekly',weekday:5,time:'14:00',endTime:'15:00',startDate:'2026-10-01',endDate:'2026-10-31',exceptions:[]},
    {id:'c',course:'COMP1300',kind:'dated',date:'2026-10-02',time:'16:00',endTime:'17:00'}
  ];
  const actual=occurrencesBetween(sessions,'2026-10-02','2026-10-02');
  assert.equal(actual.length,3);
  assert.deepEqual(actual.map(x=>x.key),['comp1311:2026-10-02:09:00','comp1311:2026-10-02:14:00','comp1300:2026-10-02:16:00']);
});

test('the same course occurrence keeps its submission key after reimport', () => {
  const first={id:'first',course:'COMP1311',kind:'dated',date:'2026-10-02',time:'09:00',endTime:'10:00'};
  const second={...first,id:'replacement'};
  assert.equal(occurrencesBetween([first],'2026-10-02','2026-10-02')[0].key,occurrencesBetween([second],'2026-10-02','2026-10-02')[0].key);
});

test('excludes semester exception dates and deduplicates imported sessions', () => {
  const row={id:'a',course:'COMP1311',kind:'weekly',weekday:5,time:'09:00',endTime:'10:00',startDate:'2026-10-01',endDate:'2026-10-31',exceptions:['2026-10-02']};
  assert.equal(occurrencesBetween([row],'2026-10-02','2026-10-02').length,0);
  assert.equal(mergeSessions([row],[{...row,id:'new'}]).length,1);
});

test('schedules automatic check-in five minutes before class end', () => {
  const occurrence={date:'2026-10-02',time:'09:00',endTime:'10:00'};
  assert.equal(triggerTimestamp(occurrence),Date.parse('2026-10-02T09:55:00+08:00'));
});

test('parses a timetable grid by day columns and time rows', () => {
  const tokens=[
    {text:'Monday',x:100,y:10,width:60,height:15},{text:'Tuesday',x:300,y:10,width:60,height:15},
    {text:'09:00-10:00',x:10,y:50,width:80,height:15},{text:'COMP1311',x:100,y:50,width:90,height:15},{text:'COMP1300',x:300,y:50,width:90,height:15}
  ];
  const rows=parseScheduleTokens(tokens);
  assert.deepEqual(rows.map(x=>[x.course,x.weekday,x.time]),[['COMP1311',1,'09:00'],['COMP1300',2,'09:00']]);
});

test('parses grid time ranges split into separate OCR words', () => {
  const tokens=[
    {text:'Monday',x:120,y:10,width:70,height:15},{text:'Tuesday',x:340,y:10,width:70,height:15},
    {text:'09:00',x:10,y:50,width:42,height:15},{text:'-',x:55,y:50,width:8,height:15},{text:'10:00',x:66,y:50,width:45,height:15},
    {text:'COMP1311',x:130,y:50,width:100,height:15}
  ];
  assert.deepEqual(parseScheduleTokens(tokens).map(x=>x.course),['COMP1311']);
});

test('keeps scanned PDF grid rows for the same course on different weekdays',()=>{
  const rows=[
    {day:'Mo',start:'09:00',end:'10:00',course:'COMP1313-LEC'},
    {day:'Tu',start:'09:00',end:'10:00',course:'COMP1313-LEC'}
  ];
  assert.equal(mergeSessions([],rows).length,2);
});
