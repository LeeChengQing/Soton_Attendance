import {currentLanguage} from './options-locale.js';

export function initPhoneConnectionTest() {
  const button=document.getElementById('test-phone-connection'),status=document.getElementById('phone-test-status'),card=document.getElementById('phone-status-card');
  let deadline=0,busy=false,checking=false,identity='',message='';
  const english=()=>currentLanguage()==='en';
  const messages={
    accepted:['已发送“已连接手机”，请在手机端确认收到。','“已连接手机” was sent. Check your phone to confirm receipt.'],
    phone_test_delivery_unknown:['发送结果不明，请先查看手机；冷却结束前不会再次发送。','Delivery is uncertain. Check your phone before trying again after the cooldown.'],
    phone_test_delivery_failed:['通知服务未接受消息，请在冷却结束后重试。','The notification service rejected the message. Retry after the cooldown.'],
    phone_subscription_required:['请先开通有效的手机提醒订阅。','An active phone notification subscription is required.'],
    phone_not_configured:['请先使用 ntfy 连接手机。','Connect your phone using ntfy first.'],
    unauthorized:['请先点击重试连接，恢复设备连接。','Use Retry connection to restore your device connection.'],
    unavailable:['暂时无法验证连接，请稍后重试。','Connection verification is unavailable. Please try again.']
  };
  function render(){
    const seconds=Math.max(0,Math.ceil((deadline-Date.now())/1000));
    button.disabled=busy||checking||seconds>0;
    button.textContent=busy?(english()?'Sending…':'正在发送…'):checking?(english()?'Checking…':'正在查询…'):seconds>0?(english()?'Retry in ':'等待 ')+String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0'):(english()?'Verify phone connection':'验证手机连接');
    const copy=messages[message];if(copy)status.textContent=copy[english()?1:0];
  }
  async function request(action){
    const cloud=await chrome.storage.local.get(['attendanceCloudToken','attendanceCloudDeviceId']);
    if(!cloud.attendanceCloudToken)throw Error('unauthorized');
    identity=cloud.attendanceCloudDeviceId;
    const response=await fetch('https://qckpwckfukyurkobrsig.supabase.co/functions/v1/phone-connection-test',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+cloud.attendanceCloudToken},body:JSON.stringify({action}),signal:AbortSignal.timeout(12000)});
    const data=await response.json();
    if(data.nextAllowedAt&&data.serverNow){
      const remaining=Math.max(0,Date.parse(data.nextAllowedAt)-Date.parse(data.serverNow));
      if(Number.isFinite(remaining)){deadline=Date.now()+remaining;await chrome.storage.local.set({attendancePhoneTestCooldown:{deviceId:identity,until:deadline}});}
    }
    if(!response.ok)throw Error(data.error||'unavailable');
    return data;
  }
  async function restore(){
    checking=true;render();
    try{
      const saved=await chrome.storage.local.get(['attendancePhoneTestCooldown','attendanceCloudDeviceId']);
      if(saved.attendancePhoneTestCooldown?.deviceId===saved.attendanceCloudDeviceId)deadline=Math.max(deadline,saved.attendancePhoneTestCooldown.until||0);
      await request('status');
    }catch(error){message=messages[error.message]?error.message:'unavailable';}
    finally{checking=false;render();}
  }
  button.addEventListener('click',async()=>{
    if(button.disabled)return;
    busy=true;message='';status.textContent='';render();
    // A provisional cooldown also covers a lost response after the server reserved this send.
    deadline=Date.now()+300000;
    try{
      const saved=await chrome.storage.local.get('attendanceCloudDeviceId');
      await chrome.storage.local.set({attendancePhoneTestCooldown:{deviceId:saved.attendanceCloudDeviceId,until:deadline}});
      await request('send');message='accepted';
    }catch(error){
      message=messages[error.message]?error.message:error.message==='phone_test_cooldown'?'':'unavailable';
      if(error.message==='phone_test_cooldown')status.textContent=english()?'Please wait for the cooldown to end.':'请等待冷却结束后再发送。';
    }finally{busy=false;render();}
  });
  card.addEventListener('toggle',()=>{if(card.open)void restore();});
  setInterval(()=>{if(!card.hidden)render();},1000);
  render();
  if(card.open&&!card.hidden)void restore();
}

