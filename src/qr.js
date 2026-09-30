import jsQR from 'jsqr';

export function decodeQrPixels(pixels,width,height) {
  return jsQR(pixels,width,height,{inversionAttempts:'attemptBoth'})?.data||null;
}

export function qrScanRegions(width,height) {
  const regions=[{left:0,top:0,width,height}];
  const add=(left,top,regionWidth,regionHeight)=>{
    const clamped={
      left:Math.max(0,Math.min(width-1,Math.round(left))),
      top:Math.max(0,Math.min(height-1,Math.round(top))),
      width:Math.max(1,Math.min(width,Math.round(regionWidth))),
      height:Math.max(1,Math.min(height,Math.round(regionHeight)))
    };
    clamped.width=Math.min(clamped.width,width-clamped.left);
    clamped.height=Math.min(clamped.height,height-clamped.top);
    const key=`${clamped.left}:${clamped.top}:${clamped.width}:${clamped.height}`;
    if(!regions.some(region=>`${region.left}:${region.top}:${region.width}:${region.height}`===key)) regions.push(clamped);
  };
  // Phone photos usually contain a projected QR card in the middle of a tall frame.
  // These tighter windows avoid monitor borders, browser chrome and audience heads
  // that can prevent jsQR from finding the three finder patterns.
  if(height>width) {
    const windowWidth=width*.696,windowHeight=height*.352;
    for(const left of [.08,.153,.22]) for(const top of [.18,.2544,.32,.40]) {
      add(width*left,height*top,windowWidth,windowHeight);
    }
  }
  const addGrid=(fraction)=>{
    const regionWidth=Math.max(1,Math.ceil(width*fraction)),regionHeight=Math.max(1,Math.ceil(height*fraction));
    const xs=[0,Math.max(0,Math.floor((width-regionWidth)/2)),Math.max(0,width-regionWidth)];
    const ys=[0,Math.max(0,Math.floor((height-regionHeight)/2)),Math.max(0,height-regionHeight)];
    for(const top of ys) for(const left of xs) {
      add(left,top,regionWidth,regionHeight);
    }
  };
  addGrid(.72);addGrid(.62);
  return regions;
}

function cropPixels(pixels,width,height,region,maxDimension=2200) {
  const left=Math.max(0,Math.min(width-1,Math.floor(region.left))),top=Math.max(0,Math.min(height-1,Math.floor(region.top)));
  const sourceWidth=Math.max(1,Math.min(width-left,Math.floor(region.width))),sourceHeight=Math.max(1,Math.min(height-top,Math.floor(region.height)));
  const scale=Math.min(1,maxDimension/Math.max(sourceWidth,sourceHeight));
  const outputWidth=Math.max(1,Math.round(sourceWidth*scale)),outputHeight=Math.max(1,Math.round(sourceHeight*scale));
  const output=new Uint8ClampedArray(outputWidth*outputHeight*4);
  for(let y=0;y<outputHeight;y++) {
    const sourceY=top+Math.min(sourceHeight-1,Math.floor(y/scale));
    for(let x=0;x<outputWidth;x++) {
      const sourceX=left+Math.min(sourceWidth-1,Math.floor(x/scale));
      const source=(sourceY*width+sourceX)*4,target=(y*outputWidth+x)*4;
      output[target]=pixels[source];output[target+1]=pixels[source+1];output[target+2]=pixels[source+2];output[target+3]=pixels[source+3];
    }
  }
  return {pixels:output,width:outputWidth,height:outputHeight};
}

export function decodeQrPixelsInRegions(pixels,width,height,regions=qrScanRegions(width,height)) {
  for(const region of regions) {
    const candidate=cropPixels(pixels,width,height,region);
    const decoded=decodeQrPixels(candidate.pixels,candidate.width,candidate.height);
    if(decoded) return decoded;
  }
  return null;
}
