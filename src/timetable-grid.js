const DAY_NAMES=['Mo','Tu','We','Th','Fr'];

function darkAt(image,x,y,radius=2) {
  for(let dy=-radius;dy<=radius;dy++) for(let dx=-radius;dx<=radius;dx++) {
    const px=x+dx,py=y+dy;
    if(px>=0&&py>=0&&px<image.width&&py<image.height&&image.mask[py*image.width+px]) return true;
  }
  return false;
}

function adaptiveMask(image) {
  const {width,height,data}=image,size=width*height,gray=new Uint8Array(size),integral=new Uint32Array((width+1)*(height+1)),stride=width+1;
  for(let i=0;i<size;i++) {const at=i*4;gray[i]=Math.round(.299*data[at]+.587*data[at+1]+.114*data[at+2]);}
  for(let y=1;y<=height;y++) {let row=0;for(let x=1;x<=width;x++) {row+=gray[(y-1)*width+x-1];integral[y*stride+x]=integral[(y-1)*stride+x]+row;}}
  const radius=Math.max(3,Math.round(Math.min(width,height)*.006)),mask=new Uint8Array(size);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const x0=Math.max(0,x-radius),x1=Math.min(width,x+radius+1),y0=Math.max(0,y-radius),y1=Math.min(height,y+radius+1);
    const sum=integral[y1*stride+x1]-integral[y0*stride+x1]-integral[y1*stride+x0]+integral[y0*stride+x0],mean=sum/((x1-x0)*(y1-y0)),value=gray[y*width+x];
    if(value<150||value<mean-18) mask[y*width+x]=1;
  }
  return {width,height,data,mask};
}

function lineRuns(image,axis,{start=0,end=axis==='horizontal'?image.height:image.width,from=0,to=axis==='horizontal'?image.width:image.height,threshold=.72,minLength=5}={}) {
  const coordinateLength=axis==='horizontal'?image.width:image.height;
  const runs=[];let active=null;
  for(let c=start;c<end;c++) {
    let hits=0;
    for(let p=from;p<to;p++) if(axis==='horizontal'?darkAt(image,p,c,Math.max(2,Math.round(Math.min(image.width,image.height)*.008))):darkAt(image,c,p)) hits++;
    const ratio=hits/Math.max(1,to-from);
    if(ratio>=threshold) {if(active===null) active=c;}
    else if(active!==null) {if(c-active>=minLength) runs.push({start:active,end:c-1,center:(active+c-1)/2});active=null;}
  }
  if(active!==null&&end-active>=minLength) runs.push({start:active,end:end-1,center:(active+end-1)/2});
  return runs;
}

const centerOf=run=>run.center;
function fail(reason) {return {ok:false,code:'GRID_DETECTION_FAILED',reason};}

export function detectTimetableGrid(imageData,{expectedPeriods=11,expectedWeekdays=5}={}) {
  if(!imageData?.data||!Number.isInteger(imageData.width)||!Number.isInteger(imageData.height)||imageData.data.length<imageData.width*imageData.height*4) return fail('invalid pixel image');
  imageData=adaptiveMask(imageData);
  const fullHorizontal=lineRuns(imageData,'horizontal',{threshold:.52,minLength:3});
  if(fullHorizontal.length<expectedWeekdays+2) return fail(`could not detect weekday rows (${fullHorizontal.length} long horizontal lines)`);
  let selected=null;
  for(let top=0;top<fullHorizontal.length;top++) for(let bottom=top+expectedWeekdays+1;bottom<fullHorizontal.length;bottom++) {
    const subset=fullHorizontal.slice(top,bottom+1);
    if(subset.length!==expectedWeekdays+2) continue;
    const rowPitch=subset.slice(2).map((line,i)=>centerOf(line)-centerOf(subset[i+1]));
    const median=[...rowPitch].sort((a,b)=>a-b)[Math.floor(rowPitch.length/2)];
    if(median<=0||rowPitch.some(value=>value<median*.62||value>median*1.38)) continue;
    const margin=subset[0].end-subset[0].start+1;
    if(!selected||margin>selected.margin) selected={subset,margin};
  }
  if(!selected) return fail(`could not detect exactly five weekday rows (${fullHorizontal.length} long horizontal lines)`);
  const horizontal=selected.subset;
  const tableTop=centerOf(horizontal[0]),headerBottom=centerOf(horizontal[1]),tableBottom=centerOf(horizontal.at(-1));
  const verticalHeader=lineRuns(imageData,'vertical',{start:0,end:imageData.width,from:Math.round(tableTop),to:Math.round(headerBottom),threshold:.48,minLength:3});
  let xCenters=verticalHeader.map(centerOf).filter((x,i,array)=>!i||x-array[i-1]>2);
  if(xCenters.length>expectedPeriods+2) {
    const left=xCenters[0],right=xCenters.at(-1),pitch=(right-left)*.9/expectedPeriods,dayWidth=right-left-pitch*expectedPeriods;
    const snapped=Array.from({length:expectedPeriods+2},(_,index)=>left+(index===0?0:index===1?dayWidth:dayWidth+(index-1)*pitch));
    const selected=snapped.map(target=>xCenters.reduce((best,value)=>Math.abs(value-target)<Math.abs(best-target)?value:best,xCenters[0]));
    if(selected.every((value,index)=>Math.abs(value-snapped[index])<=pitch*.22)&&new Set(selected).size===selected.length) xCenters=selected;
  }
  if(xCenters.length>expectedPeriods+2) {
    const candidates=[];
    for(let start=0;start<=xCenters.length-(expectedPeriods+2);start++) {
      const values=xCenters.slice(start,start+expectedPeriods+2),gaps=values.slice(1).map((value,index)=>value-values[index]);
      const periods=gaps.slice(1),median=[...periods].sort((a,b)=>a-b)[Math.floor(periods.length/2)];
      if(median<=0||gaps[0]<median*.65||gaps[0]>median*1.5||periods.some(value=>value<median*.65||value>median*1.35)) continue;
      const score=periods.reduce((sum,value)=>sum+Math.abs(value-median),0)/median+Math.abs(gaps[0]/median-1.1)*.15;
      candidates.push({values,score});
    }
    candidates.sort((a,b)=>a.score-b.score);if(candidates.length) xCenters=candidates[0].values;
  }
  if(xCenters.length!==expectedPeriods+2) return fail(`could not detect exactly ${expectedPeriods} period columns (found ${Math.max(0,xCenters.length-1)})`);
  const tableLeft=xCenters[0],tableRight=xCenters.at(-1);
  const dayBoundary=xCenters[1];
  const periodBounds=xCenters.slice(1);
  const periodColumns=Array.from({length:expectedPeriods},(_,index)=>({period:index+1,start:periodBounds[index],end:periodBounds[index+1],center:(periodBounds[index]+periodBounds[index+1])/2}));
  const dayRows=Array.from({length:expectedWeekdays},(_,index)=>({day:DAY_NAMES[index],top:centerOf(horizontal[index+1]),bottom:centerOf(horizontal[index+2]),center:(centerOf(horizontal[index+1])+centerOf(horizontal[index+2]))/2}));
  const cells=[];
  for(const row of dayRows) {
    const rowVertical=lineRuns(imageData,'vertical',{start:Math.round(dayBoundary),end:Math.round(tableRight),from:Math.round(row.top),to:Math.round(row.bottom),threshold:.34,minLength:3});
    const present=rowVertical.map(centerOf).filter((x,i,array)=>!i||x-array[i-1]>2);
    const boundaries=[dayBoundary,...periodBounds.slice(1,-1),tableRight];
    const cellStarts=periodColumns.map(column=>column.start);
    let col=0;
    while(col<expectedPeriods) {
      const first=col;let last=col;
      while(last<expectedPeriods-1&&!present.some(x=>Math.abs(x-periodColumns[last].end)<Math.max(2,imageData.width*.003))) last++;
      const left=periodColumns[first].start,right=periodColumns[last].end;
      const splits=lineRuns(imageData,'horizontal',{start:Math.ceil(row.top+2),end:Math.floor(row.bottom-1),from:Math.ceil(left+2),to:Math.floor(right-1),threshold:.48,minLength:3});
      const groupSegments=[];let segmentTop=row.top;
      for(const split of splits) {if(split.center-segmentTop>3) groupSegments.push({top:segmentTop,bottom:split.center});segmentTop=split.center;}
      if(row.bottom-segmentTop>3) groupSegments.push({top:segmentTop,bottom:row.bottom});
      cells.push({day:row.day,periodStart:first+1,periodEnd:last+1,left,right,top:row.top,bottom:row.bottom,groupSegments});
      col=last+1;
    }
  }
  return {ok:true,table:{left:tableLeft,right:tableRight,top:tableTop,headerBottom,bottom:tableBottom,dayBoundary},dayRows,periodColumns,cells,lines:{horizontal,verticalHeader}};
}
