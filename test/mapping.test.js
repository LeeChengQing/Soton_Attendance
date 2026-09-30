import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldMappingForQuestion} from '../src/mapping.js';

test('each known question shows only choices from its own category', () => {
  const questions=[
    {title:'1.Enter your University Student ID Number',type:'text',options:[]},
    {title:'2.Name',type:'text',options:[]},
    {title:'3.Date of Class the attended',type:'date',options:[]},
    {title:'4.Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']},
    {title:'5.Please choose one from the below',type:'radio',options:["I'm a Local Student","I'm an International Student"]}
  ];
  const fields=questions.map(question=>fieldMappingForQuestion(question,'COMP1311-TUT'));
  assert.deepEqual(fields.map(item=>item.selected),['student','name','date','delivery','local']);
  assert.deepEqual(fields.map(item=>item.choices.map(([field])=>field)),[
    ['student'],['name'],['date'],['delivery','delivery:lecture','delivery:tutorial','delivery:lab'],['local','local:local','local:international']
  ]);
});

test('unknown questions do not offer unrelated field categories', () => {
  assert.deepEqual(fieldMappingForQuestion({title:'Other text',type:'text',options:[]},'COMP1311').choices.map(([field])=>field),['','student','name']);
  assert.deepEqual(fieldMappingForQuestion({title:'Other choice',type:'radio',options:['Yes','No']},'COMP1311').choices.map(([field])=>field),['']);
});
