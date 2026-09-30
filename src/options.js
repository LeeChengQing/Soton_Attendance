import {importTimetable,decodeQrFile} from './importer.js';
import {validateFormsUrl} from './forms.js';
import {fieldMappingForQuestion} from './mapping.js';
import {moduleKey,bindingForCourse,legacyLinkSuggestion,validateBindingForCourse} from './bindings.js';
import {mergeSessions,normalizeDate,todayMalaysia,toWeeklySession} from './schedule.js';
import {ensureCloudDevice,syncCloud} from './cloud.js';

const $=id=>document.getElementById(id);
const preview=[],cards=new Map();
let inspecting=null,toastTimer,importGeneration=0;
const profileForm=$('profile-form');

function toast(message,error=false) {
  const box=$('toast');box.textContent=message;box.className=`toast visible${error?' error':''}`;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.className='toast',6500);
}
function node(tag,props={}) {const el=document.createElement(tag);for(const [key,value] of Object.entries(props)) {if(key==='text') el.textContent=value;else if(key==='className') el.className=value;else el[key]=value;}return el;}
function profile() {return {student:profileForm.elements.student.value.trim(),name:profileForm.elements.name.value.trim(),studentType:profileForm.elements.studentType.value};}
function validateProfile(p) {if(!p.student||p.student.length>50||!p.name||p.name.length>100) throw Error('请先填写有效学号和姓名。');return p;}
async function getData() {return chrome.storage.local.get(['attendanceProfile','attendanceSessions','attendanceBindings','attendanceRecords']);}
async function rebuild() {const response=await chrome.runtime.sendMessage({type:'REBUILD_SCHEDULE'});if(response?.error) throw Error(response.error);}
async function syncCloudSafe(payload) {try {await syncCloud(payload);} catch(error) {console.warn('云端同步失败',error);}}

async function showCloudStatus() {
  const status=$('cloud-status');
  if(!status) return;
  try {
    const data=await ensureCloudDevice();
    await chrome.storage.local.remove(['attendanceCloudPairingCode','attendanceCloudPairingExpiresAt']);
    status.textContent='云端提醒已连接';
    status.className='status success';
    const ntfy=$('ntfy-status');
    if(ntfy&&data.attendanceNtfyTopic) ntfy.textContent=`手机提醒：在 ntfy 订阅 https://ntfy.sh/${data.attendanceNtfyTopic}`;
  } catch(error) {status.textContent='云端提醒尚未连接；本机自动打卡仍可使用。';status.className='status';console.warn(error);}
}

const weekdays=['周日','周一','周二','周三','周四','周五','周六'];
const lessonType=course=>/(?:^|\W)lab\b/i.test(course||'')?'Lab':/(?:^|\W)(?:lec|lecture)\b/i.test(course||'')?'Lecture':/(?:^|\W)tut\b/i.test(course||'')?'Tutorial':'课程';
const field=(label,input)=>{const wrapper=node('label',{className:'session-field'});wrapper.append(node('span',{text:label}),input);return wrapper;};

function renderPreview(expandId) {
  const root=$('preview-rows');
  const openIds=new Set([...root.querySelectorAll('.session-card[open]')].map(card=>card.dataset.id));
  if(expandId) openIds.add(expandId);
  root.replaceChildren();
  const groups=new Map();
  for(const row of preview) {
    const key=`weekly:${row.weekday??1}`;
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  }
  const overview=$('preview-summary');overview.replaceChildren();
  if(!preview.length) {
    overview.append(node('strong',{text:'等待你的课表'}),node('span',{text:'上传文件后，这里会按星期列出课程。'}));
    root.append(node('p',{className:'agenda-empty',text:'还没有待核对的课程。也可以先手动添加一节。'}));
    return;
  }
  overview.append(node('strong',{text:`${preview.length} 节待核对课程`}),node('span',{text:`分为 ${groups.size} 个上课日 · 展开课程可修改星期与时间`}));
  const ordered=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
  for(const [key,rows] of ordered) {
    const [,value]=key.split(':');
    const day=node('section',{className:'agenda-day'}),heading=node('div',{className:'agenda-day-head'});
    const title=`每${weekdays[Number(value)]||'周一'}`;
    heading.append(node('h3',{text:title}),node('span',{className:'day-count',text:`${rows.length} 节课`}));
    const lessons=node('div',{className:'agenda-lessons'});
    for(const row of rows.sort((a,b)=>String(a.time).localeCompare(String(b.time)))) {
      const card=node('details',{className:'session-card'});card.dataset.id=row.id;
      if(openIds.has(row.id)) card.open=true;
      const summary=node('summary',{className:'session-summary'}),time=node('span',{className:'session-time'}),main=node('span',{className:'session-main'});
      time.append(node('strong',{text:row.time||'--:--'}),node('small',{text:`${row.endTime||'--:--'} 结束`}));
      main.append(node('strong',{text:row.course||'未命名课程'}),node('small',{text:'每周重复'}));
      const type=lessonType(row.course),badge=node('span',{className:`lesson-badge ${type.toLowerCase()}`,text:type});
      summary.append(time,main,badge,node('span',{className:'session-chevron',text:'⌄'}));
      const editor=node('div',{className:'session-editor'});
      const course=node('input',{value:row.course||'',placeholder:'课程名'});
      course.addEventListener('change',()=>{row.course=course.value.trim();renderPreview(row.id);renderBindings();});
      editor.append(field('课程名称',course));
      const weekday=node('select');
      for(const [index,label] of weekdays.entries()) weekday.append(node('option',{value:String(index),text:label}));
      weekday.value=String(row.weekday??1);
      weekday.addEventListener('change',()=>{row.weekday=Number(weekday.value);renderPreview(row.id);});
      editor.append(field('每周星期',weekday));
      const start=node('input',{type:'time',value:row.time||'09:00'});
      start.addEventListener('change',()=>{row.time=start.value;renderPreview(row.id);});
      editor.append(field('开始时间',start));
      const end=node('input',{type:'time',value:row.endTime||'10:00'});
      end.addEventListener('change',()=>{row.endTime=end.value;renderPreview(row.id);});
      editor.append(field('结束时间',end));
      const exceptions=node('input',{value:(row.exceptions||[]).join(', '),placeholder:'YYYY-MM-DD, ...'});
      exceptions.addEventListener('change',()=>row.exceptions=exceptions.value.split(/[,，\s]+/).filter(Boolean));
      const holder=field('停课日期（可选，多个日期用逗号分隔）',exceptions);holder.classList.add('wide');editor.append(holder);
      const actions=node('div',{className:'session-actions'}),remove=node('button',{type:'button',text:'移除此课程',className:'quiet'});
      remove.setAttribute('aria-label',`删除 ${row.course||'未命名课程'}`);
      remove.addEventListener('click',()=>{preview.splice(preview.indexOf(row),1);renderPreview();renderBindings();});
      actions.append(remove);editor.append(actions);
      card.append(summary,editor);lessons.append(card);
    }
    day.append(heading,lessons);root.append(day);
  }
}

function courseNames(sessions=[]) {return [...new Set([...preview.map(r=>r.course?.trim()),...sessions.map(s=>s.course)].filter(Boolean))].sort();}
function moduleGroups(sessions=[]) {
  const groups=new Map();
  for(const course of courseNames(sessions)) {
    const key=moduleKey(course);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(course);
  }
  return [...groups.entries()].sort(([a],[b])=>a.localeCompare(b));
}
async function renderBindings() {
  const {attendanceSessions:sessions=[],attendanceBindings:bindings={},attendanceProfile:p={}}=await getData();
  const root=$('bindings');root.replaceChildren();cards.clear();
  const groups=moduleGroups(sessions);
  if(!groups.length) {root.append(node('p',{className:'muted',text:'先导入或添加课程。'}));return;}
  for(const [key,courses] of groups) {
    const saved=bindings[key],legacy=legacyLinkSuggestion(bindings,courses);
    const ready=courses.every(course=>{try {validateBindingForCourse(bindingForCourse(bindings,course),course,p,todayMalaysia());return true;} catch {return false;}});
    const card=node('article',{className:'binding'}),title=node('h3',{text:key});
    const variants=node('p',{className:'binding-variants',text:`共用此链接：${courses.join(' · ')}`});
    const row=node('div',{className:'toolbar'}),url=node('input',{type:'url',placeholder:'粘贴 Forms 链接，或上传二维码',value:saved?.url||legacy.url});
    const fileLabel=node('label',{className:'file-button',text:'上传二维码'}),file=node('input',{type:'file',accept:'.png,.jpg,.jpeg,image/png,image/jpeg'});fileLabel.append(file);
    const verify=node('button',{type:'button',text:'打开并核对表单'});
    const test=node('button',{type:'button',text:'测试所选课型 · 不提交',className:'secondary'});
    const status=node('p',{className:'status',text:ready?`已核对：${saved.title}`:legacy.conflict?'旧版课型绑定了不同链接。请使用这一门课程共用的链接重新核对。':'请核对并保存一次共用表单。'});
    const testCourse=node('select');
    if(courses.length>1) testCourse.append(node('option',{value:'',text:'先选择要测试的课程课型'}));
    for(const course of courses) testCourse.append(node('option',{value:course,text:course}));
    testCourse.setAttribute('aria-label',`${key} 仅填写测试的课型`);
    row.append(url,fileLabel,verify);card.append(title,variants,row,status);
    const testRow=node('div',{className:'binding-test-row'});
    if(courses.length>1) {const testLabel=node('label',{className:'binding-test-label',text:'仅填写测试的课程课型'});testLabel.append(testCourse);testRow.append(testLabel);}
    testRow.append(test);card.append(testRow);
    root.append(card);cards.set(key,{card,url,status,courses});
    verify.addEventListener('click',()=>startInspection(key,url.value));
    file.addEventListener('change',async()=>{try {const decoded=await decodeQrFile(file.files[0]);url.value=decoded;await startInspection(key,decoded);} catch(error){toast(error.message,true);}file.value='';});
    test.addEventListener('click',async()=>{try {const course=testCourse.value;if(!course) throw Error('请先选择要测试的课程课型。');const binding=bindingForCourse((await getData()).attendanceBindings,course);if(!binding?.verified) throw Error('请先核对共用表单。');validateBindingForCourse(binding,course,p,todayMalaysia());const target=validateFormsUrl(binding.url);target.hash=new URLSearchParams({attendanceCheck:course}).toString();await chrome.tabs.create({url:target.href});} catch(error){toast(error.message,true);}});
  }
}

async function startInspection(key,text) {
  try {
    const url=validateFormsUrl(text);
    if(inspecting?.timer) clearTimeout(inspecting.timer);
    const tab=await chrome.tabs.create({url:'about:blank',active:true});
    inspecting={key,tabId:tab.id};
    cards.get(key).status.textContent='正在打开表单，等待学校登录与题目加载…';
    inspecting.timer=setTimeout(()=>{if(inspecting?.tabId===tab.id){cards.get(key).status.textContent='未能读取表单。请检查学校登录状态后重试。';inspecting=null;}},90000);
    await chrome.tabs.update(tab.id,{url:url.href});
  } catch(error) {toast(error.message,true);}
}

function renderInspection(key,schema) {
  const info=cards.get(key);if(!info) return;
  const courses=info.courses,course=courses[0];
  info.card.querySelector('.mapping')?.remove();
  const box=node('div',{className:'mapping'});
  box.append(node('p',{text:`实际表单：${schema.title} · ${schema.url}`}));
  const code=key.match(/[A-Za-z]{2,}\d{3,}/)?.[0];
  if(code&&!schema.title.toLowerCase().includes(code.toLowerCase())) box.append(node('p',{className:'status',text:`注意：表单标题中未找到课程代码 ${code}，请仔细核对。`}));
  const selects=[];
  for(const [i,q] of schema.questions.entries()) {
    const title=/^\s*\d+[.)．、]/.test(q.title)?q.title:`${i+1}. ${q.title}`;
    const line=node('div',{className:'mapping-row'}),label=node('span',{text:`${title}（${q.type}${q.options?.length?`：${q.options.join(' / ')}`:''}）`}),select=node('select');
    const {choices,selected}=fieldMappingForQuestion(q,course);
    for(const [value,text] of choices) select.append(node('option',{value,text}));
    select.value=selected;selects.push(select);line.append(label,select);box.append(line);
  }
  const confirmLabel=node('label',{className:'checkbox'}),confirm=node('input',{type:'checkbox'});
  confirmLabel.append(confirm,node('span',{text:`我已核对：这是 ${key} 的共用打卡表单，适用于 ${courses.join('、')}。`}));box.append(confirmLabel);
  const save=node('button',{type:'button',text:'保存表单绑定'});box.append(save);info.card.append(box);
  save.addEventListener('click',async()=>{
    try {
      if(!confirm.checked) throw Error('请先核对课程与表单。');
      const p=validateProfile(profile());
      const mapping=schema.questions.map((q,i)=>({title:q.title,type:q.type,options:q.options||[],field:selects[i].value}));
      if(mapping.some(x=>!x.field)) throw Error('请为每一道题选择对应资料。');
      const binding={url:validateFormsUrl(schema.url).href,title:schema.title,questions:schema.questions,mapping,verified:true,scope:'module'};
      for(const variant of courses) validateBindingForCourse(binding,variant,p,todayMalaysia());
      const {attendanceBindings:bindings={}}=await getData();
      bindings[key]=binding;
      await chrome.storage.local.set({attendanceBindings:bindings,attendanceProfile:p});
      await syncCloudSafe({sessions:(await getData()).attendanceSessions||[],bindings});
      toast(`${key} 共用表单已绑定。`);await renderBindings();
    } catch(error) {toast(error.message,true);}
  });
}

chrome.runtime.onMessage.addListener((message,sender)=>{
  if(!inspecting || sender.tab?.id!==inspecting.tabId) return;
  const key=inspecting.key;
  if(message.type==='FORM_SETUP_ERROR') {cards.get(key).status.textContent=message.error;return;}
  if(message.type!=='FORM_READY') return;
  try {
    const url=validateFormsUrl(message.url);
    if(!/^\/Pages\/ResponsePage\.aspx$/i.test(url.pathname)||!message.title||!message.questions?.length) throw Error('没有找到可配置的 Microsoft Forms 答题页。');
    clearTimeout(inspecting.timer);inspecting=null;
    cards.get(key).status.textContent='请核对表单标题与每道题，再保存绑定。';
    renderInspection(key,{url:url.href,title:message.title,questions:message.questions});
  } catch(error) {cards.get(key).status.textContent=error.message;}
});

async function renderSaved() {
  const {attendanceSessions:sessions=[],attendanceRecords:records={}}=await getData();
  const list=$('sessions');list.replaceChildren();
  if(!sessions.length) list.append(node('p',{className:'muted',text:'还没有任务。'}));
  for(const s of sessions) {
    const item=node('div',{className:'list-item'}),label=node('div'),deleteButton=node('button',{type:'button',text:'删除',className:'quiet'});
    label.append(node('strong',{text:s.course}),node('small',{text:`每周${['日','一','二','三','四','五','六'][s.weekday]} ${s.time}–${s.endTime} · 结束前 5 分钟自动执行`}));
    deleteButton.addEventListener('click',async()=>{const current=(await getData()).attendanceSessions||[];await chrome.storage.local.set({attendanceSessions:current.filter(x=>x.id!==s.id)});await rebuild();await renderSaved();await renderBindings();});
    item.append(label,deleteButton);list.append(item);
  }
  const recordList=$('records');recordList.replaceChildren();
  const recent=Object.values(records).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,40);
  if(!recent.length) recordList.append(node('p',{className:'muted',text:'还没有打卡记录。'}));
  for(const r of recent) {
    const item=node('div',{className:'list-item'}),label=node('div');
    label.append(node('strong',{text:`${r.occ?.course||'课程'} · ${r.occ?.date||''} ${r.occ?.time||''}`}),node('small',{text:r.detail||r.at||''}));
    item.append(label,node('span',{text:({success:'成功',failed:'失败',unknown:'结果不明',missed:'未自动提交',pending:'提交中',launched:'打开中'})[r.state]||r.state}));recordList.append(item);
  }
}

profileForm.addEventListener('submit',async event=>{event.preventDefault();try {await chrome.storage.local.set({attendanceProfile:validateProfile(profile())});toast('学生资料已保存。');} catch(error){toast(error.message,true);}});
$('timetable-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];if(!file) return;
  const generation=++importGeneration;
  try {
    $('import-status').textContent='正在本机识别…';
    const rows=await importTimetable(file,message=>{if(generation===importGeneration) $('import-status').textContent=message;});
    if(generation!==importGeneration) return;
    if(!rows.length) throw Error('没有可靠识别出课程。请手动添加，或上传更清晰的课表。');
    preview.push(...rows.map(r=>({...toWeeklySession(r),id:crypto.randomUUID(),exceptions:[]})));
    $('import-status').textContent=`识别出 ${rows.length} 行。${rows.some(r=>/\bGroup\s*\d+\b/i.test(r.course))?'请删除不属于自己的 Group 课程。':''}请逐行核对，再绑定二维码。`;
    renderPreview();await renderBindings();
  } catch(error) {if(generation===importGeneration) {$('import-status').textContent=error.message;toast(error.message,true);}}
  finally {event.target.value='';}
});
$('add-row').addEventListener('click',async()=>{const row={id:crypto.randomUUID(),course:'',kind:'weekly',weekday:1,time:'09:00',endTime:'10:00',exceptions:[]};preview.push(row);renderPreview(row.id);});
$('clear-preview').addEventListener('click',async()=>{
  if(!confirm('清空第 2 区所有待核对课程？已创建的每周任务不会删除。')) return;
  importGeneration++;
  preview.length=0;
  $('timetable-file').value='';
  $('import-status').textContent='还没有导入课表。';
  renderPreview();await renderBindings();
  toast('第 2 区的待核对课程已清空。');
});
$('clear-bindings').addEventListener('click',async()=>{
  if(!confirm('清空第 3 区所有课程二维码、链接和表单题目映射？现有任务会保留，但重新绑定前无法自动提交。')) return;
  try {
    if(inspecting?.timer) clearTimeout(inspecting.timer);
    inspecting=null;
    await chrome.storage.local.set({attendanceBindings:{}});
    await renderBindings();
    toast('第 3 区的课程表单绑定已清空。');
  } catch(error) {toast(error.message,true);}
});
$('clear-sessions').addEventListener('click',async()=>{
  if(!confirm('删除第 4 区全部每周自动打卡任务？之后不会再按这些任务安排打卡。打卡记录会保留。')) return;
  try {
    await chrome.storage.local.set({attendanceSessions:[]});
    await rebuild();
    await renderSaved();await renderBindings();
    toast('第 4 区的每周任务已清空。');
  } catch(error) {toast(error.message,true);}
});
$('create-tasks').addEventListener('click',async()=>{
  try {
    if(!preview.length) throw Error('请先导入或添加课程。');
    const {attendanceSessions:existing=[],attendanceBindings:bindings={}}=await getData();
    const p=validateProfile(profile());
    const createdAt=new Date().toISOString();
    const rows=preview.map(row=>{
      const r={...toWeeklySession(row),course:row.course?.trim(),createdAt};
      if(!r.course||!r.time||!r.endTime||r.endTime<=r.time) throw Error('请核对每行的课程名和起止时间。');
      const binding=bindingForCourse(bindings,r.course);
      validateBindingForCourse(binding,r.course,p,todayMalaysia());
      r.exceptions=(r.exceptions||[]).map(normalizeDate);
      if(r.exceptions.some(x=>!x)) throw Error(`${r.course} 的停课日期格式无效。`);
      return r;
    });
    const merged=mergeSessions(existing,rows);await chrome.storage.local.set({attendanceSessions:merged});await rebuild();
    await syncCloudSafe({sessions:merged,bindings});
    const added=merged.length-existing.length;preview.length=0;renderPreview();await renderSaved();await renderBindings();toast(`已创建 ${added} 个每周自动任务${added<rows.length?`，跳过 ${rows.length-added} 个重复项`:''}。`);
  } catch(error) {toast(error.message,true);}
});
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&'attendanceRecords' in changes) renderSaved().catch(console.error);});
(async()=>{
  const data=await getData(),p=data.attendanceProfile||{};
  profileForm.elements.student.value=p.student||'';profileForm.elements.name.value=p.name||'';profileForm.elements.studentType.value=p.studentType||'local';
  renderPreview();
  await renderBindings();await renderSaved();
  await showCloudStatus();
})().catch(error=>toast(error.message,true));
