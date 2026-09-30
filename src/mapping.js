import {normalize} from './forms.js';

const placeholder=label=>[['',label]];
const radioOption=(options,kind)=>options.find(option=>kind==='lab'?['lab','laboratory'].includes(normalize(option)):normalize(option)===kind);
const identityOption=(options,kind)=>options.find(option=>kind==='local'?/\blocal\b/i.test(option)&&!/international/i.test(option):/international/i.test(option));

export function fieldMappingForQuestion(question,course='') {
  const title=normalize(question.title),options=question.options||[];
  if(question.type==='date') return {choices:[['date','当日日期 · 自动核对']],selected:'date'};
  if(question.type==='text') {
    if(/student.*id|university.*id|学号/.test(title)) return {choices:[['student','学号']],selected:'student'};
    if(/\bname\b|姓名/.test(title)) return {choices:[['name','姓名']],selected:'name'};
    if(/\bdate\b|日期/.test(title)) return {choices:placeholder('日期题型不匹配，请核对表单'),selected:''};
    return {choices:[...placeholder('选择文字资料'),['student','学号'],['name','姓名']],selected:''};
  }
  if(question.type==='radio') {
    const deliveryKinds=['lecture','tutorial','lab'].filter(kind=>radioOption(options,kind));
    if(/delivery|授课/.test(title)||deliveryKinds.length>=2) {
      const choices=[['delivery','按课程名称自动选']];
      for(const kind of deliveryKinds) choices.push([`delivery:${kind}`,`固定选 ${radioOption(options,kind)}`]);
      const courseKind=/(?:^|\W)(?:tut|tutorial)\b/i.test(course)?'tutorial':/(?:^|\W)(?:lab|laboratory)\b/i.test(course)?'lab':/(?:^|\W)(?:lec|lecture)\b/i.test(course)?'lecture':null;
      return {choices:deliveryKinds.length?choices:placeholder('课程类型选项不受支持'),selected:courseKind&&deliveryKinds.includes(courseKind)?'delivery':''};
    }
    if(identityOption(options,'local')&&identityOption(options,'international')) return {choices:[['local','按学生身份自动选 Local / International'],['local:local','固定选 Local'],['local:international','固定选 International']],selected:'local'};
  }
  return {choices:placeholder('暂不支持这道题'),selected:''};
}
