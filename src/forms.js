const HOSTS=new Set(['forms.office.com','forms.cloud.microsoft']);
export const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
export const normalizeComparable=value=>normalize(String(value??'').normalize('NFKC'));

function calendarDate(value,order='') {
  const text=String(value||'').normalize('NFKC').trim();
  if(!/^\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}$/.test(text)) return [];
  const parts=text.match(/\d+/g);
  if(!parts||parts.length!==3) return [];
  let y,m,d;
  if(order) {
    const names=order.split(/[/.-]/).map(part=>part.toLowerCase());
    const values=Object.fromEntries(names.map((name,index)=>[name[0],Number(parts[index])]));
    ({y,m,d}=values);
  } else if(parts[0].length===4) [y,m,d]=parts.map(Number);
  else if(parts[2].length===4) {
    const [first,second,year]=parts.map(Number);
    const candidates=[[year,first,second],[year,second,first]];
    return candidates.map(value=>canonicalDate(...value)).filter(Boolean);
  } else return [];
  const normalized=canonicalDate(y,m,d);
  return normalized?[normalized]:[];
}

function canonicalDate(year,month,day) {
  if(!Number.isInteger(year)||!Number.isInteger(month)||!Number.isInteger(day)) return null;
  const date=new Date(Date.UTC(year,month-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

export function sameDateValue(actual,expected,formatHint='') {
  const hint=formatHint.match(/(?:yyyy|yy|MM|M|dd|d)([/.-])(?:yyyy|yy|MM|M|dd|d)(?:\1)(?:yyyy|yy|MM|M|dd|d)/i)?.[0]||'';
  const iso=/^\d{4}-\d{2}-\d{2}$/.test(String(expected||''));
  const actualIso=/^\d{4}-\d{2}-\d{2}$/.test(String(actual||''));
  const expectedCanonical=calendarDate(expected,iso?'':hint),actualCanonical=calendarDate(actual,actualIso?'':hint);
  return expectedCanonical.some(date=>actualCanonical.includes(date));
}

export function validatePreSubmit(plan=[],questions=[],answers=[]) {
  const errors=[],mapped=new Map(plan.map((entry,index)=>[normalizeComparable(entry.questionTitle),{...entry,answer:answers[index]}]));
  if(!questions.length) errors.push('无法读取表单题目。');
  const currentTitles=new Set(questions.map(question=>normalizeComparable(question.title)));
  for(const entry of plan) if(!entry.skip&&!currentTitles.has(normalizeComparable(entry.questionTitle))) errors.push(`${entry.questionTitle||'已映射题目'}已从表单中消失。`);
  for(const question of questions) {
    const title=String(question.title||'').trim()||'Untitled question';
    const entry=mapped.get(normalizeComparable(title));
    if(question.required===false&&(!entry||entry.skip)) continue;
    if(!entry||entry.skip) {errors.push(`${title} is required but is not mapped.`);continue;}
    const answer=entry.answer;
    if(!answer||answer.valid===false||answer.value==null||String(answer.value).trim()==='') {errors.push(`${title} is empty.`);continue;}
    if(entry.type==='radio'&&answer.checked!==true) errors.push(`${title} has no selected option.`);
    if(entry.type==='radio'&&Array.isArray(answer.selectedValues)&&answer.selectedValues.length>1) errors.push(`${title} has conflicting selections.`);
    if(entry.type==='date'&&!sameDateValue(answer.value,entry.expectedDate||entry.value,entry.dateFormat||'')) errors.push(`${title} does not match the expected date.`);
    if(entry.type==='text'&&String(answer.value)!==String(entry.value)) errors.push(`${title} does not match the expected value.`);
    if(entry.type==='radio'&&String(answer.value)!==String(entry.value)) errors.push(`${title} does not match the expected option.`);
  }
  return {ok:errors.length===0,errors};
}

export function validateFormsUrl(value) {
  let url;
  try {url=new URL(String(value).trim());} catch {throw Error('二维码或链接不是有效网址。');}
  if(url.protocol!=='https:' || url.username || url.password || url.port || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error('只接受 Microsoft Forms 的填写链接。');
  if(/^\/Pages\//i.test(url.pathname) && !url.searchParams.get('id')) throw Error('表单链接缺少 ID。');
  url.hash='';
  return url;
}

export function verifyQuestions(questions,mapping) {
  if(!Array.isArray(questions)||questions.length!==mapping?.length) return false;
  const actual=new Map(questions.map(q=>[normalizeComparable(q.title),q]));
  return mapping.every(entry=>{
    const q=actual.get(normalizeComparable(entry.title));
    if(!q||q.type!==entry.type) return false;
    if(q.type!=='radio') return true;
    return JSON.stringify([...new Set(optionList(q))].sort())===JSON.stringify([...new Set(optionList(entry))].sort());
  });
}

const successRules=[
  ['en_answers_submitted',/\byour answers? have been submitted successfully\b/i],
  ['en_response_submitted',/\byour response was submitted\b/i],
  ['en_response_recorded',/\byour response has been (?:submitted|recorded)\b/i],
  ['zh_response_submitted',/(?:你的|您的)(?:响应|答复|回复)已(?:成功)?(?:提交|记录)/i],
  ['ms_response_submitted',/(?:respons|jawapan)\s+(?:anda|awak)\s+(?:telah|sudah)\s+(?:dihantar|dihantar(?:kan)?|direkodkan)/i],
  ['ms_thanks_submitted',/terima kasih[\s,，]*(?:respons|jawapan).*?(?:dihantar|direkodkan)/i],
];

export function isExplicitSuccess(text) {
  const value=String(text||'');
  return successRules.find(([,rule])=>rule.test(value))?.[0]||null;
}

function structureChanged(before={},after={},enabled=false) {
  if(!enabled) return false;
  return before.questionCount!==after.questionCount || before.submitVisible!==after.submitVisible;
}

export function submissionSignals(before={},after={},options={}) {
  const textSignal=isExplicitSuccess(after.text);
  if(textSignal) return {state:'success',signal:textSignal};
  if(structureChanged(before,after,options.structureSelectorsEnabled===true)) return {state:'submitted_pending_confirmation',signal:'structure_change'};
  return {state:'submitted_pending_confirmation',signal:'none'};
}

const questionKey=question=>normalizeComparable(question?.title);
const optionList=question=>[...(question?.options||[])].map(normalizeComparable);
function questionSignature(question) {return `${question?.type||''}|${[...new Set(optionList(question))].sort().join('\u0001')}`;}

export function questionDiff(expected=[],actual=[]) {
  const left=new Map(expected.map(q=>[questionKey(q),q])),right=new Map(actual.map(q=>[questionKey(q),q]));
  const added=[],deleted=[],renamed=[],options=[];
  for(const key of left.keys()) if(!right.has(key)) deleted.push(key);
  for(const key of right.keys()) if(!left.has(key)) added.push(key);
  for(const key of left.keys()) {
    const q=right.get(key);if(!q) continue;
    if(q.type!==left.get(key).type) renamed.push({from:key,to:key});
    const before=[...new Set(optionList(left.get(key)))].sort(),after=[...new Set(optionList(q))].sort();
    if(JSON.stringify(before)!==JSON.stringify(after)) options.push({title:key,added:after.filter(v=>!before.includes(v)),removed:before.filter(v=>!after.includes(v))});
  }
  const unmatchedLeft=deleted.map(key=>left.get(key)),unmatchedRight=added.map(key=>right.get(key));
  for(const oldQuestion of unmatchedLeft) {
    const index=unmatchedRight.findIndex(q=>questionSignature(q)===questionSignature(oldQuestion));
    if(index<0) continue;
    const [newQuestion]=unmatchedRight.splice(index,1),oldKey=questionKey(oldQuestion),newKey=questionKey(newQuestion);
    deleted.splice(deleted.indexOf(oldKey),1);added.splice(added.indexOf(newKey),1);renamed.push({from:oldKey,to:newKey});
  }
  return {added:added.sort(),deleted:deleted.sort(),renamed:renamed.sort((a,b)=>a.from.localeCompare(b.from)),options:options.sort((a,b)=>a.title.localeCompare(b.title))};
}

function formatDate(placeholder,date) {
  const [y,m,d]=date.split('-');
  const format=String(placeholder||'').match(/(?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)[/.-](?:yyyy|MM|M|dd|d)/)?.[0];
  if(!format) throw Error('无法识别表单日期格式。');
  return format.replace(/yyyy|MM|dd|M|d/g,t=>({yyyy:y,MM:m,M:String(+m),dd:d,d:String(+d)})[t]);
}

function deliveryFromCourse(course) {
  if(/(?:^|\W)(?:tut|tutorial)\b/i.test(course||'')) return 'tutorial';
  if(/(?:^|\W)(?:lab|laboratory)\b/i.test(course||'')) return 'lab';
  if(/(?:^|\W)(?:lec|lecture)\b/i.test(course||'')) return 'lecture';
  throw Error('无法判断此课程类型，请选择 Lecture、Tutorial 或 Laboratory。');
}

function deliveryOption(options,target) {
  const words=value=>normalize(value).match(/[a-z]+/g)||[];
  const kinds=value=>[...new Set(words(value).map(word=>word==='laboratory'?'lab':word).filter(word=>['lecture','tutorial','lab'].includes(word)))];
  const matches=options.filter(value=>{
    const labels=words(value),negative=labels.some((word,index)=>['no','not','non','without','never'].includes(word)&&labels.slice(index+1,index+4).some(next=>['lecture','tutorial','lab','laboratory'].includes(next)));
    return !negative&&kinds(value).length===1&&kinds(value)[0]===target;
  });
  return matches.length===1?matches[0]:undefined;
}

function identityOption(options,target) {
  const matches=options.filter(value=>{
    const text=normalize(value),negative=/\b(?:not|no|non|without|never)\b/.test(text);
    return !negative&&(target==='international'?/\binternational\b/.test(text):/\blocal\b/.test(text)&&!/\binternational\b/.test(text));
  });
  return matches.length===1?matches[0]:undefined;
}

export function buildFillPlan(questions,mapping,profile,date,course) {
  const unused=new Set(questions),resolved=mapping.map(entry=>{
    let question=questions.find(item=>unused.has(item)&&normalizeComparable(item.title)===normalizeComparable(entry.title));
    if(!question) question=questions.find(item=>unused.has(item)&&matchesMappedMeaning(entry,item));
    if(question) unused.delete(question);
    return {entry,question};
  });
  if(resolved.some(item=>!item.question)) {
    const error=Error('表单题目发生变化，已停止。');error.code='form_schema_changed';error.diff=questionDiff(mapping,questions);throw error;
  }
  return resolved.map(({entry,question:q},i)=>{
    let value;
    // An optional calendar is left untouched, including its format and value.
    if(q.type==='date'&&q.required===false) return {type:'date',field:entry.field,skip:true};
    const expectedType=['student','name'].includes(entry.field)?'text':entry.field==='date'?'date':/^(?:delivery|local)(?::|$)/.test(entry.field)?'radio':null;
    if(expectedType && q.type!==expectedType) throw Error(`第 ${i+1} 题映射与题型不一致，未提交。`);
    if(entry.field==='student') value=profile.student;
    else if(entry.field==='name') value=profile.name;
    else if(entry.field==='date') value=q.nativeDate?date:formatDate(q.placeholder,date);
    else if(entry.field==='delivery' || ['delivery:lecture','delivery:tutorial','delivery:lab','delivery:laboratory'].includes(entry.field)) {
      const target=entry.field==='delivery'?deliveryFromCourse(course):entry.field.split(':')[1];
      value=deliveryOption(q.options||[],target==='laboratory'?'lab':target);
    }
    else if(entry.field==='local' || ['local:local','local:international'].includes(entry.field)) {
      const target=entry.field==='local'?profile.studentType:entry.field.split(':')[1];
      value=identityOption(q.options||[],target);
    }
    else throw Error(`未配置第 ${i+1} 题。`);
    if(!value) throw Error(`第 ${i+1} 题没有匹配的答案。`);
    return {type:q.type,value,field:entry.field,questionTitle:q.title,...(q.type==='date'?{expectedDate:date,dateFormat:q.placeholder||''}:{})};
  });
}

function matchesMappedMeaning(entry,question) {
  const title=normalizeComparable(question.title),options=(question.options||[]).map(normalizeComparable),field=entry.field||'';
  if((field==='student'||field==='name')&&question.type!=='text') return false;
  if((field==='delivery'||field.startsWith('delivery:'))&&question.type!=='radio') return false;
  if((field==='local'||field.startsWith('local:'))&&question.type!=='radio') return false;
  if(field==='student') return /\b(?:student|university|learner)\b.*\b(?:id|number|no)\b|\b(?:id|identification)\s*(?:number|no\.?|#)\b|学号/.test(title);
  if(field==='name') return /\bname\b|姓名/.test(title);
  if(field==='date') return question.type==='date';
  if(field==='skip') return question.type==='date'&&question.required===false;
  if(field==='delivery'||field.startsWith('delivery:')) {
    const kinds=['lecture','tutorial','lab'].filter(kind=>options.some(option=>kind==='lab'?/\b(?:lab|laboratory)\b/.test(option):new RegExp(`\\b${kind}\\b`).test(option)));
    return kinds.length>=2||/\b(?:delivery|session type|class type|lesson type)\b/.test(title);
  }
  if(field==='local'||field.startsWith('local:')) return options.some(option=>/\blocal\b/.test(option))&&options.some(option=>/\binternational\b/.test(option));
  return false;
}

export const isSuccess=text=>Boolean(isExplicitSuccess(text));
export function assertDateAgreement(occDate,malaysiaDate,computerDate) {
  if(occDate!==malaysiaDate) throw Error('任务日期与马来西亚当天日期不一致，已停止。');
  if(computerDate!==malaysiaDate) throw Error('电脑本地日期与马来西亚日期不一致，已停止。');
}
