import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFormsUrl, buildFillPlan, verifyQuestions, assertDateAgreement, sameDateValue} from '../src/forms.js';

test('accepts Microsoft Forms response and short URLs but rejects unrelated hosts', () => {
  assert.equal(validateFormsUrl('https://forms.office.com/r/AbC123').href,'https://forms.office.com/r/AbC123');
  assert.equal(validateFormsUrl('https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=abc').searchParams.get('id'),'abc');
  assert.throws(()=>validateFormsUrl('https://evil.example/r/AbC123'));
});

test('stops if computer date and Malaysia date disagree with class date', () => {
  assert.doesNotThrow(()=>assertDateAgreement('2026-10-02','2026-10-02','2026-10-02'));
  assert.throws(()=>assertDateAgreement('2026-10-02','2026-10-02','2026-10-01'),/电脑/);
});

test('compares calendar dates despite leading-zero differences and rejects yesterday', () => {
  assert.equal(sameDateValue('2026/9/30','2026/09/30'),true);
  assert.equal(sameDateValue('30/09/2026','30/9/2026'),true);
  assert.equal(sameDateValue('2026/9/29','2026/09/30'),false);
  assert.equal(sameDateValue('2026/9/30 extra','2026/09/30'),false);
});

test('maps confirmed form questions and detects a later schema change', () => {
  const questions=[{title:'Student ID',type:'text',options:[]},{title:'Student name',type:'text',options:[]}];
  const mapping=[{title:'Student ID',type:'text',field:'student'},{title:'Student name',type:'text',field:'name'}];
  assert.equal(verifyQuestions(questions,mapping),true);
  assert.equal(verifyQuestions([{...questions[0],title:'Other ID'},questions[1]],mapping),false);
  assert.deepEqual(buildFillPlan(questions,mapping,{student:'123',name:'Jane',studentType:'local'},'2026-10-02').map(x=>x.value),['123','Jane']);
});

test('chooses Lecture, Tutorial or Laboratory from the course type', () => {
  const questions=[{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']}];
  const mapping=[{...questions[0],field:'delivery'}];
  const profile={student:'123',name:'Jane',studentType:'local'};
  assert.equal(buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1312-LAB Group 1')[0].value,'Laboratory');
  assert.equal(buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1311-TUT')[0].value,'Tutorial');
  assert.equal(buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1312-LEC')[0].value,'Lecture');
});

test('keeps supporting forms whose lab choice is written Lab', () => {
  const questions=[{title:'Module Delivery',type:'radio',options:['Lecture','Lab']}];
  const mapping=[{title:'Module Delivery',type:'radio',options:['Lecture','Lab'],field:'delivery'}];
  const profile={student:'123',name:'Jane',studentType:'local'};
  assert.equal(buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1312-LAB Group 1')[0].value,'Lab');
  assert.equal(buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1312-LEC')[0].value,'Lecture');
  assert.throws(()=>buildFillPlan(questions,mapping,profile,'2026-10-02','COMP1311-TUT'),/没有匹配/);
});

test('allows a course-specific fixed Lab choice', () => {
  const questions=[{title:'Module Delivery',type:'radio',options:['Lecture','Lab']}];
  const mapping=[{title:'Module Delivery',type:'radio',options:['Lecture','Lab'],field:'delivery:lab'}];
  assert.equal(buildFillPlan(questions,mapping,{student:'123',name:'Jane'},'2026-10-02','COMP1312-LAB Group 1')[0].value,'Lab');
});

test('allows fixed Tutorial and student identity choices', () => {
  const questions=[
    {title:'Module Delivery',type:'radio',options:['Lecture','Tutorial','Laboratory']},
    {title:'Please choose one from the below',type:'radio',options:["I'm a Local Student","I'm an International Student"]}
  ];
  const mapping=[{...questions[0],field:'delivery:tutorial'},{...questions[1],field:'local:international'}];
  assert.deepEqual(buildFillPlan(questions,mapping,{student:'123',name:'Jane',studentType:'local'},'2026-10-02','COMP1311-TUT').map(x=>x.value),['Tutorial',"I'm an International Student"]);
});

test('rejects legacy mappings that assign a field to the wrong question type', () => {
  const profile={student:'123',name:'Jane',studentType:'local'};
  assert.throws(()=>buildFillPlan([{title:'Student ID',type:'text',options:[]}],[{title:'Student ID',type:'text',options:[],field:'delivery'}],profile,'2026-10-02','COMP1311-LEC'),/题型/);
  assert.throws(()=>buildFillPlan([{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial']}],[{title:'Module Delivery',type:'radio',options:['Lecture','Tutorial'],field:'student'}],profile,'2026-10-02','COMP1311-LEC'),/题型/);
});
