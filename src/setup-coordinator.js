import {buildVariants,coverageRevision,confirmItem,updateItem,itemTerminal} from './setup.js';
import {bindingForCourse,moduleKey} from './bindings.js';
import {validateFormsUrl} from './forms.js';
import {isSettingsSender} from './settings-sender.js';

// Called only through the background's local serialized queue.
export function setupCoordinator(enqueueCloud) {
  const read=()=>chrome.storage.local.get(['attendanceSetupSession','attendanceSetupHistory','attendanceSessions','attendanceDraft','attendanceBindings','attendanceProfile']);
  async function save(session) {
    const {attendanceSetupHistory:history=[]}=await read();
    const values={attendanceSetupSession:session,attendanceSetupHistory:[...history.filter(s=>s.id!==session.id),session]};
    if(session.state==='completed'&&!session.summaryEnqueued) {
      session={...session,summaryEnqueued:true};values.attendanceSetupSession=session;values.attendanceSetupHistory=values.attendanceSetupHistory.map(s=>s.id===session.id?session:s);
      await enqueueCloud('setup-summary',{sessionId:session.id,count:session.items.length,passed:session.items.filter(i=>i.state==='passed').length},values);
    } else await chrome.storage.local.set(values);
    return session;
  }
  async function advance(session) {
    if(session.state!=='running') return session;
    for(let n=0;n<session.items.length;n++) {
      if(session.items[n].state!=='queued') continue;
      let item={...session.items[n],state:'opening',deadline:Date.now()+600000};
      session={...session,items:session.items.map((i,index)=>index===n?item:i)};
      // Persist before opening; restart never turns an orphan into a pass.
      await save(session);
      try {
        const data=await read(),binding=bindingForCourse(data.attendanceBindings,item.course);
        if(coverageRevision(item.course,binding,data.attendanceProfile)!==item.revision) throw Error('配置已变化，请重新检查。');
        const tab=await chrome.tabs.create({url:'about:blank',active:n===0});item={...item,tabId:tab.id};
        session={...session,items:session.items.map((i,index)=>index===n?item:i)};await save(session);
        const url=validateFormsUrl(binding.url);url.hash=new URLSearchParams({attendanceSetup:session.id,attendanceItem:item.id}).toString();
        await chrome.tabs.update(tab.id,{url:url.href});
      } catch(error) {
        session={...session,items:session.items.map((i,index)=>index===n?{...i,state:'failed',detail:error.message}:i)};
        await save(session);
      }
    }
    const pending=session.items.filter(i=>!itemTerminal(i.state));
    if(!pending.length) {
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      return save({...session,state:'completed',completedAt:new Date().toISOString()});
    }
    await chrome.alarms.create(`attendance-setup:${session.id}`,{when:Math.min(...pending.map(i=>i.deadline))});
    return session;
  }
  async function handle(message,sender) {
    const data=await read();let session=data.attendanceSetupSession;
    if(message.type==='START_SETUP') {
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页开始检查。');
      if(session?.state==='running') throw Error('已有课型检查进行中，请先完成或取消当前检查，再开始新的检查。');
      const intended=[...(data.attendanceSessions||[]),...(data.attendanceDraft?.rows||[])].filter(row=>!message.moduleKey||moduleKey(row.course)===message.moduleKey);
      session={id:crypto.randomUUID(),state:'running',current:0,startedAt:new Date().toISOString(),items:buildVariants(intended,data.attendanceBindings,data.attendanceProfile)};
      return {session:await advance(await save(session))};
    }
    if(!session||session.state!=='running') throw Error('没有正在进行的设置检查。');
    if(message.type==='CANCEL_SETUP') {
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页取消检查。');
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      return {session:await save({...session,state:'cancelled',cancelledAt:new Date().toISOString(),items:session.items.map(i=>itemTerminal(i.state)?i:{...i,state:'cancelled',detail:'学生取消检查，未提交。'})})};
    }
    if(message.type==='CONFIRM_ALL_SETUP_ITEMS') {
      if(!isSettingsSender(sender)) throw Error('请从扩展设置页确认全部课型。');
      const incomplete=session.items.filter(i=>!['awaiting_confirmation','passed'].includes(i.state));
      if(incomplete.length) throw Error(`还有 ${incomplete.length} 个课型尚未填写完成，请等待检查页准备好。`);
      if(!session.items.some(i=>i.state==='awaiting_confirmation')) throw Error('没有等待确认的课型。');
      for(const item of session.items) {
        const binding=bindingForCourse(data.attendanceBindings,item.course);
        if(coverageRevision(item.course,binding,data.attendanceProfile)!==item.revision) throw Error(`配置已变化：${item.course}，请重新测试。`);
      }
      const confirmedAt=new Date().toISOString();
      await chrome.alarms.clear(`attendance-setup:${session.id}`);
      session={...session,state:'completed',completedAt:confirmedAt,items:session.items.map(item=>item.state==='passed'?item:{...item,state:'passed',confirmedAt})};
      return {session:await save(session)};
    }
    const item=session.items.find(i=>i.id===message.itemId);
    if(message.sessionId!==session.id||!item||!Number.isInteger(sender.tab?.id)||sender.tab.id!==item.tabId) throw Error('设置检查与当前页面不匹配。');
    const binding=bindingForCourse(data.attendanceBindings,item.course);
    if(message.type==='REPORT_SETUP_ITEM'&&message.state==='failed') {
      session=updateItem(session,item.tabId,'failed',message.detail);
    } else {
      const revision=coverageRevision(item.course,binding,data.attendanceProfile);
      if(revision!==item.revision) {
        await advance(await save(updateItem(session,item.tabId,'failed','配置已变化，请重新检查。')));
        throw Error('配置已变化，请重新检查。');
      }
      if(message.type==='GET_SETUP_ITEM') {
        if(item.state!=='opening') throw Error('该页面已开始或完成检查。');
        await save(updateItem(session,item.tabId,'filling'));
        return {course:item.course,binding,profile:data.attendanceProfile,revision:item.revision};
      }
      if(message.type==='CONFIRM_SETUP_ITEM') session=confirmItem(session,item.tabId,revision);
      else if(message.type==='REPORT_SETUP_ITEM') session=updateItem(session,item.tabId,message.state,message.detail);
      else throw Error('未知检查操作。');
    }
    return {session:await advance(await save(session))};
  }
  async function resume() {
    let {attendanceSetupSession:session}=await read();
    if(session?.state!=='running') return;
    for(const item of session.items) {
      if(item.state==='queued'||itemTerminal(item.state)) continue;
      let state;
      if(item.deadline<=Date.now()) state='timed_out';
      else {try {await chrome.tabs.get(item.tabId);} catch {state='cancelled';}}
      if(state) session=updateItem(session,item.tabId,state,state==='timed_out'?'检查超时，未通过；请检查学校登录。':'检查页面已关闭，未通过。');
    }
    return advance(await save(session));
  }
  async function closed(tabId) {
    const {attendanceSetupSession:session}=await read();
    if(session?.state!=='running'||!session.items.some(i=>i.tabId===tabId&&!itemTerminal(i.state))) return;
    return advance(await save(updateItem(session,tabId,'cancelled','检查页面已关闭，未通过。')));
  }
  return {handle,resume,closed};
}
