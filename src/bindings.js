import {buildFillPlan} from './forms.js';

export function moduleKey(course) {
  const text=String(course||'').trim();
  return text.match(/\b[A-Za-z]{2,}\d{3,}\b/)?.[0].toUpperCase()||text;
}

export function bindingForCourse(bindings,course) {
  const key=moduleKey(course),binding=bindings?.[key];
  return binding?.scope==='module'||String(course||'').trim()===key?binding:undefined;
}

export function legacyLinkSuggestion(bindings,courses) {
  const urls=[...new Set(courses.map(course=>bindings?.[course]?.url).filter(Boolean))];
  return {url:urls.length===1?urls[0]:'',conflict:urls.length>1};
}

export function validateBindingForCourse(binding,course,profile,date) {
  if(!binding?.verified) throw Error(`${moduleKey(course)} 尚未绑定并核对共用表单。`);
  if(!binding.questions) return null;
  const plan=buildFillPlan(binding.questions,binding.mapping,profile,date,course);
  for(const [i,entry] of binding.mapping.entries()) {
    if(!entry.field?.startsWith('delivery:')) continue;
    const automatic=binding.mapping.map((item,index)=>index===i?{...item,field:'delivery'}:item);
    let expected;
    try {expected=buildFillPlan(binding.questions,automatic,profile,date,course)[i].value;}
    catch(error) {if(/无法判断此课程类型/.test(error.message)) continue;throw error;}
    if(plan[i].value!==expected) throw Error(`${course} 的固定课型与课程名称不一致，请重新核对共用表单。`);
  }
  return plan;
}
