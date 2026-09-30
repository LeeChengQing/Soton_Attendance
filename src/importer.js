import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/build/pdf.mjs';
import {createWorker,PSM} from 'tesseract.js';
import {decodeQrPixelsInRegions,qrScanRegions} from './qr.js';
import {rowsFromPage} from './recognition.js';
import {mergeSessions} from './schedule.js';

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

export async function decodeQrFile(file) {
  if(!file?.type.startsWith('image/')) throw Error('请上传二维码图片（PNG 或 JPG）。');
  const canvas=await imageCanvas(file),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const data=ctx.getImageData(0,0,canvas.width,canvas.height);
  const url=decodeQrPixelsInRegions(data.data,canvas.width,canvas.height,qrScanRegions(canvas.width,canvas.height));
  if(!url) throw Error('未能从图片中识别二维码，请换清晰截图或粘贴链接。');
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
    onProgress?.('正在识别课表的日期、时间和星期');
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
  if(!file || file.size>20*1024*1024) throw Error('请选择不超过 20 MB 的 JPG、PNG 或 PDF。');
  let rows=[];
  if(file.type==='application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdf=await getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false}).promise;
    if(pdf.numPages>20) throw Error('PDF 最多支持 20 页。');
    for(let number=1;number<=pdf.numPages;number++) {
      onProgress?.(`正在读取 PDF 第 ${number}/${pdf.numPages} 页`);
      const page=await pdf.getPage(number),content=await page.getTextContent();
      const tokens=content.items.filter(i=>i.str?.trim()).map(i=>({text:i.str,x:i.transform[4],y:page.view[3]-i.transform[5],width:i.width,height:i.height||12}));
      const lines=new Map();
      for(const t of tokens) {const key=Math.round(t.y/8)*8;lines.set(key,[...(lines.get(key)||[]),t]);}
      const text=[...lines.entries()].sort((a,b)=>a[0]-b[0]).map(([,items])=>items.sort((a,b)=>a.x-b.x).map(x=>x.text).join(' ')).join('\n');
      let found=rowsFromPage({text,tokens});
      if(!found.length) {
        onProgress?.(`第 ${number} 页需要本机 OCR 识别`);
        const viewport=page.getViewport({scale:2}),canvas=document.createElement('canvas');
        canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        found=rowsFromPage(await ocr(canvas,onProgress));
      }
      rows=mergeSessions(rows,found);
    }
  } else if(file.type==='image/jpeg' || file.type==='image/png' || /\.(?:jpe?g|png)$/i.test(file.name)) {
    onProgress?.('正在本机 OCR 识别图片');
    rows=rowsFromPage(await ocr(await imageCanvas(file),onProgress));
  } else throw Error('课表只支持 JPG/JPEG、PNG 或 PDF。');
  return rows;
}
