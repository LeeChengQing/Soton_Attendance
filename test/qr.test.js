import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import {decodeQrPixels,decodeQrPixelsInRegions,qrScanRegions} from '../src/qr.js';

test('decodes an uploaded QR image into a Microsoft Forms link', () => {
  const qr=QRCode.create('https://forms.office.com/r/AbC123',{errorCorrectionLevel:'M'});
  const scale=5, quiet=4, width=(qr.modules.size+quiet*2)*scale;
  const pixels=new Uint8ClampedArray(width*width*4).fill(255);
  for(let y=0;y<qr.modules.size;y++) for(let x=0;x<qr.modules.size;x++) if(qr.modules.get(x,y)) for(let dy=0;dy<scale;dy++) for(let dx=0;dx<scale;dx++) {
    const at=(((y+quiet)*scale+dy)*width+(x+quiet)*scale+dx)*4;
    pixels[at]=pixels[at+1]=pixels[at+2]=0;
  }
  assert.equal(decodeQrPixels(pixels,width,width),'https://forms.office.com/r/AbC123');
});

test('scans QR candidates inside a large photo instead of only the full frame', () => {
  const qr=QRCode.create('https://forms.office.com/r/Photo123',{errorCorrectionLevel:'M'});
  const scale=5,quiet=4,qrSize=(qr.modules.size+quiet*2)*scale,width=1800,height=2400,left=580,top=920;
  const pixels=new Uint8ClampedArray(width*height*4).fill(255);
  for(let y=0;y<qr.modules.size;y++) for(let x=0;x<qr.modules.size;x++) if(qr.modules.get(x,y)) for(let dy=0;dy<scale;dy++) for(let dx=0;dx<scale;dx++) {
    const at=(((y+quiet)*scale+top+dy)*width+(x+quiet)*scale+left+dx)*4;
    pixels[at]=pixels[at+1]=pixels[at+2]=0;
  }
  const regions=qrScanRegions(width,height);
  assert.equal(decodeQrPixelsInRegions(pixels,width,height,regions),'https://forms.office.com/r/Photo123');
});
