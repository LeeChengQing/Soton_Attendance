import {buildFillPlan,deliveryFromCourse} from './forms.js';

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

export function validateBinding(binding) {
  if(!binding?.verified) throw Error('尚未绑定并核对共用表单。');
  if(!binding.questions) return null;
  // Use representative answers solely to validate the mapping and available choices.
  // No course row is consulted or assigned a delivery here.
  const profile={student:'Student ID',name:'Name',studentType:'local'};
  const mapping=binding.mapping.map(entry=>{
    if(entry.field!=='delivery') return entry;
    let failure;
    for(const kind of ['lecture','tutorial','lab']) {
      const candidate={...entry,field:`delivery:${kind}`};
      try {buildFillPlan(binding.questions,[candidate],profile,'2026-10-14','');return candidate;}
      catch(error) {failure=error;}
    }
    throw failure;
  });
  buildFillPlan(binding.questions,mapping,profile,'2026-10-14','');
  return true;
}

export function resolveFillPlan(binding,session,profile,date) {
  if(!binding?.verified) throw Error(`${moduleKey(session.course)} 尚未绑定并核对共用表单。`);
  const kind=deliveryFromCourse(session.course,session.type);
  if(!binding.questions) return null;
  for(const entry of binding.mapping) {
    if(!entry.field?.startsWith('delivery:')) continue;
    const fixed=entry.field.split(':')[1];
    if((fixed==='laboratory'?'lab':fixed)!==kind) throw Error(`${session.course} 的固定课型与课程名称不一致，请重新核对共用表单。`);
  }
  return buildFillPlan(binding.questions,binding.mapping,profile,date,session.course,session.type);
}

export function validateBindingForCourse(binding,course,profile,date) {
  return resolveFillPlan(binding,typeof course==='object'?course:{course},profile,date);
}
