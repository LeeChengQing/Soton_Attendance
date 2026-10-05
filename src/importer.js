import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {createWorker,PSM} from 'tesseract.js';
import {decodeQrPixelsInRegions,qrScanRegions} from './qr.js';
import {rowsFromPage} from './recognition.js';
import {weekDates} from './recognition.js';
import {detectTimetableGrid,hasForeground,otsuThreshold} from './timetable-grid.js';
import {periodTime,parseCellText} from './timetable-fields.js';
import {mergeSessions} from './schedule.js';
import {t} from './options-locale.js';

GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('assets/pdf.worker.min.mjs');
const asset=name=>chrome.runtime.getURL(`assets/${name}`);

async function imageCanvas(blob) {
  const image=await createImageBitmap(blob);
  const canvas=document.createElement('canvas');
  canvas.width=image.width;canvas.height=image.height;
  canvas.getContext('2d',{willReadFrequently:true}).drawImage(image,0,0);
  image.close();
  return canvas;
}

function enhancedCanvas(source,scale=3) {
  const canvas=document.createElement('canvas');canvas.width=source.width*scale;canvas.height=source.height*scale;
  const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(source,0,0,canvas.width,canvas.height);
  const image=context.getImageData(0,0,canvas.width,canvas.height),threshold=otsuThreshold(image);
  for(let i=0;i<image.data.length;i+=4) {
    const value=Math.round(.299*image.data[i]+.587*image.data[i+1]+.114*image.data[i+2])<=threshold?0:255;
    image.data[i]=image.data[i+1]=image.data[i+2]=value;image.data[i+3]=255;
  }
  context.putImageData(image,0,0);return canvas;
}

function cropCanvas(source,left,top,width,height,scale=3) {
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(width*scale));canvas.height=Math.max(1,Math.ceil(height*scale));
  const context=canvas.getContext('2d',{willReadFrequently:true});context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
  context.drawImage(source,left,top,width,height,0,0,canvas.width,canvas.height);return canvas;
}

function hasInk(source,left,top,right,bottom) {
  const width=right-left,height=bottom-top;if(width<4||height<4) return false;
  const image=source.getContext('2d',{willReadFrequently:true}).getImageData(left,top,width,height);
  return hasForeground(image,Math.max(2,width*height*.001));
}

async function makeWorker(onProgress) {
  return createWorker('eng',1,{workerPath:asset('worker.min.js'),corePath:asset('tesseract-core'),langPath:asset('lang'),workerBlobURL:false,cacheMethod:'none',logger:m=>onProgress?.(`${m.status} ${Math.round((m.progress||0)*100)}%`)});
}

function extractOcr(data,scale=1,offset={x:0,y:0}) {
  const tokens=[];
  for(const block of data.blocks||[]) for(const para of block.paragraphs||[]) for(const line of para.lines||[]) for(const word of line.words||[]) {
    const b=word.bbox;tokens.push({text:word.text,x:offset.x+b.x0/scale,y:offset.y+b.y0/scale,width:(b.x1-b.x0)/scale,height:(b.y1-b.y0)/scale,confidence:word.confidence});
  }
  return {text:data.text||'',tokens};
}

async function recognizeImageGrid(source,onProgress) {
  const ctx=source.getContext('2d',{willReadFrequently:true}),grid=detectTimetableGrid(ctx.getImageData(0,0,source.width,source.height));
  if(!grid.ok) return {rows:[],gridFailure:grid.reason};
  const worker=await makeWorker(onProgress);
  try {
    const titleBounds={left:0,top:0,width:source.width,height:Math.max(1,grid.table.top)};
    const timeBounds={left:grid.table.left,top:grid.table.top,width:grid.table.right-grid.table.left,height:grid.table.headerBottom-grid.table.top};
    const dayBounds={left:grid.table.left,top:grid.table.headerBottom,width:grid.table.dayBoundary-grid.table.left,height:grid.table.bottom-grid.table.headerBottom};
    const titleCanvas=enhancedCanvas(cropCanvas(source,titleBounds.left,titleBounds.top,titleBounds.width,titleBounds.height,2),1);
    const timeCanvas=enhancedCanvas(cropCanvas(source,timeBounds.left,timeBounds.top,timeBounds.width,timeBounds.height,3),1);
    const dayCanvas=enhancedCanvas(cropCanvas(source,dayBounds.left,dayBounds.top,dayBounds.width,dayBounds.height,2),1);
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 :/.-()'});
    const title=extractOcr((await worker.recognize(titleCanvas,{}, {text:true,blocks:true})).data,1);
    const header=extractOcr((await worker.recognize(timeCanvas,{}, {text:true,blocks:true})).data,3,{x:timeBounds.left,y:timeBounds.top});
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'});
    const dayLabels=extractOcr((await worker.recognize(dayCanvas,{}, {text:true,blocks:true})).data,2,{x:dayBounds.left,y:dayBounds.top});
    const dates=weekDates(title.text),weekdayIds={Mo:1,Tu:2,We:3,Th:4,Fr:5},rows=[];
    const weekdayNames={mo:'Mo',mon:'Mo',monday:'Mo',tu:'Tu',tue:'Tu',tues:'Tu',tuesday:'Tu',we:'We',wed:'We',wednesday:'We',th:'Th',thu:'Th',thur:'Th',thurs:'Th',thursday:'Th',fr:'Fr',fri:'Fr',friday:'Fr'};
    const rowDays=new Map();
    for(const row of grid.dayRows) {
      const label=dayLabels.tokens.toSorted((a,b)=>Math.abs(a.y+a.height/2-row.center)-Math.abs(b.y+b.height/2-row.center)).find(token=>Math.abs(token.y+token.height/2-row.center)<(row.bottom-row.top)*.42);
      const normalized=label?.text.toLowerCase().replace(/[^a-z]/g,'');
      if(weekdayNames[normalized]) rowDays.set(row.day,weekdayNames[normalized]);
    }
    const headerRanges=header.tokens.flatMap(token=>{const found=[...token.text.matchAll(/(\d{1,2}:[0-5]\d)\s*[-–—]\s*(\d{1,2}:[0-5]\d)/g)];return found.map(match=>({x:token.x+token.width/2,start:match[1],end:match[2]}));});
    const clockTokens=header.tokens.filter(token=>/^\d{1,2}:[0-5]\d$/.test(token.text.trim())).sort((a,b)=>a.y-b.y||a.x-b.x);
    for(const start of clockTokens) {const end=clockTokens.find(item=>item.x>start.x+start.width&&Math.abs(item.y-start.y)<Math.max(item.height,start.height)*1.5);if(end) headerRanges.push({x:(start.x+end.x+end.width)/2,start:start.text.trim(),end:end.text.trim()});}
    for(const cell of grid.cells) for(const segment of cell.groupSegments) {
      const padding=Math.max(1,Math.round(Math.min(source.width,source.height)*.002)),left=Math.ceil(cell.left+padding),top=Math.ceil(segment.top+padding),right=Math.floor(cell.right-padding),bottom=Math.floor(segment.bottom-padding);
      if(!hasInk(source,left,top,right,bottom)) continue;
      const crop=cropCanvas(source,left,top,right-left,bottom-top,3);
      const cropCtx=crop.getContext('2d',{willReadFrequently:true});
      cropCtx.fillStyle='#fff';cropCtx.fillRect(0,0,crop.width,3);cropCtx.fillRect(0,crop.height-3,crop.width,3);cropCtx.fillRect(0,0,3,crop.height);cropCtx.fillRect(crop.width-3,0,3,crop.height);
      const prepared=enhancedCanvas(crop,1);
      await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK,tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 -'});
      const recognized=extractOcr((await worker.recognize(prepared,{}, {text:true,blocks:true})).data);
      const nearestHeader=period=>headerRanges.toSorted((a,b)=>Math.abs(a.x-grid.periodColumns[period-1].center)-Math.abs(b.x-grid.periodColumns[period-1].center))[0];
      const firstHeader=nearestHeader(cell.periodStart),lastHeader=nearestHeader(cell.periodEnd);
      const headerTime=firstHeader&&lastHeader?{start:firstHeader.start,end:lastHeader.end}:null;
      const mapped=periodTime(cell.periodStart,cell.periodEnd,{header:headerTime});
      const day=rowDays.get(cell.day)||cell.day;
      const context={day,date:dates?.get(weekdayIds[day])||null,start:mapped.start,end:mapped.end,needsReview:mapped.needsReview||!rowDays.has(cell.day),ocrConfidence:recognized.tokens.length?recognized.tokens.reduce((sum,item)=>sum+item.confidence,0)/recognized.tokens.length/100:0};
      const parsed=recognized.text.trim()?parseCellText(recognized.text,context):{...parseCellText('',{...context,needsReview:true}),course:'未识别课程（需复核）',needsReview:true};
      rows.push(parsed);
    }
    return {rows,header,title};
  } finally {await worker.terminate();}
}

async function ocr(canvas,onProgress) {
  const worker=await makeWorker(onProgress);
  try {
    const result=extractOcr((await worker.recognize(canvas,{}, {text:true,blocks:true})).data);
    if(rowsFromPage(result).length) return result;
    const courses=result.tokens.filter(token=>/\b[A-Z]{2,}\d{3,}/i.test(token.text));
    if(!courses.length) return result;
    const firstY=Math.min(...courses.map(token=>token.y)),lastY=Math.max(...courses.map(token=>token.y+token.height));
    const firstX=Math.min(...courses.map(token=>token.x));
    const headerTop=Math.floor(firstY*.48),headerLeft=Math.floor(firstX*.75),daysTop=Math.floor(firstY*.75);
    const titleLeft=Math.floor(canvas.width*.18),titleTop=Math.floor(firstY*.08);
    const regions=[
      {left:titleLeft,top:titleTop,width:Math.floor(canvas.width*.72),height:Math.ceil(firstY*.3)},
      {left:headerLeft,top:headerTop,width:canvas.width-headerLeft,height:Math.ceil(firstY*.36)},
      {left:0,top:daysTop,width:Math.ceil(firstX*.95),height:Math.min(canvas.height-daysTop,Math.ceil(lastY*1.15-daysTop))}
    ].filter(region=>region.width>0&&region.height>0);
    onProgress?.(t('importerRecognizeHeader'));
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
    for(const rectangle of regions) {
      const part=extractOcr((await worker.recognize(canvas,{rectangle},{text:true,blocks:true})).data,1,{x:rectangle.left,y:rectangle.top});
      result.text+=`\n${part.text}`;result.tokens.push(...part.tokens);
    }
    return result;
  } finally {await worker.terminate();}
}

export async function decodeQrFile(file) {
  if(!file?.type.startsWith('image/')) throw Error(t('importerQrImage'));
  const canvas=await imageCanvas(file),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const data=ctx.getImageData(0,0,canvas.width,canvas.height);
  const url=decodeQrPixelsInRegions(data.data,canvas.width,canvas.height,qrScanRegions(canvas.width,canvas.height));
  if(!url) throw Error(t('importerQrUnread'));
  return url;
}

export async function importTimetable(file,onProgress) {
  if(!file || file.size>20*1024*1024) throw Error(t('importerFileLimit'));
  let rows=[];
  if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
    if(pdf.numPages>20) throw Error(t('importerPdfPages'));
    for(let number=1;number<=pdf.numPages;number++) {
      onProgress?.(t('importerReadingPage',{page:number,pages:pdf.numPages}));
      const page=await pdf.getPage(number),content=await page.getTextContent();
      const tokens=content.items.filter(i=>i.str?.trim()).map(i=>({text:i.str,x:i.transform[4],y:page.view[3]-i.transform[5],width:i.width,height:i.height||12}));
      const lines=new Map();
      for(const t of tokens) {const key=Math.round(t.y/8)*8;lines.set(key,[...(lines.get(key)||[]),t]);}
      const text=[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(([,items])=>items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
      let found=rowsFromPage({text,tokens});
      if(!found.length) {
        onProgress?.(t('importerOcrPage',{page:number}));
        const viewport=page.getViewport({scale:2}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        found=rowsFromPage(await ocr(canvas,onProgress));
      }
      rows=mergeSessions(rows,found);
    }
  } else if(file.type==='image/jpeg' || file.type==='image/png' || /\.(?:jpe?g|png)$/i.test(file.name)) {
    onProgress?.(t('importerOcrImage'));
    const original=await imageCanvas(file),gridResult=await recognizeImageGrid(original,onProgress);
    if(gridResult.gridFailure) {
      onProgress?.(t('importerGridFallback',{reason:gridResult.gridFailure}));
      rows=rowsFromPage(await ocr(enhancedCanvas(original,3),onProgress));
      if(!rows.length) rows=rowsFromPage(await ocr(original,onProgress));
      if(rows.length) rows=rows.map(row=>({...row,needsReview:true,confidence:{legacy:0.45},gridFailure:gridResult.gridFailure}));
    } else rows=gridResult.rows;
    if(!rows.length) throw Error('已检测到课表网格，但没有识别出课程内容。请调整图片或手动添加课程。');
  } else throw Error(t('importerUnsupported'));
  return rows;
}
