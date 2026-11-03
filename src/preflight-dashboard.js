import {occurrencesBetween,todayMalaysia,triggerTimestamp} from './schedule.js';
import {bindingForCourse} from './bindings.js';
export function renderPreflight(data,root) {
    const title=root.getElementById('preflight-title'),list=root.getElementById('preflight-checks');
    if(!title || !list) return;
    const today=todayMalaysia(),end=new Date(`${today}T00:00:00Z`);end.setUTCDate(end.getUTCDate()+32);
    const occ=occurrencesBetween(data.attendanceSessions||[],today,end.toISOString().slice(0,10)).filter(o=>triggerTimestamp(o)>Date.now() && triggerTimestamp(o)>=Date.parse(o.createdAt||'1970-01-01')).sort((a,b)=>triggerTimestamp(a)-triggerTimestamp(b))[0];
    const next=occ?{...(data.attendanceRecords?.[occ.key]||{}),occ}:null;
    const current=JSON.stringify({binding:bindingForCourse(data.attendanceBindings,next?.occ.course),profile:data.attendanceProfile});
    const stale=next?.preflightConfiguration!==current;
    const failures=next?.preflight?.checks.filter(c=>!c.ok && !c.hint.startsWith('前置检查')).map(c=>c.hint||c.name)||[];
    const reason=!next?'暂无待打卡课次':!next.preflight?'尚未预检':stale?'配置已变化，等待重新预检':failures.join('；')||'检查未完成';
    title.textContent=next?.preflight?.ok && !stale?'下一次打卡：就绪 ✅':`下一次打卡：未就绪 ❌（${reason}）`;
    root.getElementById('preflight-occurrence').textContent=next?`${next.occ.course} · ${next.occ.date} ${next.occ.time} · 预检：${next.preflight?.at?new Date(next.preflight.at).toLocaleString():'等待调度'}`:'';
    list.replaceChildren();
    const checks=next?.preflight?.checks||['已登录学校账号','表单链接与绑定一致','标题与题目没变','课型可解析','日期格式可填','填写后核对通过','Chrome 通知权限可用'].map(name=>({name,ok:false,hint:'等待预检'}));
    for(const c of checks) {const li=root.createElement('li');li.textContent=`${c.ok && !stale?'✅':'❌'} ${c.name}${c.hint?`：${c.hint}`:''}`;list.append(li);}
  }

const keys=['attendanceRecords','attendanceSessions','attendanceBindings','attendanceProfile'];
async function refresh() {renderPreflight(await chrome.storage.local.get(keys),document);}
if(typeof document!=='undefined' && document.getElementById('preflight-title')) {
  void refresh().catch(()=>{});
  chrome.storage.onChanged?.addListener((changes,area)=>{if(area==='local' && keys.some(key=>key in changes)) void refresh().catch(()=>{});});
  setInterval(()=>void refresh().catch(()=>{}),60000);
}
