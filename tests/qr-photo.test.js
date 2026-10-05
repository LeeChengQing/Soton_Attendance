import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {decodeQrPixelsInRegions,qrScanRegions} from '../src/qr.js';
import {readFile} from 'node:fs/promises';

const samplePaths=String(process.env.ATTENDANCE_QR_SAMPLES||'').split(';').map(path=>path.trim()).filter(Boolean);

test('decodes supplied phone-photo QR samples with projection, glare and camera framing', {skip:samplePaths.length===0}, async()=>{
  assert.ok(samplePaths.length>=1);
  for(const path of samplePaths) {
    const image=await loadImage(await readFile(path));
    const canvas=createCanvas(image.width,image.height),context=canvas.getContext('2d');
    context.drawImage(image,0,0);
    const frame=context.getImageData(0,0,image.width,image.height);
    const decoded=decodeQrPixelsInRegions(frame.data,image.width,image.height,qrScanRegions(image.width,image.height));
    assert.match(decoded||'',/^https:\/\/(?:forms\.office\.com|forms\.cloud\.microsoft)\//,`二维码未识别：${path}`);
  }
});
