const HOSTS=new Set(['forms.office.com','forms.cloud.microsoft']);
export const normalize=s=>String(s||'').replace(/\s+/g,' ').trim().toLowerCase();

export function sameDateValue(actual,expected) {
  const pattern=/^\s*\d{1,4}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{1,4}\s*$/;
  if(!pattern.test(String(actual||''))||!pattern.test(String(expected||''))) return false;
  const left=String(actual).match(/\d+/g),right=String(expected).match(/\d+/g);
  return left.length===3&&right.length===3&&left.every((part,i)=>Number(part)===Number(right[i]));
}

export function validateFormsUrl(value) {
  let url;
  try {url=new URL(String(value).trim());} catch {throw Error('二维码或链接不是有效网址。');}
  if(url.protocol!=='https:' || !HOSTS.has(url.hostname.toLowerCase()) || !(/^\/r\/[\w-]+\/?$/.test(url.pathname) || /^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname))) throw Error('只接受 Microsoft Forms 的填写链接。');
  if(/^\/Pages\//i.test(url.pathname) && !url.searchParams.get('id')) throw Error('表单链接缺少 ID。');
  url.hash='';
  return url;
}

export function verifyQuestions(questions,mapping) {
  return Array.isArray(questions) && questions.length===mapping?.length && questions.every((q,i)=>normalize(q.title)===normalize(mapping[i].title) && q.type===mapping[i].type && (q.type!=='radio'||JSON.stringify((q.options||[]).map(normalize))===JSON.stringify((mapping[i].options||[]).map(normalize))));
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
  if(!verifyQuestions(questions,mapping)) throw Error('表单题目发生变化，已停止。');
  return mapping.map((entry,i)=>{
    const q=questions[i];let value;
    const expectedType=['student','name'].includes(entry.field)?'text':entry.field==='date'?'date':/^(?:delivery|local)(?::|$)/.test(entry.field)?'radio':null;
    if(expectedType && q.type!==expectedType) throw Error(`第 ${i+1} 题映射与题型不一致，未提交。`);
    if(entry.field==='student') value=profile.student;
    else if(entry.field==='name') value=profile.name;
    else if(entry.field==='date') value=formatDate(q.placeholder,date);
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
    return {type:q.type,value,field:entry.field};
  });
}

export const isSuccess=text=>/(?:your response (?:was submitted|has been (?:submitted|recorded))|你的(?:响应|答复|回复)已(?:提交|记录)|您的(?:响应|答复|回复)已(?:提交|记录)|已成功提交)/i.test(String(text));
export function assertDateAgreement(occDate,malaysiaDate,computerDate) {
  if(occDate!==malaysiaDate) throw Error('任务日期与马来西亚当天日期不一致，已停止。');
  if(computerDate!==malaysiaDate) throw Error('电脑本地日期与马来西亚日期不一致，已停止。');
}
