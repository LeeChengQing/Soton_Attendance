const DAYS={sunday:0,sun:0,monday:1,mon:1,tuesday:2,tue:2,wednesday:3,wed:3,thursday:4,thu:4,friday:5,fri:5,saturday:6,sat:6};
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;

export function normalizeDate(value) {
  const text=String(value||'').trim();
  let m=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return calendarDate(`${m[1]}-${pad(m[2])}-${pad(m[3])}`);
  m=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return calendarDate(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  return null;
}
function calendarDate(value) {const d=new Date(`${value}T00:00:00Z`);return Number.isFinite(d.getTime())&&iso(d)===value?value:null;}

export function parseScheduleText(text) {
  const rows=[];
  for (const source of String(text||'').split(/\r?\n/)) {
    const line=source.replace(/\s+/g,' ').trim();
    const time=line.match(/\b(\d{1,2})[:.](\d{2})\s*(?:-|–|—|to)\s*(\d{1,2})[:.](\d{2})\b/i);
    if (!time) continue;
    const start=`${pad(time[1])}:${time[2]}`, end=`${pad(time[3])}:${time[4]}`;
    if (+time[1]>23 || +time[3]>23 || +time[2]>59 || +time[4]>59 || end<=start) continue;
    const before=line.slice(0,time.index).trim(), after=line.slice(time.index+time[0].length).trim();
    const day=before.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|wed|thu|fri|sat)\b/i);
    const date=before.match(/\b(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})\b/);
    const course=(after||before.replace(day?.[0]||date?.[0]||'','')).trim();
    if (!course) continue;
    if (date && normalizeDate(date[0])) rows.push({kind:'dated',date:normalizeDate(date[0]),time:start,endTime:end,course});
    else if (day) rows.push({kind:'weekly',weekday:DAYS[day[0].toLowerCase()],time:start,endTime:end,course});
  }
  return rows;
}

export function parseScheduleTokens(tokens) {
  const ordered=[...tokens].filter(t=>t.text?.trim()).sort((a,b)=>a.y-b.y||a.x-b.x);
  const lines=[];
  for(const token of ordered) {
    const line=lines.find(row=>Math.abs(row.y-token.y)<=Math.max(6,(token.height||12)/2));
    if(line) line.items.push(token); else lines.push({y:token.y,items:[token]});
  }
  const dayOf=t=>DAYS[normalizeToken(t.text)];
  const header=lines.find(row=>row.items.filter(t=>dayOf(t)!==undefined).length>=2);
  if(!header) return [];
  const columns=header.items.filter(t=>dayOf(t)!==undefined).sort((a,b)=>a.x-b.x);
  const rows=[];
  for(const line of lines.filter(row=>row.y>header.y)) {
    const timeItems=line.items.filter(t=>t.x<columns[0].x).sort((a,b)=>a.x-b.x);
    const timeText=timeItems.map(t=>t.text).join(' ');
    const range=timeText.match(/(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})/);
    if(!range) continue;
    const start=`${pad(range[1])}:${range[2]}`,end=`${pad(range[3])}:${range[4]}`;
    for(let i=0;i<columns.length;i++) {
      const left=i===0?Math.max(...timeItems.map(t=>t.x+t.width)):((columns[i-1].x+columns[i].x)/2);
      const right=i===columns.length-1?Infinity:(columns[i].x+columns[i+1].x)/2;
      const course=line.items.filter(t=>!timeItems.includes(t) && t.x>=left && t.x<right).sort((a,b)=>a.x-b.x).map(t=>t.text.trim()).join(' ').trim();
      if(course && end>start) rows.push({kind:'weekly',weekday:dayOf(columns[i]),time:start,endTime:end,course});
    }
  }
  return rows;
}
const normalizeToken=s=>String(s).trim().toLowerCase();

export function occurrencesBetween(sessions,startDate,endDate) {
  const result=[];
  for(let d=new Date(`${startDate}T00:00:00Z`);d<=new Date(`${endDate}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1)) {
    const date=iso(d);
    for(const s of sessions) {
      if(s.enabled===false) continue;
      if(s.kind==='dated' ? s.date!==date : s.weekday!==d.getUTCDay() || date<s.startDate || date>s.endDate || (s.exceptions||[]).includes(date)) continue;
      result.push({...s,date,key:`${encodeURIComponent(s.course.trim().toLowerCase())}:${date}:${s.time}`});
    }
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.id.localeCompare(b.id));
}

export function toWeeklySession(session) {
  const {date,startDate,endDate,...weekly}=session;
  const weekday=session.kind==='dated'?new Date(`${normalizeDate(date)}T00:00:00Z`).getUTCDay():Number(session.weekday);
  if(!Number.isInteger(weekday)||weekday<0||weekday>6) throw Error(`${session.course||'课程'} 缺少有效星期。`);
  return {...weekly,kind:'weekly',weekday};
}

const fingerprint=s=>[s.course?.trim().toLowerCase(),s.kind,s.kind==='dated'?s.date:s.weekday,s.time,s.endTime].join('|');
export function mergeSessions(existing,incoming) {
  const merged=[...existing], seen=new Set(existing.map(fingerprint));
  for(const row of incoming) if(!seen.has(fingerprint(row))) {merged.push(row);seen.add(fingerprint(row));}
  return merged;
}

export function todayMalaysia(now=new Date()) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function occurrenceTimestamp(occurrence) {return Date.parse(`${occurrence.date}T${occurrence.time}:00+08:00`);}

export function triggerTimestamp(occurrence) {
  const end=String(occurrence.endTime||occurrence.time||'');
  const match=end.match(/^(\d{1,2}):(\d{2})$/);
  if(!match) return occurrenceTimestamp(occurrence)-5*60*1000;
  const hour=Number(match[1]),minute=Number(match[2]);
  if(hour>23||minute>59) return occurrenceTimestamp(occurrence)-5*60*1000;
  return Date.parse(`${occurrence.date}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+08:00`)-5*60*1000;
}
