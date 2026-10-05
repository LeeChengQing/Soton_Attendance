const HOSTS=new Set(['forms.office.com','forms.cloud.microsoft']);
export const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();
export const normalizeComparable=value=>normalize(String(value??'').normalize('NFKC'));

export function sameDateValue(actual,expected) {
  const pattern=/^\s*\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}\s*$/;
  if(!pattern.test(String(actual||''))||!pattern.test(String(expected||''))) return false;
  const left=String(actual).match(/\d+/g),right=String(expected).match(/\d+/g);
  return left.length===3&&right.length===3&&left.every((part,i)=>Number(part)===Number(right[i]));
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
  return options.find(value=>target==='lab'?['lab','laboratory'].includes(normalize(value)):normalize(value)===target);
}

function identityOption(options,target) {
  return options.find(value=>target==='international'?/international/i.test(value):/\blocal\b/i.test(value)&&!/international/i.test(value));
}

export function buildFillPlan(questions,mapping,profile,date,course) {
  if(!verifyQuestions(questions,mapping)) {
    const error=Error('表单题目发生变化，已停止。');error.code='form_schema_changed';error.diff=questionDiff(mapping,questions);throw error;
  }
  return mapping.map((entry,i)=>{
    const q=questions.find(item=>normalizeComparable(item.title)===normalizeComparable(entry.title));let value;
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
    return {type:q.type,value,field:entry.field,questionTitle:q.title};
  });
}

export const isSuccess=text=>Boolean(isExplicitSuccess(text));
export function assertDateAgreement(occDate,malaysiaDate,computerDate) {
  if(occDate!==malaysiaDate) throw Error('任务日期与马来西亚当天日期不一致，已停止。');
  if(computerDate!==malaysiaDate) throw Error('电脑本地日期与马来西亚日期不一致，已停止。');
}
