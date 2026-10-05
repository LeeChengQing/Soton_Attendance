import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import {chromium} from 'playwright';
import {build} from 'esbuild';
import {detectTimetableGrid} from '../src/timetable-grid.js';
import {syntheticGrid} from './helpers/synthetic-grid.js';

test('detects five weekday rows and eleven period columns from pixel lines',()=>{
  const result=detectTimetableGrid(syntheticGrid());
  assert.equal(result.ok,true);
  assert.deepEqual(result.dayRows.map(row=>row.day),['Mo','Tu','We','Th','Fr']);
  assert.equal(result.periodColumns.length,11);
  assert.deepEqual([result.periodColumns[0].period,result.periodColumns.at(-1).period],[1,11]);
});

test('finds merged two-period cells and split Group subrows',()=>{
  const result=detectTimetableGrid(syntheticGrid({merge:[{day:2,start:3,end:4}],groupSplit:[{day:2,start:3,end:4}]}));
  assert.equal(result.ok,true);
  const cell=result.cells.find(item=>item.day==='We'&&item.periodStart===3);
  assert.deepEqual([cell.periodStart,cell.periodEnd],[3,4]);
  assert.equal(cell.groupSegments.length,2);
});

test('tolerates a second resolution and slight table-line skew',()=>{
  const result=detectTimetableGrid(syntheticGrid({scale:2,skew:2}));
  assert.equal(result.ok,true);
  assert.equal(result.periodColumns.length,11);
  assert.equal(result.dayRows.length,5);
});

test('rejects an unexpected weekday-row count instead of returning guessed cells',()=>{
  const result=detectTimetableGrid(syntheticGrid({days:4}));
  assert.equal(result.ok,false);
  assert.equal(result.code,'GRID_DETECTION_FAILED');
  assert.match(result.reason,/weekday rows/i);
});

test('rejects a timetable with an unexpected period-column count',()=>{
  const result=detectTimetableGrid(syntheticGrid({periods:9}));
  assert.equal(result.ok,false);
  assert.equal(result.code,'GRID_DETECTION_FAILED');
  assert.match(result.reason,/period columns/i);
});

test('detects grid lines in generated PNGs with scale, compression-like rasterization and low contrast',()=>{
  for(const file of ['standard.png','merged-groups.png','large.png','skew-low-contrast.png']) {
    const pixels=PNG.sync.read(readFileSync(new URL(`./fixtures/timetable-synthetic/${file}`,import.meta.url)));
    const result=detectTimetableGrid(pixels);
    assert.equal(result.ok,true,`${file}: ${result.reason}`);
    assert.equal(result.dayRows.length,5);
    assert.equal(result.periodColumns.length,11);
  }
});

test('detects grid lines after JPEG compression',async()=>{
  const jpeg=readFileSync(new URL('./fixtures/timetable-synthetic/compressed.jpg',import.meta.url)).toString('base64');
  const bundle=(await build({entryPoints:['src/timetable-grid.js'],bundle:true,format:'iife',globalName:'GridCheck',write:false})).outputFiles[0].text;
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const result=await page.evaluate(async({jpeg,bundle})=>{
      (0,eval)(bundle);
      const image=new Image();image.src=`data:image/jpeg;base64,${jpeg}`;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
      return window.GridCheck.detectTimetableGrid(context.getImageData(0,0,canvas.width,canvas.height));
    },{jpeg,bundle});
    assert.equal(result.ok,true,result.reason);
    assert.equal(result.periodColumns.length,11);
  } finally {await browser.close();}
});
