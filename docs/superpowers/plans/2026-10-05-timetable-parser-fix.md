# Timetable Parser Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse aSc timetable images with pixel-detected grids, configurable period mapping, per-cell OCR, explicit review fields, and a user confirmation gate before any executable task is created.

**Architecture:** Keep the PDF text layer path intact. Add pure pixel geometry and period/date parsing helpers that can be unit-tested without Chrome; let the importer use those helpers for aSc images and fall back to the existing OCR parser only when grid validation explicitly fails. Crop and preprocess cells in the existing browser canvas pipeline, run OCR per cell, preserve raw field evidence and correction metadata, and pass review rows into the existing draft UI. Do not change background scheduling/execution logic.

**Tech Stack:** ES modules, browser Canvas/ImageData, Tesseract.js 7, Node test runner, PNG/JPEG synthetic fixture generation.

**Spec:** `docs/TIMETABLE_PARSING_DIAGNOSIS.md` and the user request in this task.

## Global Constraints

- Do not connect to any database.
- Do not change automatic attendance execution logic.
- Do not run a build command that removes or overwrites `extension/`.
- Preserve all pre-existing uncommitted work.
- Keep real timetable images and expected results only under ignored `tests/local-only/`; skip those tests when the files are absent.
- Synthetic fixtures must use fake courses/rooms/lecturers only.
- Never print keys or credentials.

## Review Focus

- Short/low contrast grid lines and slight skew: synthetic grid detector tests must reject invalid layouts and tolerate bounded jitter.
- Merged periods and vertically stacked groups: fixtures assert inferred span and separate group rows.
- Time header disagrees with period mapping: result carries `needsReview` and never silently changes configured times.
- OCR substitutions, line fragments, and confidence: pure correction tests verify raw/corrected value and confidence penalty.
- Grid detection failure: negative tests verify explicit failure and caller fallback, never a guessed successful schedule.

---

### Task 1: Calendar range parser

**Files:** `src/recognition.js`, `test/recognition.test.js`.

- [ ] Add cases for `5-9/10/26`, `5-9/10/2026`, `5/10-9/10/2026`, month/year boundary, leap day, two-digit years, and full-width separators; specify expected weekday-to-ISO-date map.
- [ ] Run the focused recognition test and confirm the new date cases fail.
- [ ] Extend `weekDates()` while rejecting invalid calendar ranges and ranges longer than seven days.
- [ ] Run the focused test to green.

### Task 2: Pure grid geometry, period map, correction and synthetic source

**Files:** create `src/timetable-grid.js`, `src/timetable-fields.js`, `scripts/generate-timetable-fixtures.mjs`; create `test/timetable-grid.test.js`, `test/timetable-fields.test.js`.

- [ ] Add failing tests for 5 weekday rows, 11 periods, cell boundaries, merged columns, split rows, dimension variance, JPEG/gray fixture decoding, bounded skew, invalid grid, default/configurable period map, clock conflict, split code/suffix, and dictionary correction with raw evidence/confidence penalty.
- [ ] Run focused tests and verify expected RED failures.
- [ ] Implement pixel projections/line-run grouping and conservative geometry validation; define deterministic `GRID_DETECTION_FAILED` for invalid layouts.
- [ ] Implement configurable `period n = 08:00 + n hours` mapping, clock validation, output field values, and safe correction helpers (Levenshtein max 1 for type; specified code/room validation).
- [ ] Generate only synthetic images using TEST1001, R101, Tutor A; variants include standard, merged 2/3 period, empty cells, Group 1/2, sizes, JPEG, slight skew, grayscale/low contrast.
- [ ] Run the focused pure-module tests to green.

### Task 3: Per-cell OCR and importer routing

**Files:** create `src/timetable-ocr.js`; modify `src/importer.js`; create/modify focused importer tests.

- [ ] Add failing image importer tests for original-size fallback, ≥3× grayscale/adaptive threshold path, crop border clearing/upscale, per-cell field parsing, header conflict, and invalid-grid legacy fallback.
- [ ] Verify RED.
- [ ] Implement an aSc image path: detect grid from raw pixels, read table header with OCR as validation, crop each occupied cell/subcell, remove detected border strips, upscale and preprocess, OCR each cell, preserve text/confidence, and return normalized review records.
- [ ] Keep PDF text extraction and PDF OCR fallback unchanged. If image grid detection returns invalid geometry, call existing full-page OCR parser and include an explicit fallback reason.
- [ ] Run focused importer tests to green.

### Task 4: Review rows and user confirmation UI

**Files:** modify `src/options.js`, `src/options.html`, `src/options.css`, `src/options-locale.js`; avoid `src/background.js`.

- [ ] Add UI tests for parsed-field table, editable/delete rows, Group selection, low-confidence highlight, clock conflict review, and no executable task creation until explicit confirmation.
- [ ] Verify RED.
- [ ] Render review metadata beside the existing edit controls; only create sessions from rows after explicit user review/confirmation; require choosing Group for parallel LAB rows and persist only confirmed task fields.
- [ ] Keep pending OCR review separate from enabled/executable `attendanceSessions`; preserve existing task scheduling and background code unchanged.
- [ ] Run focused UI/import-flow tests to green.

### Task 5: Local-only acceptance and safe build verification

**Files:** `.gitignore`, optional ignored `tests/local-only/.gitkeep` only if useful, test fixture loader, non-destructive build verification script.

- [ ] Add ignore rule for `tests/local-only/`; validate with `git check-ignore` for both image and expected JSON paths.
- [ ] Local fixture tests skip cleanly when image/expected JSON are absent; when present, compute field-by-field accuracy across at least 20 expected records, require ≥18 exact rows and `needsReview` on every remaining discrepancy, and fail on unmarked time disagreement.
- [ ] Run the requested unit/integration tests and local-only acceptance if fixture files exist; report every locally reviewed row by review reason without emitting private image contents unnecessarily.
- [ ] Run a staging/safe build whose output is outside `extension/` (or use a no-write bundle validation), verify `extension/` timestamp/content did not change, and report `git diff --stat` plus focused diff summary.

