import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFormsUrl, buildFillPlan, verifyQuestions, assertDateAgreement, sameDateValue, validatePreSubmit} from '../src/forms.js';
import {fieldMappingForQuestion} from '../src/mapping.js';

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

test('skips optional Date questions without parsing or validating their date format',()=>{
  const questions=[{title:'Student ID',type:'text',required:true},{title:'Date',type:'date',required:false,placeholder:''}];
  const mapping=questions.map((q,i)=>({...q,field:i?'date':'student'}));
  const plan=buildFillPlan(questions,mapping,{student:'123'},'2026-10-02','COMP1311-LEC');
  assert.equal(plan[0].value,'123');
  assert.equal(plan[1].skip,true);
  assert.throws(()=>buildFillPlan([{...questions[1],required:true}],[mapping[1]],{},'2026-10-02','COMP1311-LEC'),/日期格式/);
});

test('matches dynamic radio options by meaning while retaining the actual option label',()=>{
  const questions=[
    {title:'Session type',type:'radio',options:['Attend a lecture session','Attend a tutorial session','Attend a laboratory session']},
    {title:'Student category',type:'radio',options:['Local student','International student']}
  ];
  const mapping=questions.map((question,index)=>({...question,field:index?'local':'delivery'}));
  assert.deepEqual(buildFillPlan(questions,mapping,{studentType:'international'},'2026-10-05','COMP1311-LAB').map(item=>item.value),['Attend a laboratory session','International student']);
});

test('compares actual date values against ISO expectation across form display formats',()=>{
  assert.equal(sameDateValue('10/5/2026','2026-10-05'),true);
  assert.equal(sameDateValue('10/5/2026','2026-10-05','M/d/yyyy'),true);
  assert.equal(sameDateValue('2026-10-05','10/5/2026'),true);
  assert.equal(sameDateValue('10/4/2026','2026-10-05'),false);
});

test('matches semantically renamed saved fields and uses current radio labels',()=>{
  const original=[
    {title:'Student ID',type:'text',required:true},
    {title:'Student name',type:'text',required:true},
    {title:'Module Delivery',type:'radio',required:true,options:['Lecture','Tutorial','Lab']}
  ];
  const mapping=original.map((question,index)=>({...question,field:['student','name','delivery'][index]}));
  const updated=[
    {...original[0],title:'ID number'},
    {...original[1],title:'Full Name'},
    {...original[2],title:'Session type',options:['Lecture session','Tutorial session','Laboratory session']}
  ];
  assert.deepEqual(buildFillPlan(updated,mapping,{student:'123',name:'Jane',studentType:'local'},'2026-10-05','COMP1311-LAB').map(entry=>entry.value),['123','Jane','Laboratory session']);
});

test('validates every required question and rejects unknown or empty required fields',()=>{
  const plan=[{type:'text',field:'student',value:'123',questionTitle:'ID number'}];
  const questions=[{title:'ID number',type:'text',required:true},{title:'Date attended',type:'date',required:true}];
  assert.deepEqual(validatePreSubmit(plan,questions,[{value:'123'}]),{ok:false,errors:['Date attended is required but is not mapped.']});
  assert.deepEqual(validatePreSubmit(plan,[questions[0]],[{value:''}]),{ok:false,errors:['ID number is empty.']});
  assert.deepEqual(validatePreSubmit(plan,[questions[0]],[{value:'123'}]),{ok:true,errors:[]});
  assert.equal(validatePreSubmit(plan,[],[{value:'123'}]).ok,false);
});

test('stops when semantic radio matching finds more than one candidate',()=>{
  const question={title:'Session type',type:'radio',required:true,options:['Lecture or Tutorial','Lecture','Laboratory']};
  const mapping=[{...question,field:'delivery'}];
  assert.equal(buildFillPlan([question],mapping,{student:'123'},'2026-10-05','COMP1311-LEC')[0].value,'Lecture');
  const mixed={...question,options:['Lecture or Tutorial','Laboratory']};
  assert.throws(()=>buildFillPlan([mixed],[{...mixed,field:'delivery'}],{student:'123'},'2026-10-05','COMP1311-LEC'),/没有匹配/);
});

test('fails validation if one mapped question disappears from the live form',()=>{
  const plan=[
    {type:'text',field:'student',value:'123',questionTitle:'Student ID'},
    {type:'text',field:'name',value:'Jane',questionTitle:'Full Name'}
  ];
  const result=validatePreSubmit(plan,[{title:'Full Name',type:'text',required:true}],[{value:'',valid:false},{value:'Jane',valid:true}]);
  assert.equal(result.ok,false);
  assert.match(result.errors.join(' '),/Student ID.*消失/);
});

test('supports the five expected attendance form layouts with their own confirmed question maps',()=>{
  const variants=[
    [{title:'ID number',type:'text',required:true}],
    [{title:'Student ID',type:'text',required:true},{title:'Full Name',type:'text',required:true},{title:'Date attended',type:'date',required:true,placeholder:'M/d/yyyy'},{title:'Session type',type:'radio',required:true,options:['Lecture','Tutorial','Lab']},{title:'Student category',type:'radio',required:true,options:['Local','International']}],
    [{title:'Student ID',type:'text',required:true},{title:'Date of class',type:'date',required:true,placeholder:'yyyy-MM-dd'},{title:'Session type',type:'radio',required:true,options:['Lecture','Tutorial','Laboratory']}],
    [{title:'University ID number',type:'text',required:true},{title:'Your name',type:'text',required:true}],
    [{title:'Student ID',type:'text',required:true},{title:'Date',type:'date',required:true,placeholder:'dd/MM/yyyy'},{title:'Module delivery',type:'radio',required:true,options:['Lecture class','Tutorial class','Laboratory class']}]
  ];
  for(const questions of variants) {
    const mapping=questions.map(question=>({...question,field:fieldMappingForQuestion(question,'COMP1311-LAB').selected}));
    assert.equal(mapping.every(entry=>entry.field),true);
    assert.doesNotThrow(()=>buildFillPlan(questions,mapping,{student:'123',name:'Jane',studentType:'local'},'2026-10-05','COMP1311-LAB'));
  }
});
