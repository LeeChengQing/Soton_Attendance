const pad=value=>String(value).padStart(2,'0');
const minuteClock=minutes=>`${pad(Math.floor(minutes/60)%24)}:${pad(minutes%60)}`;
const editDistance=(left,right)=>{
  const row=Array.from({length:right.length+1},(_,i)=>i);
  for(let i=1;i<=left.length;i++) {let diagonal=row[0];row[0]=i;for(let j=1;j<=right.length;j++) {const old=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,diagonal+(left[i-1]===right[j-1]?0:1));diagonal=old;}}
  return row[right.length];
};

export function periodTime(periodStart,periodEnd=periodStart,{startHour=8,minutesPerPeriod=60,header=null}={}) {
  if(!Number.isInteger(periodStart)||!Number.isInteger(periodEnd)||periodStart<1||periodEnd<periodStart||!Number.isFinite(startHour)||!Number.isFinite(minutesPerPeriod)||minutesPerPeriod<=0) throw new TypeError('invalid period mapping');
  const startMinutes=startHour*60+periodStart*minutesPerPeriod,endMinutes=startHour*60+(periodEnd+1)*minutesPerPeriod;
  const mappedStart=minuteClock(startMinutes),mappedEnd=minuteClock(endMinutes);
  const validClock=value=>typeof value==='string'&&/^\d{1,2}:[0-5]\d$/.test(value)&&Number(value.split(':')[0])<24;
  const headerStart=validClock(header?.start)?header.start.padStart(5,'0'):'';
  const headerEnd=validClock(header?.end)?header.end.padStart(5,'0'):'';
  const headerUsable=headerStart&&headerEnd&&headerEnd>headerStart;
  const conflict=headerUsable&&((headerStart!==mappedStart)||(headerEnd!==mappedEnd));
  return {start:headerUsable?headerStart:mappedStart,end:headerUsable?headerEnd:mappedEnd,needsReview:Boolean(conflict||(header?.start||header?.end)&&!headerUsable)};
}

function normalizedLines(text) {
  return String(text||'').replace(/[｜¦]/g,' ').replace(/[‐‑‒–—]/g,'-').split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(Boolean);
}

export function parseCellText(text,context={}) {
  const lines=normalizedLines(text),raw=lines.join('\n'),corrections=[];
  const courseMatch=raw.match(/\b([A-Z]{4}\d{4})\b/i);
  const codeRaw=courseMatch?.[1]||'';
  const code=codeRaw.toUpperCase();
  const typeCandidates=lines.flatMap(line=>[...line.matchAll(/-?\s*([A-Z0-9]{3})\b/gi)]).map(match=>match[1].toUpperCase());
  let typeRaw=typeCandidates.find(value=>['LEC','LAB','TUT'].includes(value)||['LEC','LAB','TUT'].some(known=>editDistance(value,known)===1))||'';
  let type=typeRaw;
  if(typeRaw&&!['LEC','LAB','TUT'].includes(typeRaw)) {type=['LEC','LAB','TUT'].find(known=>editDistance(typeRaw,known)===1)||'';if(type) corrections.push({field:'type',raw:typeRaw,corrected:type});}
  if(typeRaw&&type&&typeRaw!==type&&!corrections.some(item=>item.field==='type')) corrections.push({field:'type',raw:typeRaw,corrected:type});
  const roomCandidate=raw.match(/\b(?:3[RRO]0[0-9OG]{2}|R\d{3})\b/i)?.[0]||'';
  let room=roomCandidate.toUpperCase();
  if(/^3/i.test(room)) {
    const corrected=room.replace(/^3[RRO]0/i,'3R0').replace(/[OG]/g,'0');
    if(corrected!==room) {corrections.push({field:'room',raw:room,corrected});room=corrected;}
  }
  const groupMatch=raw.match(/\bGroup\s*([12])\b/i),group=groupMatch?.[1]||'';
  const metadataPattern=/^(?:[A-Z]{4}\d{4}(?:\s*-\s*(?:LEC|LAB|TUT))?|-?\s*[A-Z0-9]{3}|(?:3[RRO]0[0-9OG]{2}|R\d{3})|Group\s*[12])$/i;
  const lecturer=lines.find(line=>{const clean=line.replace(/[|¦]/g,' ').trim();return !metadataPattern.test(clean)&&!/^[\s.-]+$/.test(clean);})||'';
  const fields={
    code:{raw:codeRaw,value:code,confidence:code?.match(/^[A-Z]{4}\d{4}$/)?(codeRaw===code?0.94:0.8):0},
    type:{raw:typeRaw,value:type,confidence:type?(['LEC','LAB','TUT'].includes(typeRaw)?0.92:0.68):0},
    group:{raw:groupMatch?.[0]||'',value:group,confidence:group?0.9:0.75},
    room:{raw:roomCandidate,value:room,confidence:room?(roomCandidate.toUpperCase()===room?0.9:0.68):0},
    lecturer:{raw:lecturer,value:lecturer,confidence:lecturer?0.76:0}
  };
  const evidence=Number.isFinite(context.ocrConfidence)?Math.max(.2,Math.min(1,context.ocrConfidence)):1;
  for(const value of Object.values(fields)) value.confidence=Number((value.confidence*evidence).toFixed(2));
  const confidence=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,value.confidence]));
  const course=code?`${code}${type?`-${type}`:''}${group?` Group ${group}`:''}`:raw.replace(/\s+/g,' ').trim();
  const base={...context,code,type,group,room,lecturer,course,confidence,fields,raw,corrections};
  return {...base,needsReview:Boolean(context.needsReview||corrections.length||!code||!type||Object.values(confidence).some(value=>value<0.7))};
}
