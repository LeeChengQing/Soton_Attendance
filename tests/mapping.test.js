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

test('a Name text question with the Forms single-line hint maps only to the name profile field',()=>{
  const result=fieldMappingForQuestion({title:'2.NameSingle line text. (text)',type:'text',options:[]});
  assert.equal(result.selected,'name');
  assert.deepEqual(result.choices.map(([field])=>field),['name']);
});

test('unknown questions do not offer unrelated field categories', () => {
  assert.deepEqual(fieldMappingForQuestion({title:'Other text',type:'text',options:[]},'COMP1311').choices.map(([field])=>field),['','student','name']);
  assert.deepEqual(fieldMappingForQuestion({title:'Other choice',type:'radio',options:['Yes','No']},'COMP1311').choices.map(([field])=>field),['']);
});

test('semantically recognizes alternate student ID, name, and date wording', () => {
  const questions=[
    {title:'Enter ID number',type:'text'},
    {title:'Your Full Name',type:'text'},
    {title:'Date of attendance',type:'date'}
  ];
  assert.deepEqual(questions.map(question=>fieldMappingForQuestion(question).selected),['student','name','date']);
});

test('recognizes delivery and student type options embedded in longer labels', () => {
  const delivery=fieldMappingForQuestion({title:'How will you attend?',type:'radio',options:['Attend a Lecture','Attend a Tutorial','Attend a Lab']},'COMP1312-LAB');
  const identity=fieldMappingForQuestion({title:'Student category',type:'radio',options:['I am a Local student','I am an International student']});
  assert.equal(delivery.selected,'delivery');
  assert.equal(identity.selected,'local');
});

test('does not preselect an ambiguous mixed delivery option',()=>{
  const question={title:'Session type',type:'radio',options:['Lecture or Tutorial','Laboratory']};
  assert.equal(fieldMappingForQuestion(question,'COMP1311-LEC').selected,'');
});

test('ignores negative identity labels when choosing local or international',()=>{
  const question={title:'Student category',type:'radio',options:['Not a local student','Local student','International student']};
  assert.equal(fieldMappingForQuestion(question).selected,'local');
});
