import test from 'node:test';
import assert from 'node:assert/strict';
import {moduleKey,bindingForCourse,legacyLinkSuggestion,validateBindingForCourse} from '../src/bindings.js';

test('lecture, lab and tutorial variants share one module binding key', () => {
  assert.equal(moduleKey('COMP1311-LEC'),'COMP1311');
  assert.equal(moduleKey('COMP1311-LAB Group 1'),'COMP1311');
  assert.equal(moduleKey('COMP1311-TUT'),'COMP1311');
  assert.equal(moduleKey('Seminar'),'Seminar');
  const bindings={COMP1311:{url:'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=shared',verified:true,scope:'module'}};
  assert.equal(bindingForCourse(bindings,'COMP1311-TUT'),bindings.COMP1311);
});

test('old variant links can be suggested only when they agree', () => {
  const courses=['COMP1311-LEC','COMP1311-LAB Group 1','COMP1311-TUT'];
  const same={'COMP1311-LEC':{url:'https://forms.office.com/r/shared'},'COMP1311-TUT':{url:'https://forms.office.com/r/shared'}};
  assert.deepEqual(legacyLinkSuggestion(same,courses),{url:'https://forms.office.com/r/shared',conflict:false});
  const different={...same,'COMP1311-TUT':{url:'https://forms.office.com/r/other'}};
  assert.deepEqual(legacyLinkSuggestion(different,courses),{url:'',conflict:true});
});

test('a legacy variant binding is not silently used as the shared module binding', () => {
  const bindings={'COMP1311-LEC':{url:'https://forms.office.com/r/lecture',verified:true}};
  assert.equal(bindingForCourse(bindings,'COMP1311-LAB Group 1'),undefined);
  assert.equal(bindingForCourse({COMP1311:{verified:true}},'COMP1311-TUT'),undefined);
});

test('a shared link still requires the right delivery answer for each course variant', () => {
  const questions=[{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']}];
  const binding={verified:true,scope:'module',questions,mapping:[{...questions[0],field:'delivery:lab'}]};
  assert.doesNotThrow(()=>validateBindingForCourse(binding,'COMP1311-LAB Group 1',{student:'1',name:'A'},'2026-10-01'));
  assert.throws(()=>validateBindingForCourse(binding,'COMP1311-TUT',{student:'1',name:'A'},'2026-10-01'),/课型/);
  binding.mapping[0].field='delivery';
  assert.equal(validateBindingForCourse(binding,'COMP1311-TUT',{student:'1',name:'A'},'2026-10-01')[0].value,'Tutorial');
});
