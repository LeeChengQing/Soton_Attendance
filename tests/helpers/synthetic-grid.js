export function syntheticGrid({ days = 5, periods = 11, scale = 1, skew = 0, merge = [], groupSplit = [] } = {}) {
  const margin=12*scale,dayWidth=70*scale,periodWidth=32*scale,headerHeight=38*scale,rowHeight=48*scale;
  const width=margin*2+dayWidth+periodWidth*periods,height=margin*2+headerHeight+rowHeight*days;
  const data=new Uint8ClampedArray(width*height*4);
  for(let i=0;i<width*height;i++) data.set([255,255,255,255],i*4);
  const dark=(x,y)=>{x=Math.round(x);y=Math.round(y);if(x<0||y<0||x>=width||y>=height)return;const at=(y*width+x)*4;data[at]=data[at+1]=data[at+2]=24;};
  const horizontal=(y,left,right)=>{for(let x=left;x<=right;x++)dark(x,y+skew*(x-left)/(right-left));};
  const vertical=(x,top,bottom)=>{for(let y=top;y<=bottom;y++)dark(x+skew*(y-top)/(bottom-top),y);};
  const tableLeft=margin,tableRight=margin+dayWidth+periodWidth*periods,top=margin,headerBottom=top+headerHeight;
  horizontal(top,tableLeft,tableRight);horizontal(headerBottom,tableLeft,tableRight);
  for(let row=1;row<=days;row++) horizontal(headerBottom+row*rowHeight,tableLeft,tableRight);
  vertical(tableLeft,top,headerBottom+days*rowHeight);vertical(margin+dayWidth,top,headerBottom+days*rowHeight);
  for(let period=1;period<=periods;period++) vertical(margin+dayWidth+period*periodWidth,top,headerBottom);
  for(let day=0;day<days;day++) {
    const rowTop=headerBottom+day*rowHeight,rowBottom=rowTop+rowHeight;
    const splits=groupSplit.filter(item=>item.day===day);
    for(let boundary=1;boundary<periods;boundary++) {
      const x=margin+dayWidth+boundary*periodWidth;
      const isMerged=merge.some(item=>item.day===day&&boundary>=item.start&&boundary<item.end);
      if(!isMerged) vertical(x,rowTop,rowBottom);
    }
    for(const item of splits) horizontal((rowTop+rowBottom)/2,margin+dayWidth+(item.start-1)*periodWidth,margin+dayWidth+item.end*periodWidth);
  }
  return {width,height,data};
}
