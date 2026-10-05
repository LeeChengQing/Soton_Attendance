import test from 'node:test';
import assert from 'node:assert/strict';
import {isExplicitSuccess,submissionSignals,questionDiff,normalizeComparable,verifyQuestions,buildFillPlan,validatePreSubmit} from '../src/forms.js';

test('normalizes whitespace, case, and full-width punctuation for comparison',()=>{
  assert.equal(normalizeComparable(' Ｓｔｕｄｅｎｔ　ID\n '),'student id');
});

test('recognizes required English success messages without exposing matched text',()=>{
  assert.equal(isExplicitSuccess('Your answers have been submitted successfully.'),'en_answers_submitted');
  assert.equal(isExplicitSuccess('Your response was submitted'),'en_response_submitted');
});

test('recognizes Simplified Chinese and Malay success messages',()=>{
  assert.equal(isExplicitSuccess('您的响应已提交'),'zh_response_submitted');
  assert.equal(isExplicitSuccess('Terima kasih, respons anda telah dihantar.'),'ms_response_submitted');
});

test('structure-only evidence is pending and never success',()=>{
  const result=submissionSignals({questionCount:2,submitVisible:true},{questionCount:0,submitVisible:false},{structureSelectorsEnabled:true});
  assert.deepEqual(result,{state:'submitted_pending_confirmation',signal:'structure_change'});
});

test('real sample mode stays structure-disabled when selectors are unavailable',()=>{
  const result=submissionSignals({questionCount:2,submitVisible:true},{questionCount:0,submitVisible:false},{structureSelectorsEnabled:false});
  assert.deepEqual(result,{state:'submitted_pending_confirmation',signal:'none'});
});

test('explicit text wins over structure evidence',()=>{
  const result=submissionSignals({questionCount:2,submitVisible:true},{text:'Your answers have been submitted successfully.',questionCount:0,submitVisible:false},{structureSelectorsEnabled:false});
  assert.deepEqual(result,{state:'success',signal:'en_answers_submitted'});
});

test('no text and no enabled structure signal is pending',()=>{
  const result=submissionSignals({questionCount:2,submitVisible:true},{questionCount:2,submitVisible:true},{structureSelectorsEnabled:false});
  assert.deepEqual(result,{state:'submitted_pending_confirmation',signal:'none'});
});

test('validates mapped optional answers and rejects conflicting radio selections',()=>{
  const plan=[{questionTitle:'Module Delivery',type:'radio',value:'Tutorial'}];
  const questions=[{title:'Module Delivery',type:'radio',required:false,options:['Lecture','Tutorial']}];
  assert.equal(validatePreSubmit(plan,questions,[{value:'Tutorial',checked:true,selectedValues:['Tutorial']}]).ok,true);
  assert.equal(validatePreSubmit(plan,questions,[{value:'Tutorial',checked:false,selectedValues:['Lecture']}]).ok,false);
  assert.equal(validatePreSubmit(plan,questions,[{value:'Tutorial',checked:true,selectedValues:['Lecture','Tutorial']}]).ok,false);
});

const expected=[
  {title:'Student ID',type:'text',options:[]},
  {title:'Delivery',type:'radio',options:['Lecture','Tutorial']},
];

test('question diff ignores order but reports added, deleted, renamed, and option changes',()=>{
  assert.deepEqual(questionDiff(expected,[expected[1],expected[0]]),{added:[],deleted:[],renamed:[],options:[]});
  assert.deepEqual(questionDiff(expected,[expected[0]]).deleted,['delivery']);
  assert.deepEqual(questionDiff(expected,[{...expected[0],title:'Student number'},expected[1]]).renamed,[{from:'student id',to:'student number'}]);
  assert.deepEqual(questionDiff(expected,[expected[0],{...expected[1],options:['Lecture','Lab']}]).options,[{title:'delivery',added:['lab'],removed:['tutorial']}]);
  assert.deepEqual(questionDiff(expected,[...expected,{title:'Name',type:'text',options:[]}]).added,['name']);
});

test('verification and fill plan use normalized question titles instead of indexes',()=>{
  const mapping=[{...expected[0],field:'student'},{...expected[1],field:'delivery'}];
  const reordered=[expected[1],expected[0]];
  assert.equal(verifyQuestions(reordered,mapping),true);
  assert.deepEqual(buildFillPlan(reordered,mapping,{student:'123',name:'Jane',studentType:'local'},'2026-10-05','COMP1311-LEC').map(entry=>entry.field),['student','delivery']);
});
