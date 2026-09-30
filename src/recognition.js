import {parseScheduleText,parseScheduleTokens,mergeSessions} from './schedule.js';

const DAY_LABELS={mo:1,tu:2,we:3,th:4,fr:5,sa:6,su:0};
const rangePattern=/(\d{1,2}):([0-5]\d)\s*[-–—]\s*(\d{1,2}):([0-5]\d)/;
const clockPattern=/^\d{1,2}:[0-5]\d$/;
const centerX=t=>t.x+t.width/2;
const centerY=t=>t.y+t.height/2;
const pad=n=>String(n).padStart(2,'0');
const clock=(hour,minute)=>`${pad(hour)}:${minute}`;

function weekDates(text) {
  const match=String(text).match(/(\d{1,2})[/.](\d{1,2})\s*[-–—]\s*(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/);
  if(!match) return null;
  const year=+match[5]<100?2000+(+match[5]):+match[5];
  const startYear=+match[2]>+match[4]?year-1:year;
  const start=new Date(Date.UTC(startYear,+match[2]-1,+match[1]));
  const end=new Date(Date.UTC(year,+match[4]-1,+match[3]));
  if(start.getUTCDate()!==+match[1] || end.getUTCDate()!==+match[3] || end-start<0 || end-start>7*86400000) return null;
  const dates=new Map();
  for(let day=new Date(start);day<=end;day.setUTCDate(day.getUTCDate()+1)) {
    dates.set(day.getUTCDay(),`${day.getUTCFullYear()}-${pad(day.getUTCMonth()+1)}-${pad(day.getUTCDate())}`);
  }
  return dates;
}

function hourColumns(tokens,firstCourseY) {
  const headerRow=tokens.filter(t=>t.y<firstCourseY);
  const header=headerRow.filter(t=>/\d{1,2}:[0-5]\d/.test(t.text));
  const complete=header.flatMap(t=>{
    const match=t.text.match(rangePattern);
    return match?[{x:centerX(t),y:centerY(t),time:clock(match[1],match[2]),endTime:clock(match[3],match[4])}]:[];
  });
  if(complete.length>=2) return complete.sort((a,b)=>a.x-b.x);
  const pieces=header.filter(t=>clockPattern.test(t.text.trim())).sort((a,b)=>a.y-b.y||a.x-b.x);
  const columns=[];
  for(const start of pieces) {
    const next=pieces.find(end=>end.x>start.x+start.width && Math.abs(centerY(end)-centerY(start))<Math.max(start.height,end.height) &&
      !pieces.some(middle=>middle.x>start.x+start.width && middle.x<end.x) &&
      headerRow.some(dash=>/^[-–—]$/.test(dash.text.trim()) && dash.x>start.x+start.width && dash.x<end.x && Math.abs(centerY(dash)-centerY(start))<start.height));
    if(next) columns.push({x:(start.x+next.x+next.width)/2,y:centerY(start),time:clock(...start.text.split(':')),endTime:clock(...next.text.split(':'))});
  }
  return columns.filter((column,index,list)=>list.findIndex(other=>Math.abs(other.x-column.x)<Math.max(3,(other.x||0)*.002))===index).sort((a,b)=>a.x-b.x);
}

function nearestColumn(columns,x) {
  return columns.reduce((best,column,index)=>Math.abs(column.x-x)<Math.abs(columns[best].x-x)?index:best,0);
}

function parseASCTimetable(tokens,text) {
  const courses=tokens.filter(t=>/\b[A-Z]{2,}\d{3,}(?:-[A-Z]{2,})?\b/i.test(t.text));
  const days=tokens.filter(t=>DAY_LABELS[t.text.trim().toLowerCase()]!==undefined).sort((a,b)=>centerY(a)-centerY(b));
  if(!courses.length || days.length<2) return [];
  const columns=hourColumns(tokens,Math.min(...courses.map(t=>t.y)));
  if(columns.length<2) return [];
  const dates=weekDates(`${text}\n${tokens.map(t=>t.text).join(' ')}`),rows=[];
  for(const course of courses) {
    const dayIndex=days.findIndex((day,index)=>centerY(course)<(centerY(day)+centerY(days[index+1]||day))/2);
    const selectedDay=dayIndex<0?days.at(-1):days[dayIndex];
    if(!selectedDay || centerY(course)<Math.min(...columns.map(c=>c.y))) continue;
    const weekday=DAY_LABELS[selectedDay.text.trim().toLowerCase()];
    const first=nearestColumn(columns,course.x),last=nearestColumn(columns,course.x+course.width);
    const start=columns[Math.min(first,last)],end=columns[Math.max(first,last)];
    if(end.endTime<=start.time) continue;
    const suffix=tokens.find(t=>/^[-–](LEC|LAB|TUT)$/i.test(t.text.trim()) &&
      Math.abs(centerX(t)-centerX(course))<Math.max(course.width/3,course.height) &&
      t.y>=course.y && t.y-course.y<course.height*2.5);
    const group=tokens.find(t=>/^Group(?:\s*[12])?$/i.test(t.text.trim()) &&
      t.y<course.y && course.y-t.y<course.height*2.5 &&
      centerX(t)>=course.x && centerX(t)<=course.x+course.width+course.height*2);
    let groupNumber=group?.text.match(/[12]/)?.[0];
    if(group && !groupNumber) groupNumber=tokens.find(t=>/^[12]$/.test(t.text.trim()) &&
      t.x>=group.x+group.width && t.x-group.x-group.width<course.height*2 &&
      Math.abs(centerY(t)-centerY(group))<course.height)?.text.trim();
    const label=`${course.text.trim()}${suffix && !/-[A-Z]+$/i.test(course.text)?suffix.text.trim():''}${groupNumber?` Group ${groupNumber}`:''}`;
    const date=dates?.get(weekday);
    if(dates && !date) continue;
    rows.push(date?{kind:'dated',date,time:start.time,endTime:end.endTime,course:label}:
      {kind:'weekly',weekday,time:start.time,endTime:end.endTime,course:label});
  }
  return rows.sort((a,b)=>(a.date||a.weekday).toString().localeCompare((b.date||b.weekday).toString())||a.time.localeCompare(b.time)||a.course.localeCompare(b.course));
}

export function rowsFromPage({text='',tokens=[]}) {
  return mergeSessions(parseASCTimetable(tokens,text),mergeSessions(parseScheduleTokens(tokens),parseScheduleText(text)));
}
