// Extend this table for additional Forms interface languages. Rules only match
// trailing accessibility metadata, never phrases in the middle of a title.
export const questionTitleRules = [
  {labels:['Required to answer','必答','必填']},
  {labels:['Single line text','单行文本','單行文字']},
  {labels:['Single choice','单选','單選']},
  {labels:['Multiple choice','多选','多選']},
  {labels:['Long answer text','长答案文本','長答案文字','多行文本']},
  {labels:['Date','日期'],attached:true},
];

const escapeRegex=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const tidy=value=>value.replace(/\s+/g,' ').trim();

export function cleanQuestionTitle(raw,rules=questionTitleRules) {
  let title=tidy(String(raw??'').normalize('NFKC')).replace(/^\d+\s*[.)、]\s*/,'').replace(/^[.。]+\s*/,'');
  let changed=true;
  while(changed) {
    changed=false;
    for(const rule of rules) {
      const labels=rule.labels.map(label=>escapeRegex(label).replace(/ /g,'\\s+')).join('|');
      const suffix=new RegExp(`(${labels})[\\s.。…]*(?:\\((?:text|radio|checkbox|date)(?:\\s*:[^)]*)?\\))?[\\s.。…]*$`,'i');
      const match=suffix.exec(title);
      if(!match||match.index===0) continue;
      const prefix=title.slice(0,match.index);
      if(rule.attached) {
        // "Date" is also a legitimate question/word. Only strip an attached
        // metadata boundary (ClassDate), not "Submission Date" or "Update".
        const previous=prefix.at(-1),first=match[1][0];
        const afterMetadata=rules.some(other=>!other.attached&&other.labels.some(label=>prefix.toLowerCase().endsWith(label.toLowerCase())));
        if(/\s/.test(previous)||(/[a-z]/i.test(first)&&!afterMetadata&&!(/[.。]/.test(previous)||(/[a-z]/.test(previous)&&/[A-Z]/.test(first))))) continue;
      }
      title=tidy(prefix.replace(/[\s.。…]+$/,''));
      changed=true;
      break;
    }
  }
  return title;
}

export const normalizeComparable=value=>cleanQuestionTitle(value).toLowerCase();
