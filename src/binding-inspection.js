export function collectBindingInspectionTargets(entries,validateUrl) {
  const targets=[],missing=[],invalid=[];
  for(const entry of entries) {
    const key=String(entry?.key||'').trim(),value=String(entry?.url||'').trim();
    if(!value) {missing.push(key);continue;}
    try {targets.push({key,url:validateUrl(value).href});}
    catch(error) {invalid.push(`${key}: ${error.message}`);}
  }
  if(missing.length||invalid.length) {
    const details=[missing.length?`未填写：${missing.join('、')}`:'',invalid.length?`链接无效：${invalid.join('；')}`:''].filter(Boolean).join('。');
    throw Error(`请先补齐全部课程表单链接。${details}`);
  }
  if(!targets.length) throw Error('请先导入或添加课程。');
  return targets;
}
