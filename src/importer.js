import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {createWorker,PSM} from 'tesseract.js';
import {decodeQrPixelsInRegions,qrScanRegions} from './qr.js';
import {rowsFromPage} from './recognition.js';
import {weekDates} from './recognition.js';
import {detectTimetableGrid} from './timetable-grid.js';
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
  const image=context.getImageData(0,0,canvas.width,canvas.height),gray=new Uint8Array(canvas.width*canvas.height);
  for(let i=0;i<gray.length;i++) {const at=i*4;gray[i]=Math.round(.299*image.data[at]+.587*image.data[at+1]+.114*image.data[at+2]);}
  const radius=Math.max(8,Math.round(12*scale)),stride=canvas.width+1,integral=new Uint32Array((canvas.width+1)*(canvas.height+1));
  for(let y=1;y<=canvas.height;y++) {let row=0;for(let x=1;x<=canvas.width;x++) {row+=gray[(y-1)*canvas.width+x-1];integral[y*stride+x]=integral[(y-1)*stride+x]+row;}}
  for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
    const x0=Math.max(0,x-radius),x1=Math.min(canvas.width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(canvas.height,y+radius+1);
    const sum=integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0],mean=sum/((x1-x0)*(y1-y0));
    const value=gray[y*canvas.width+x]<(mean-8)?0:255,at=(y*canvas.width+x)*4;
    image.data[at]=image.data[at+1]=image.data[at+2]=value;image.data[at+3]=255;
  }
  context.putImageData(image,0,0);return canvas;
}

async function makeWorker(onProgress) {
  return createWorker('eng',1,{workerPath:asset('worker.min.js'),corePath:asset('tesseract-core'),langPath:asset('lang'),workerBlobURL:false,cacheMethod:'none',logger:m=>onProgress?.(`${m.status} ${Math.round((m.progress||0)*100)}%`)});
}

function extractOcr(data,scale=1) {
  const tokens=[];
  for(const block of data.blocks||[]) for(const para of block.paragraphs||[]) for(const line of para.lines||[]) for(const word of line.words||[]) {
    const b=word.bbox;tokens.push({text:word.text,x:b.x0/scale,y:b.y0/scale,width:(b.x1-b.x0)/scale,height:(b.y1-b.y0)/scale,confidence:word.confidence});
  }
  return {text:data.text||'',tokens};
}

async function recognizeImageGrid(source,onProgress) {
  const ctx=source.getContext('2d',{willReadFrequently:true}),grid=detectTimetableGrid(ctx.getImageData(0,0,source.width,source.height));
  if(!grid.ok) {onProgress?.(`表格网格检测失败，回退到整图 OCR：${grid.reason}`);return null;}
  const worker=await makeWorker(onProgress),headerCanvas=enhancedCanvas(source,3);
  try {
    const header=extractOcr((await worker.recognize(headerCanvas,{}, {text:true,blocks:true})).data,3),dates=weekDates(header.text),weekdayIds={Mo:1,Tu:2,We:3,Th:4,Fr:5},rows=[];
    const headerRanges=header.tokens.flatMap(token=>{const found=[...token.text.matchAll(/(\d{1,2}:[0-5]\d)\s*[-–—]\s*(\d{1,2}:[0-5]\d)/g)];return found.map(match=>({x:token.x+token.width/2,start:match[1],end:match[2]}));});
    const clockTokens=header.tokens.filter(token=>/^\d{1,2}:[0-5]\d$/.test(token.text.trim())).sort((a,b)=>a.y-b.y||a.x-b.x);
    for(const start of clockTokens) {const end=clockTokens.find(item=>item.x>start.x+start.width&&Math.abs(item.y-start.y)<Math.max(item.height,start.height)*1.5);if(end) headerRanges.push({x:(start.x+end.x+end.width)/2,start:start.text.trim(),end:end.text.trim()});}
    for(const cell of grid.cells) for(const segment of cell.groupSegments) {
      const padding=Math.max(1,Math.round(Math.min(source.width,source.height)*.002)),left=Math.ceil(cell.left+padding),top=Math.ceil(segment.top+padding),right=Math.floor(cell.right-padding),bottom=Math.floor(segment.bottom-padding);
      if(right-left<4||bottom-top<4) continue;
      const crop=document.createElement('canvas');crop.width=(right-left)*3;crop.height=(bottom-top)*3;
      const cropCtx=crop.getContext('2d',{willReadFrequently:true});cropCtx.fillStyle='#fff';cropCtx.fillRect(0,0,crop.width,crop.height);cropCtx.drawImage(source,left,top,right-left,bottom-top,0,0,crop.width,crop.height);
      cropCtx.fillStyle='#fff';cropCtx.fillRect(0,0,crop.width,3);cropCtx.fillRect(0,crop.height-3,crop.width,3);cropCtx.fillRect(0,0,3,crop.height);cropCtx.fillRect(crop.width-3,0,3,crop.height);
      const recognized=extractOcr((await worker.recognize(crop,{}, {text:true,blocks:true})).data);
      if(!recognized.text.trim()) continue;
      const periodCenter=(grid.periodColumns[cell.periodStart-1].center+grid.periodColumns[cell.periodEnd-1].center)/2;
      const headerTime=headerRanges.toSorted((a,b)=>Math.abs(a.x-periodCenter)-Math.abs(b.x-periodCenter))[0];
      const mapped=periodTime(cell.periodStart,cell.periodEnd,{header:headerTime});
      const parsed=parseCellText(recognized.text,{day:cell.day,date:dates?.get(weekdayIds[cell.day])||null,start:mapped.start,end:mapped.end,needsReview:mapped.needsReview,ocrConfidence:recognized.tokens.length?recognized.tokens.reduce((sum,item)=>sum+item.confidence,0)/recognized.tokens.length/100:0});
      rows.push(parsed);
    }
    return {rows,header};
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

async function ocr(canvas,onProgress) {
  const worker=await createWorker('eng',1,{
    workerPath:asset('worker.min.js'),corePath:asset('tesseract-core'),langPath:asset('lang'),
    workerBlobURL:false,cacheMethod:'none',logger:m=>onProgress?.(`${m.status} ${Math.round((m.progress||0)*100)}%`)
  });
  try {
    const extract=data=>{
      const tokens=[];
      for(const block of data.blocks||[]) for(const para of block.paragraphs||[]) for(const line of para.lines||[]) for(const word of line.words||[]) {
        const b=word.bbox;
        tokens.push({text:word.text,x:b.x0,y:b.y0,width:b.x1-b.x0,height:b.y1-b.y0});
      }
      return {text:data.text||'',tokens};
    };
    const result=extract((await worker.recognize(canvas,{}, {text:true,blocks:true})).data);
    if(rowsFromPage(result).length) return result;
    const courses=result.tokens.filter(t=>/\b[A-Z]{2,}\d{3,}/i.test(t.text));
    if(!courses.length) return result;
    const firstY=Math.min(...courses.map(t=>t.y)),lastY=Math.max(...courses.map(t=>t.y+t.height));
    const firstX=Math.min(...courses.map(t=>t.x));
    const headerTop=Math.floor(firstY*.48),headerLeft=Math.floor(firstX*.75),daysTop=Math.floor(firstY*.75);
    const titleLeft=Math.floor(canvas.width*.18),titleTop=Math.floor(firstY*.08);
    const regions=[
      {left:titleLeft,top:titleTop,width:Math.floor(canvas.width*.72),height:Math.ceil(firstY*.3)},
      {left:headerLeft,top:headerTop,width:canvas.width-headerLeft,height:Math.ceil(firstY*.36)},
      {left:0,top:daysTop,width:Math.ceil(firstX*.95),height:Math.min(canvas.height-daysTop,Math.ceil(lastY*1.15-daysTop))}
    ];
    onProgress?.(t('importerRecognizeHeader'));
    await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_BLOCK});
    for(const rectangle of regions) {
      const part=extract((await worker.recognize(canvas,{rectangle},{text:true,blocks:true})).data);
      result.text+=`\n${part.text}`;
      result.tokens.push(...part.tokens);
    }
    return result;
  } finally {await worker.terminate();}
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
    if(gridResult) rows=gridResult.rows;
    if(!rows.length) {
      const prepared=enhancedCanvas(original,3);
      rows=rowsFromPage(await ocr(prepared,onProgress));
      if(!rows.length) rows=rowsFromPage(await ocr(original,onProgress));
      if(rows.length) rows=rows.map(row=>({...row,needsReview:true,confidence:{legacy:0.45},gridFailure:'网格逐格识别未完成；结果来自整图回退解析'}));
    }
  } else throw Error(t('importerUnsupported'));
  return rows;
}
