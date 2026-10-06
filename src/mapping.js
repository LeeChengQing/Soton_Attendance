import {normalize} from './forms.js';
import {t} from './options-locale.js';

const placeholder=label=>[['',label]];
const optionHas=(option,kind)=>{
  const words=normalize(option).match(/[a-z]+/g)||[];
  const kinds=[...new Set(words.map(word=>word==='laboratory'?'lab':word).filter(word=>['lecture','tutorial','lab'].includes(word)))];
  const negative=words.some((word,index)=>['no','not','non','without','never'].includes(word)&&words.slice(index+1,index+4).some(next=>['lecture','tutorial','lab','laboratory'].includes(next)));
  return !negative&&kinds.length===1&&kinds[0]===kind;
};
const radioOption=(options,kind)=>{const matches=options.filter(option=>optionHas(option,kind));return matches.length===1?matches[0]:undefined;};
const identityOption=(options,kind)=>{
  const matches=options.filter(option=>{
    const title=normalize(option);
    if(/\b(?:not|no|non|without|never)\b/.test(title)) return false;
    return kind==='local'?/\blocal\b/.test(title)&&!/\binternational\b/.test(title):/\binternational\b/.test(title);
  });
  return matches.length===1?matches[0]:undefined;
};

export function fieldMappingForQuestion(question,course='') {
  const title=normalize(question.title).replace(/\s*single line text(?:\s*\.\s*\(text\))?$/,'').trim(),options=question.options||[];
  if(question.type==='date') return {choices:[[question.required===false?'skip':'date',t(question.required===false?'dateOptional':'dateAutoCheck')]],selected:question.required===false?'skip':'date'};
  if(question.type==='text') {
    if(/(?:student|university|learner|id|identification).*(?:\bid\b|number|no\.?\b)|学号/.test(title)) return {choices:[['student',t('profileFieldStudent')]],selected:'student'};
    if(/\bname\b|姓名/.test(title)) return {choices:[['name',t('profileFieldName')]],selected:'name'};
    if(/\bdate\b|日期/.test(title)) return {choices:placeholder(t('dateMismatchQuestion')),selected:''};
    return {choices:[...placeholder(t('selectTextData')),['student',t('profileFieldStudent')],['name',t('profileFieldName')]],selected:''};
  }
  if(question.type==='radio') {
    const deliveryKinds=['lecture','tutorial','lab'].filter(kind=>radioOption(options,kind));
    if(/delivery|授课|session type|class type|lesson type/.test(title)||deliveryKinds.length>=2) {
      const choices=[['delivery',t('courseKindAuto')]];
      for(const kind of deliveryKinds) choices.push([`delivery:${kind}`,t('fixedOption',{option:radioOption(options,kind)})]);
      const courseKind=/(?:^|\W)(?:tut|tutorial)\b/i.test(course)?'tutorial':/(?:^|\W)(?:lab|laboratory)\b/i.test(course)?'lab':/(?:^|\W)(?:lec|lecture)\b/i.test(course)?'lecture':null;
      return {choices:deliveryKinds.length?choices:placeholder(t('unsupportedCourseOptions')),selected:courseKind&&deliveryKinds.includes(courseKind)?'delivery':''};
    }
    if(identityOption(options,'local')&&identityOption(options,'international')) return {choices:[['local',t('studentTypeAuto')],['local:local',t('fixedLocal')],['local:international',t('fixedInternational')]],selected:'local'};
  }
  return {choices:placeholder(t('unsupportedQuestion')),selected:''};
}
