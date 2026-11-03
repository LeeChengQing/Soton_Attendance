import {resolveGate} from './license-gate.js';
async function popupGate(){
  let state;
  try {state=await chrome.runtime.sendMessage({type:'GET_LICENSE_GATE'});}catch {}
  if(!state?.state){const cached=await chrome.storage.local.get('attendancePluginLicense');state=resolveGate(cached.attendancePluginLicense,{error:'unavailable'},Date.now(),chrome.runtime.getManifest?.().version||'1.1.0');}
  const {attendanceLanguage}=await chrome.storage.local.get('attendanceLanguage');
  english=attendanceLanguage==='en';
  document.getElementById('popup-activation-title').textContent=english?'Activation required':'需要激活';
  document.getElementById('popup-open-activation').textContent=english?'Open activation page':'打开激活页';
  document.getElementById('popup-activation').hidden=state.allowed;
  document.querySelector('.popup-card').hidden=!state.allowed;
  document.body.classList.remove('popup-pending');
  return state.allowed;
}
let refreshTimer,english=false;
const pending=new Set();
const words=(zh,en)=>english?en:zh;
const courseStates={ready:['可打卡','Ready'],paused:['已暂停','Paused'],inactive_week:['课表已过期','Expired timetable'],attempted:['已尝试提交，禁止重复打卡','Submission already attempted'],launched:['正在打卡','In progress'],pending:['正在提交','Submitting'],success:['打卡成功','Checked in'],success_manual:['已手动确认','Confirmed'],unknown:['结果不明，请查看记录','Unknown result; check history'],submitted_pending_confirmation:['已提交，等待确认','Awaiting confirmation']};
async function renderCurrentCourses() {
  clearTimeout(refreshTimer);
  const list=document.getElementById('current-courses');
  let refreshAfterMs=15000;
  try {
    if(!await popupGate())return;
    const result=await chrome.runtime.sendMessage({type:'GET_POPUP_COURSES'});
    if(result?.error||!Array.isArray(result?.courses)) throw Error(result?.error||words('无法读取当前课程','Could not load current classes'));
    english=result.language==='en';refreshAfterMs=result.refreshAfterMs;
    const rows=result.courses.map(course=>{
      const row=document.createElement('div'),copy=document.createElement('div'),name=document.createElement('strong'),meta=document.createElement('p'),button=document.createElement('button');
      row.className='current-course';copy.className='current-course-copy';meta.className='current-course-meta';button.className='check-in-button';button.type='button';button.dataset.sessionId=course.id;
      name.textContent=course.course;
      meta.textContent=`${course.time}–${course.endTime} · ${courseStates[course.state]?.[english?1:0]||words('暂不可打卡','Unavailable')}`;
      button.disabled=pending.has(course.id)||course.state!=='ready';
      button.textContent=pending.has(course.id)?words('正在启动…','Starting…'):['success','success_manual'].includes(course.state)?words('已打卡','Checked in'):['launched','pending'].includes(course.state)?words('打卡中…','Checking in…'):words('手动打卡','Check in');
      copy.append(name,meta);row.append(copy,button);return row;
    });
    if(!rows.length) {const empty=document.createElement('p');empty.className='current-course-meta';empty.textContent=words('当前没有正在进行的课程','No class in progress');rows.push(empty);}
    list.replaceChildren(...rows);
  } catch(error) {
    list.replaceChildren();document.getElementById('current-course-message').textContent=words('无法读取当前课程，请重试','Could not load current classes. Please try again.');
  } finally {refreshTimer=setTimeout(()=>void renderCurrentCourses(),refreshAfterMs);}
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('popup-open-activation').addEventListener('click',()=>chrome.runtime.openOptionsPage());
  void renderCurrentCourses();
  document.getElementById('current-courses').addEventListener('click',async event=>{
    const button=event.target.closest('button[data-session-id]');
    if(!button||button.disabled||pending.has(button.dataset.sessionId)) return;
    const id=button.dataset.sessionId,message=document.getElementById('current-course-message');
    pending.add(id);button.disabled=true;button.textContent=words('正在启动…','Starting…');message.textContent='';
    try {
      const result=await chrome.runtime.sendMessage({type:'MANUAL_CHECK_IN',sessionId:id});
      if(result?.error||result?.ok!==true) throw Error(result?.error||words('打卡未启动，请重试','Check-in did not start; please retry'));
    } catch(error) {
      const errors={manual_check_in_not_eligible:words('课程状态已变化，请查看当前状态','Class status changed; check its current state'),plugin_license_required:words('请先在设置中激活插件','Activate the extension in settings first'),plugin_license_unavailable:words('授权服务暂不可用，请稍后重试','License service unavailable; please retry later'),manual_check_in_not_started:words('打卡未启动，请查看记录','Check-in did not start; check history')};
      message.textContent=errors[error.message]||error.message;
    } finally {pending.delete(id);await renderCurrentCourses();}
  });
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['attendanceSessions','attendanceRecords','attendanceLanguage','attendancePluginLicense'].some(key=>key in changes)) void renderCurrentCourses();});
}, {once:true});
window.addEventListener('pagehide',()=>clearTimeout(refreshTimer));
