import test from 'node:test';
import assert from 'node:assert/strict';
import {filterOtherLabGroups,normalizeTimetableGroup} from '../src/timetable-groups.js';

test('group selection filters only known mismatched Lab sessions',()=>{
  const rows=[
    {type:'LEC',group:'1',course:'COMP1311-LEC Group 1'},
    {type:'TUT',group:'1',course:'COMP1311-TUT Group 1'},
    {type:'LAB',group:'1',course:'COMP1311-LAB Group 1'},
    {type:'LAB',group:'2',course:'COMP1311-LAB Group 2'},
    {type:'LAB',group:'',course:'COMP1311-LAB'},
    {type:'LAB',group:'',course:'COMP1311-LAB Group 3'}
  ];
  assert.deepEqual(filterOtherLabGroups(rows,'2').map(row=>row.course),[
    'COMP1311-LEC Group 1','COMP1311-TUT Group 1','COMP1311-LAB Group 2','COMP1311-LAB'
  ]);
});

test('group 3 works and missing or invalid preferences do not filter rows',()=>{
  const rows=[
    {type:'LAB',group:'1',course:'COMP1311-LAB Group 1'},
    {type:'LAB',group:'3',course:'COMP1311-LAB Group 3'},
    {type:'LAB',course:'COMP1311-LAB Group 2'}
  ];
  assert.deepEqual(filterOtherLabGroups(rows,'3').map(row=>row.course),['COMP1311-LAB Group 3']);
  assert.equal(filterOtherLabGroups(rows,'all'),rows);
  assert.equal(filterOtherLabGroups(rows,undefined),rows);
  assert.equal(filterOtherLabGroups(rows,'9'),rows);
});

test('normalizes old and invalid profile group values to do not filter',()=>{
  assert.equal(normalizeTimetableGroup('1'),'1');
  assert.equal(normalizeTimetableGroup('2'),'2');
  assert.equal(normalizeTimetableGroup('3'),'3');
  assert.equal(normalizeTimetableGroup(undefined),'all');
  assert.equal(normalizeTimetableGroup('unexpected'),'all');
});
