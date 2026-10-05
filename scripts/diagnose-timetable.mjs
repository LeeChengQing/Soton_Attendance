#!/usr/bin/env node
// Standalone, read-only timetable OCR diagnostic. Not imported by the extension build.
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, PSM } from 'tesseract.js';
import { PNG } from 'pngjs';
import { rowsFromPage } from '../src/recognition.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: node scripts/diagnose-timetable.mjs <image.png>');
  process.exitCode = 2;
} else {
  const absoluteImagePath = resolve(imagePath);
  const image = await readFile(absoluteImagePath);
  const { width, height } = PNG.sync.read(image);
  const languagePath = resolve(repo, 'node_modules/@tesseract.js-data/eng/4.0.0_best_int');
  const worker = await createWorker('eng', 1, {
    langPath: languagePath,
    gzip: true,
    cacheMethod: 'none',
    logger: message => {
      if (process.env.DIAGNOSE_OCR_PROGRESS === '1') {
        console.error(`${message.status} ${Math.round((message.progress || 0) * 100)}%`);
      }
    },
  });

  const extract = data => {
    const tokens = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          for (const word of line.words || []) {
            const box = word.bbox;
            tokens.push({
              text: word.text,
              x: box.x0,
              y: box.y0,
              width: box.x1 - box.x0,
              height: box.y1 - box.y0,
              confidence: word.confidence,
            });
          }
        }
      }
    }
    return { text: data.text || '', tokens };
  };
const parserTokens = tokens => tokens.map(({ text, x, y, width, height }) => ({ text, x, y, width, height }));
const centerX = token => token.x + token.width / 2;
const centerY = token => token.y + token.height / 2;
function inspectASCGrid(tokens) {
  // Diagnostic mirror of src/recognition.js:26-43, kept here so the report
  // identifies the parser gate that stopped this image.
  const courses = tokens.filter(token => /\b[A-Z]{2,}\d{3,}(?:-[A-Z]{2,})?\b/i.test(token.text));
  const dayLabels = tokens.filter(token => /^(mo|tu|we|th|fr|sa|su)$/i.test(token.text.trim()));
  if (!courses.length) return { courseTokenCount: 0, dayTokenCount: dayLabels.length, columns: [], stop: 'no course tokens' };
  if (dayLabels.length < 2) return { courseTokenCount: courses.length, dayTokenCount: dayLabels.length, columns: [], stop: 'fewer than two day tokens' };
  const firstCourseY = Math.min(...courses.map(token => token.y));
  const headerRow = tokens.filter(token => token.y < firstCourseY);
  const rangePattern = /(\d{1,2}):([0-5]\d)\s*[-–—]\s*(\d{1,2}):([0-5]\d)/;
  const completeRanges = headerRow.flatMap(token => {
    const match = token.text.match(rangePattern);
    return match ? [{ token: token.text, x: centerX(token), start: `${match[1]}:${match[2]}`, end: `${match[3]}:${match[4]}` }] : [];
  });
  let columns = [];
  if (completeRanges.length >= 2) {
    columns = completeRanges.sort((a, b) => a.x - b.x);
  } else {
    const pieces = headerRow.filter(token => /^\d{1,2}:[0-5]\d$/.test(token.text.trim())).sort((a, b) => a.y - b.y || a.x - b.x);
    for (const start of pieces) {
      const next = pieces.find(end => end.x > start.x + start.width
        && Math.abs(centerY(end) - centerY(start)) < Math.max(start.height, end.height)
        && !pieces.some(middle => middle.x > start.x + start.width && middle.x < end.x)
        && headerRow.some(dash => /^[-–—]$/.test(dash.text.trim()) && dash.x > start.x + start.width
          && dash.x < end.x && Math.abs(centerY(dash) - centerY(start)) < start.height));
      if (next) columns.push({ x: (start.x + next.x + next.width) / 2, start: start.text, end: next.text });
    }
    columns = columns.filter((column, index, list) => list.findIndex(other =>
      Math.abs(other.x - column.x) < Math.max(3, (other.x || 0) * 0.002)) === index).sort((a, b) => a.x - b.x);
  }
  return {
    courseTokenCount: courses.length,
    dayTokenCount: dayLabels.length,
    firstCourseY,
    exactRangeTokens: completeRanges,
    exactClockPieces: headerRow.filter(token => /^\d{1,2}:[0-5]\d$/.test(token.text.trim())).map(token => ({ text: token.text, x: token.x, y: token.y, width: token.width, height: token.height })),
    columns,
    stop: columns.length < 2 ? `only ${columns.length} time columns; parser returns []` : 'time grid passed',
  };
}
const fullRecognitions = [];
let parsed;
let phase = 'full-image OCR';
let finalParserInput;
  try {
    const full = extract((await worker.recognize(absoluteImagePath, {}, { text: true, blocks: true })).data);
    fullRecognitions.push({ phase: 'full-image', ...full });
    finalParserInput = { text: full.text, tokens: full.tokens };
    parsed = rowsFromPage({ text: full.text, tokens: parserTokens(full.tokens) });

    // Match src/importer.js: retry title/header/day strips only if the full-page
    // OCR has no parsed lessons and course-like tokens exist.
    if (!parsed.length) {
      const courses = full.tokens.filter(token => /\b[A-Z]{2,}\d{3,}/i.test(token.text));
      if (courses.length) {
        const firstY = Math.min(...courses.map(token => token.y));
        const lastY = Math.max(...courses.map(token => token.y + token.height));
        const firstX = Math.min(...courses.map(token => token.x));
        const regions = [
          {
            name: 'title',
            left: Math.floor(width * 0.18),
            top: Math.floor(firstY * 0.08),
            width: Math.floor(width * 0.72),
            height: Math.ceil(firstY * 0.3),
          },
          {
            name: 'time-header',
            left: Math.floor(firstX * 0.75),
            top: Math.floor(firstY * 0.48),
            width: width - Math.floor(firstX * 0.75),
            height: Math.ceil(firstY * 0.36),
          },
          {
            name: 'day-labels',
            left: 0,
            top: Math.floor(firstY * 0.75),
            width: Math.ceil(firstX * 0.95),
            height: Math.min(height - Math.floor(firstY * 0.75), Math.ceil(lastY * 1.15 - Math.floor(firstY * 0.75))),
          },
        ];
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
        const regionRecognitions = [];
        for (const region of regions) {
          const { name, ...rectangle } = region;
          const result = extract((await worker.recognize(absoluteImagePath, { rectangle }, { text: true, blocks: true })).data);
          regionRecognitions.push({ phase: name, rectangle, ...result });
        }
        fullRecognitions.push(...regionRecognitions);
        const combined = {
          text: fullRecognitions.map(result => result.text).join('\n'),
          tokens: fullRecognitions.flatMap(result => result.tokens),
        };
        finalParserInput = combined;
        parsed = rowsFromPage({ text: combined.text, tokens: parserTokens(combined.tokens) });
        const grid = inspectASCGrid(parserTokens(combined.tokens));
        phase = parsed.length ? 'region retry parsed lessons'
          : `region retry returned no lessons; aSc grid parser stopped: ${grid.stop}`;
      } else {
        phase = 'full-image OCR produced no course-like token; stopped before region retry';
      }
    } else {
      phase = 'full-image OCR parsed lessons; no region retry needed';
    }
  } finally {
    await worker.terminate();
  }

  const allTokens = fullRecognitions.flatMap(result => result.tokens);
  const distinctCourseLikeTokens = [...new Set(allTokens.filter(token => /\b[A-Z]{2,}\d{3,}/i.test(token.text)).map(token => token.text))];
  const dayTokens = allTokens.filter(token => /^(mo|tu|we|th|fr|sa|su)$/i.test(token.text.trim()));
  const timeLikeTokens = allTokens.filter(token => /\d{1,2}:[0-5]\d|^[-–—]$/.test(token.text.trim()));
  const json = {
    image: { path: absoluteImagePath, width, height, bytes: image.length },
    ocr: {
      engine: 'tesseract.js ' + (await import('tesseract.js/package.json', { with: { type: 'json' } })).default.version,
      language: 'eng',
      traineddata: 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
      preprocessing: 'none; matches extension imageCanvas draw at native size',
      phases: fullRecognitions.map(result => ({
        name: result.phase,
        ...(result.rectangle ? { rectangle: result.rectangle } : {}),
        rawText: result.text,
        boxes: result.tokens.map(({ text, x, y, width: boxWidth, height: boxHeight, confidence }) => ({
          text, x, y, width: boxWidth, height: boxHeight, confidence,
        })),
      })),
    },
    parserDiagnostics: {
      courseLikeTokens: distinctCourseLikeTokens,
      recognizedDayAbbreviations: [...new Set(dayTokens.map(token => token.text.trim()))],
      timeLikeTokenCount: timeLikeTokens.length,
      splitCodeSuffixPairs: allTokens.filter(token => /^-[A-Z]{3}$/i.test(token.text.trim())).map(suffix => {
        const base = allTokens.find(token => /\b[A-Z]{2,}\d{3,}$/i.test(token.text.trim())
          && Math.abs((token.x + token.width / 2) - (suffix.x + suffix.width / 2)) < Math.max(token.width / 3, token.height)
          && suffix.y >= token.y && suffix.y - token.y < token.height * 2.5);
        return { code: base?.text || null, suffix: suffix.text, matchedByCurrentRule: Boolean(base) };
      }),
      weekRangePatternMatch: /\d{1,2}[/.]\d{1,2}\s*[-–—]\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(
        fullRecognitions.map(result => result.text).join('\n'),
      ),
      ascGrid: inspectASCGrid(parserTokens(finalParserInput?.tokens || [])),
    },
    result: { failureStage: phase, courses: parsed || [] },
  };
  console.log(JSON.stringify(json, null, 2));
}
