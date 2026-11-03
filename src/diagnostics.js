import {redactDiagnostic} from './reliability.js';
import {resolveCourseKind} from './course-kind.js';

const reasons={
  date_picker_today_not_found:['日期控件未能打开。','日期控件未能打开，已改用直接输入或切到前台重试；仍失败请点复制诊断'],
  date_readback_mismatch:['日期回读值不一致或日期题校验失败。','请打开原表单检查日期题的值与校验提示，并复制诊断。'],
  test_authorization_expired:['测试授权已过期。','测试授权已过期，请重新点击立即测试打卡'],
  date_fill_hidden_tab:['后台标签页日期填写失败，未提交。','允许前台回退时将短暂切到打卡页重试；否则请手动核查日期。'],
  submission_error:['Forms 返回提交错误，未确认记录。','请检查学校表单与网络；系统不会自动重交，核查记录后由你决定是否手动提交。'],
  course_kind_unknown:['缺少课型（LEC/TUT/LAB）。','请在课表中补全课型，例如 {course}-LEC，然后重新检查。'],
  form_schema_changed:['表单题目、标题或选项发生变化。','请重新读取并保存此课程的表单题目，再核对映射。'],
  login_required:['需要登录学校账号或取得表单访问权限。','请打开原表单登录学校 Microsoft 账号，并确认访问权限。'],
  phase_timeout:['此阶段等待超时。','请检查网络和学校登录状态，再打开原表单检查。'],
  date_mismatch:['课程日期与当前日期或表单日期不一致。','请检查课表日期、电脑日期与时区，并核对表单日期。'],
  answer_mismatch:['填写后的答案未通过核对。','请打开原表单，检查答案、必填项和题目映射。'],
  submit_unconfirmed:['已尝试提交，但没有收到明确成功反馈。','请打开原表单检查结果；确认前不要重复提交，可在记录中手动标记已提交。'],
  course_ended:['课程已结束或结束时间无效，未提交。','请检查课表起止时间，并手动处理本次打卡。'],
  schedule_week_inactive:['课表周未分配、未开始或已过期，未提交。','请明确分配本周或下周课表；系统不会自动续期。'],
  configuration_changed:['打卡配置缺失或已变化。','请保存个人资料，并重新核对此课程的课表和共用表单。'],
  phase_failed:['此阶段执行失败。','请打开原表单检查，并复制诊断信息给开发者。']
};
export const ERROR_CODES=Object.freeze(Object.keys(reasons));
export function diagnosticPhase(phase) {
  const canonical=({checking:'validate',filling:'fill',submitting:'submit',confirming:'submit'})[phase]||phase;
  return ['validate','fill','submit','opening','reading'].includes(canonical)?canonical:'validate';
}
export function runError(error={},context={}) {
  const message=typeof error==='string'?error:error?.message||'';
  let code=error?.code;
  if(!code) code=/缺少课型|无法判断.*课程类型/.test(message)?'course_kind_unknown':/登录|权限/.test(message)?'login_required':/日期.*不一致|日期.*变化/.test(message)?'date_mismatch':/答案|填写/.test(message)?'answer_mismatch':/schema_changed|题目|题型|标题|选项|表单.*不一致/.test(message)?'form_schema_changed':/超时/.test(message)?'phase_timeout':/配置|绑定|任务已/.test(message)?'configuration_changed':'phase_failed';
  const guidance=reasons[code]||reasons.phase_failed;
  const course=String(context.course||error.course||'未知课程');
  const kind=resolveCourseKind({course,type:context.type});
  const variant=({lecture:'LEC',tutorial:'TUT',lab:'LAB'})[kind];
  const reason=message||guidance[0];
  return {code,course,phase:diagnosticPhase(context.phase||error.phase),message:variant&&!reason.includes('（课型：')?`${reason}（课型：${variant}）`:reason,hint:guidance[1].replaceAll('{course}',course)};
}
export function formatRunError(error) {
  const phase=({validate:'校验',fill:'填写',submit:'提交',opening:'打开表单',reading:'读取表单'})[error.phase]||error.phase;
  return `${error.course} · ${phase}：${error.message}\n下一步：${error.hint}`;
}
export function createDiagnostic(input={},profile={}) {
  const secrets=[profile.student,profile.name].filter(Boolean).map(String).sort((a,b)=>b.length-a.length);
  const safe=value=>{
    let text=String(value||'');
    for(const secret of secrets) text=text.split(secret).join('[redacted]');
    return redactDiagnostic(text);
  };
  const durations={validate:0,fill:0,submit:0};
  for(const [phase,ms] of Object.entries(input.phaseDurations||{})) if(['validate','fill','submit','opening','reading','checking','filling','submitting','confirming'].includes(phase)&&Number.isFinite(ms)&&ms>=0) {
    const key=diagnosticPhase(phase);durations[key]=(durations[key]||0)+ms;
  }
  // Whitelist fields: never serialize profile, answers, tab URLs or configuration.
  const course=safe(input.course||input.occ?.course);
  const type=safe(input.type||input.occ?.type);
  const error=input.error?runError(input.error,{course,type,phase:input.error.phase||input.phase}):null;
  if(error) for(const key of ['course','message','hint']) error[key]=safe(error[key]);
  const timestamp=Date.parse(input.at||'');
  return {version:1,at:Number.isFinite(timestamp)?new Date(timestamp).toISOString():new Date().toISOString(),course,state:safe(input.state),phaseDurations:durations,
    courseKind:{course,type,resolved:resolveCourseKind({course,type}),source:resolveCourseKind({type})?'type':resolveCourseKind({course})?'course':null},
    questionTitles:(input.questionTitles||[]).slice(0,100).map(q=>({before:safe(q.before),after:safe(q.after)})),error,
    ...(typeof (input.key||input.occ?.key)==='string'?{key:safe(input.key||input.occ.key)}:{}),
    ...(['already-set','native','goToday','today-cell','calendar','foreground'].includes(input.dateFillPath)?{dateFillPath:input.dateFillPath}:{}),
    ...(Array.isArray(input.dateDiag)?{dateDiag:input.dateDiag.slice(-40).map(row=>({inBackground:row?.inBackground===true,rectCount:Number.isSafeInteger(row?.rectCount)&&row.rectCount>=0?row.rectCount:0,step:safe(row?.step),count:Number.isSafeInteger(row?.count)&&row.count>0?row.count:1,...(typeof row?.disabled==='boolean'?{disabled:row.disabled}:{}),...(typeof row?.text==='string'?{text:safe(row.text).slice(0,20)}:{}),...(['already-set','native','goToday','today-cell'].includes(row?.path)?{path:row.path}:{}),...(['visible','hidden','prerender'].includes(row?.visibilityState)?{visibilityState:row.visibilityState}:{})}))}:{}),
    ...(Array.isArray(input.successPage)?{successPage:input.successPage.slice(0,100).map(row=>Object.fromEntries(['data-automation-id','role','aria-label','title'].filter(key=>typeof row?.[key]==='string').map(key=>[key,safe(row[key]).slice(0,250)])))}:{})};
}
export function diagnosticText(data) {
  return JSON.stringify((data.attendanceDiagnostics||[]).map(d=>createDiagnostic({...d,type:d.courseKind?.type},data.attendanceProfile)),null,2);
}
