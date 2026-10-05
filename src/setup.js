import {bindingForCourse,moduleKey,validateBindingForCourse} from './bindings.js';
import {todayMalaysia} from './schedule.js';

export const itemTerminal=state=>['passed','failed','cancelled','timed_out'].includes(state);
export function coverageRevision(course,binding,profile) {
  const plan=validateBindingForCourse(binding,course,profile,todayMalaysia());
  if(!plan?.length) throw Error(`${moduleKey(course)} 需要重新读取并保存表单题目。`);
  return JSON.stringify({profile:{student:profile.student,name:profile.name,studentType:profile.studentType},url:binding.url,title:binding.title,questions:binding.questions,mapping:binding.mapping,answers:plan.map(e=>e.type==='date'?{...e,value:'<today>'}:e)});
}
export function buildVariants(tasks,bindings,profile) {
  const variants=new Map();
  for(const task of tasks) {
    const course=task.course,binding=bindingForCourse(bindings,course);
    const revision=coverageRevision(course,binding,profile);
    const plan=validateBindingForCourse(binding,course,profile,todayMalaysia());
    const delivery=plan.filter(e=>e.field.startsWith('delivery')).map(e=>e.value).join(' / ');
    const key=JSON.stringify([moduleKey(course),String(course).trim().toUpperCase().replace(/\s+/g,' '),binding.url,delivery,revision]);
    if(!variants.has(key)) variants.set(key,{id:crypto.randomUUID(),key,revision,course,delivery,state:'queued'});
  }
  if(!variants.size) throw Error('请先添加课程并核对表单绑定。');
  if(variants.size>200) throw Error('一次最多检查 200 个表单课型。');
  return [...variants.values()];
}
export const hasCoverage=(history,variant,after)=>history.some(session=>(!after||session.startedAt>=after)&&session.items?.some(item=>item.state==='passed'&&item.key===variant.key&&item.revision===variant.revision));
export function updateItem(session,tabId,state,detail='') {
  const item=session.items.find(row=>row.tabId===tabId);
  if(session.state!=='running'||!item||item.tabId!==tabId||itemTerminal(item.state)) throw Error('检查已结束或页面不匹配。');
  const allowed={opening:['filling','failed','cancelled','timed_out'],filling:['awaiting_confirmation','failed','cancelled','timed_out'],awaiting_confirmation:['failed','cancelled','timed_out']};
  if(!allowed[item.state]?.includes(state)) throw Error('无效的设置检查状态。');
  return {...session,items:session.items.map(row=>row===item?{...row,state,detail:String(detail).slice(0,500),at:new Date().toISOString()}:row)};
}
export function confirmItem(session,tabId,revision) {
  const item=session.items.find(row=>row.tabId===tabId);
  if(session.state!=='running'||item?.tabId!==tabId||item.state!=='awaiting_confirmation'||item.revision!==revision) throw Error('检查未就绪或配置已变化，请重新检查。');
  return {...session,items:session.items.map(row=>row===item?{...row,state:'passed',confirmedAt:new Date().toISOString()}:row)};
}
