import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const output=resolve(process.argv[2]||'test/fixtures/timetable-synthetic');
await mkdir(output,{recursive:true});
const days=['Mo','Tu','We','Th','Fr'];
function timetable({width=880,height=630,skew=0,lowContrast=false,merged=false}={}) {
  const left=20,top=75,dayW=85,headerH=50,rowH=(height-top-45-headerH)/5,periodW=(width-left*2-dayW)/11;
  const stroke=lowContrast?'#a4a4a4':'#444',text=lowContrast?'#777':'#111';
  const lines=[];const x0=left,x1=width-left,y0=top,y1=height-45;
  const rect=(x,y,w,h)=>lines.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${stroke}" stroke-width="1"/>`);
  rect(x0,y0,x1-x0,y1-y0);
  for(let day=0;day<=5;day++) lines.push(`<line x1="${x0}" y1="${y0+headerH+day*rowH}" x2="${x1}" y2="${y0+headerH+day*rowH}" stroke="${stroke}"/>`);
  lines.push(`<line x1="${x0+dayW}" y1="${y0}" x2="${x0+dayW}" y2="${y1}" stroke="${stroke}"/>`);
  for(let period=1;period<=11;period++) lines.push(`<line x1="${x0+dayW+period*periodW}" y1="${y0}" x2="${x0+dayW+period*periodW}" y2="${y0+headerH}" stroke="${stroke}"/>`);
  for(let d=0;d<5;d++) for(let boundary=1;boundary<11;boundary++) {
    if(merged&&d===2&&boundary===3) continue;
    const x=x0+dayW+boundary*periodW,yTop=y0+headerH+d*rowH;
    lines.push(`<line x1="${x}" y1="${yTop}" x2="${x}" y2="${yTop+rowH}" stroke="${stroke}"/>`);
  }
  if(merged) lines.push(`<line x1="${x0+dayW+2*periodW}" y1="${y0+headerH+2*rowH+rowH/2}" x2="${x0+dayW+4*periodW}" y2="${y0+headerH+2*rowH+rowH/2}" stroke="${stroke}"/>`);
  const labels=[];
  labels.push(`<text x="${width/2}" y="42" text-anchor="middle" font-size="32" fill="${text}">CS P1 - W2 (5-9/10/26) S1</text>`);
  for(let p=0;p<11;p++) labels.push(`<text x="${x0+dayW+(p+.5)*periodW}" y="${top+31}" text-anchor="middle" font-size="15" fill="${text}">${p+1}</text>`);
  days.forEach((day,index)=>labels.push(`<text x="${left+dayW/2}" y="${top+headerH+(index+.6)*rowH}" text-anchor="middle" font-size="21" fill="${text}">${day}</text>`));
  const course=(day,period,label,extra='')=>{const x=x0+dayW+(period+.5)*periodW,y=y0+headerH+(day+.48)*rowH;labels.push(`<text x="${x}" y="${y}" text-anchor="middle" font-size="12" fill="${text}">${label}</text>${extra}`);};
  course(0,1,'TEST1001-LEC',`<text x="${x0+dayW+1.5*periodW}" y="${y0+headerH+rowH*.7}" font-size="9" fill="${text}">R101 Tutor A</text>`);
  course(1,3,'TEST1001-TUT');
  if(merged) {
    const x=x0+dayW+3*periodW,y=y0+headerH+2*rowH;
    labels.push(`<text x="${x}" y="${y+rowH*.35}" text-anchor="middle" font-size="12" fill="${text}">TEST1001-LAB Group 1</text><text x="${x}" y="${y+rowH*.82}" text-anchor="middle" font-size="12" fill="${text}">TEST1001-LAB Group 2</text>`);
  }
  const transform=skew?`transform="rotate(${skew} ${width/2} ${height/2})"`:'';
  const filter=lowContrast?`filter="saturate(0)"`:'';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${lowContrast?'#eee':'white'}"/><g ${transform} ${filter} font-family="Arial">${lines.join('')}${labels.join('')}</g></svg>`;
}

const cases=[
  ['standard.png',{width:880,height:630}],
  ['merged-groups.png',{width:880,height:630,merged:true}],
  ['large.png',{width:1320,height:945,merged:true}],
  ['skew-low-contrast.png',{width:880,height:630,skew:.35,lowContrast:true,merged:true}]
];
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();
  for(const [name,options] of cases) {await page.setContent(timetable(options));await page.screenshot({path:resolve(output,name),fullPage:true});}
  await page.setContent(timetable({width:880,height:630,merged:true}));await page.screenshot({path:resolve(output,'compressed.jpg'),type:'jpeg',quality:52,fullPage:true});
} finally {await browser.close();}
console.log(`Generated ${cases.length+1} synthetic aSc-style images in ${output}`);
