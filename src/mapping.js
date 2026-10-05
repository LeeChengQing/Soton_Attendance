import {normalize} from './forms.js';
import {t} from './options-locale.js';

const placeholder=label=>[['',label]];
const radioOption=(options,kind)=>options.find(option=>kind==='lab'?['lab','laboratory'].includes(normalize(option)):normalize(option)===kind);
const identityOption=(options,kind)=>options.find(option=>kind==='local'?/\blocal\b/i.test(option)&&!/international/i.test(option):/international/i.test(option));

export function fieldMappingForQuestion(question,course='') {
  const title=normalize(question.title),options=question.options||[];
  if(question.type==='date') return {choices:[[question.required===false?'skip':'date',t(question.required===false?'dateOptional':'dateAutoCheck')]],selected:question.required===false?'skip':'date'};
  if(question.type==='text') {
    if(/student.*id|university.*id|学号/.test(title)) return {choices:[['student',t('profileFieldStudent')]],selected:'student'};
    if(/\bname\b|姓名/.test(title)) return {choices:[['name',t('profileFieldName')]],selected:'name'};
    if(/\bdate\b|日期/.test(title)) return {choices:placeholder(t('dateMismatchQuestion')),selected:''};
    return {choices:[...placeholder(t('selectTextData')),['student',t('profileFieldStudent')],['name',t('profileFieldName')]],selected:''};
  }
  if(question.type==='radio') {
    const deliveryKinds=['lecture','tutorial','lab'].filter(kind=>radioOption(options,kind));
    if(/delivery|授课/.test(title)||deliveryKinds.length>=2) {
      const choices=[['delivery',t('courseKindAuto')]];
      for(const kind of deliveryKinds) choices.push([`delivery:${kind}`,t('fixedOption',{option:radioOption(options,kind)})]);
      const courseKind=/(?:^|\W)(?:tut|tutorial)\b/i.test(course)?'tutorial':/(?:^|\W)(?:lab|laboratory)\b/i.test(course)?'lab':/(?:^|\W)(?:lec|lecture)\b/i.test(course)?'lecture':null;
      return {choices:deliveryKinds.length?choices:placeholder(t('unsupportedCourseOptions')),selected:courseKind&&deliveryKinds.includes(courseKind)?'delivery':''};
    }
    if(identityOption(options,'local')&&identityOption(options,'international')) return {choices:[['local',t('studentTypeAuto')],['local:local',t('fixedLocal')],['local:international',t('fixedInternational')]],selected:'local'};
  }
  return {choices:placeholder(t('unsupportedQuestion')),selected:''};
}
