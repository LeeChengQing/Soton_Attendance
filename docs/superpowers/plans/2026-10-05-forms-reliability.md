# Forms Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Microsoft Forms submission reliable and non-duplicating while requiring explicit success text for a success result.

**Architecture:** Keep the local Forms flow in `forms.js` and `content.js`, and keep all durable attempt reservation and state writes in the serialized background service worker. Add phase metadata and explicit pending-confirmation state without changing cloud/authentication implementation; map the local pending state to the existing cloud `unknown` status if it is synchronized.

**Tech Stack:** JavaScript ES modules, Chrome MV3, Node test runner, existing Playwright test harness.

**Spec:** `docs/superpowers/specs/2026-10-05-forms-reliability-design.md`

## Global Constraints

- Do not push or restore pre-existing workspace changes.
- Do not modify authorization, activation, subscription, or entitlement code.
- Do not log form contents, answers, links, or personal data.
- `tests/local-only/` is ignored as a whole; real success-page structure is disabled unless stable structural attributes exist in the local-only sample.
- No automatic submission retry; idempotency marks are permanent until explicit user confirmation.
- Only explicit success text can produce `success`; structure-only evidence produces pending confirmation.

## Review Focus

- Two concurrent reservations for one key: test both calls and verify only one is granted in `tests/background.test.js` additions.
- Service-worker restart after reservation: test persisted attempt state denies a new reservation in `tests/background.test.js` additions.
- Content-script fallback injection: test one fallback and no duplicate page execution in `tests/background.test.js` additions.
- Real success sample with no structural attributes: test structure detector remains disabled without copying sample text in `tests/forms.test.js` additions.
- A reordered form versus renamed/added/deleted fields: test normalized diff classification in `tests/forms.test.js` additions.

### Task 1: Ignore and test scaffolding

**Files:**
- Modify: `.gitignore:23`
- Test: `tests/forms-reliability.test.js`

**Interfaces:**
- Produces the local-only ignore invariant and failing tests for the pure Forms helpers.

- [ ] Write failing tests for `.gitignore` verification documentation, multilingual success text, structure-only pending evidence, and normalized diff categories.
- [ ] Run the focused tests and confirm they fail for missing helpers/behavior.
- [ ] Add only the directory-level ignore rule if it is absent; do not alter existing unrelated rules.
- [ ] Run focused tests and `git check-ignore -v tests/local-only tests/local-only/forms-success-real.html`.

### Task 2: Success signals and question diffs

**Files:**
- Modify: `src/forms.js:20-71`
- Test: `tests/forms-reliability.test.js`

**Interfaces:**
- Produces `submissionSignals(before, after, options)`, `isExplicitSuccess(text)`, `normalizeComparable(value)`, and `questionDiff(expected, actual)`.
- `isExplicitSuccess` returns the configured signal name or `null`; no structure-only result is success.

- [ ] Add failing tests for English, Simplified Chinese, Malay, explicit `Your answers...`, explicit `Your response...`, structure-only pending, no signal, reorder-only equality, and added/deleted/renamed/option changes.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement normalized comparison and configurable text rules without emitting matched text.
- [ ] Keep real-sample structural selectors disabled because the inspected file has no stable structural attributes; expose a closed option for future local-only selectors.
- [ ] Run focused tests and confirm pass.

### Task 3: State model and permanent reservation

**Files:**
- Modify: `src/state.js:1-10`
- Modify: `src/background.js:42-165,213-223`
- Modify: `src/backup.js:4-46`
- Test: `tests/state.test.js`, `tests/background.test.js`, `tests/backup.test.js`

**Interfaces:**
- Produces `reserveSubmission(key, senderTabId)` through the existing serialized message path and `submitted_pending_confirmation` transitions.
- Reservation writes `submissionAttemptedAt` and `submissionKey` before granting a click; repeated requests return denied without changing the marker.

- [ ] Add failing tests for concurrent reservation, persisted reservation after restart, permanent marker, pending-confirmation transitions, manual confirmation, and backup round-trip.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the smallest state additions and background reservation path using the existing `serialized` queue; map pending-confirmation cloud events to existing `unknown` only at the local cloud payload boundary if needed.
- [ ] Add explicit user-only release handling with a confirmation-required message; do not invoke it automatically.
- [ ] Run focused tests and confirm pass.

### Task 4: Phases, login detection, sleep detection, and fallback injection

**Files:**
- Create: `src/reliability.js:1-20`
- Modify: `src/background.js:87-165`
- Modify: `src/content.js:88-180`
- Modify: `extension/manifest.json:12-20`
- Modify: `scripts/build.mjs:34-41`
- Test: `tests/background.test.js`, `tests/form-submission.test.js`

**Interfaces:**
- Produces phase reports with sanitized phase names and durations; each phase owns its deadline.
- Produces one safe `chrome.scripting.executeScript` fallback for a Forms tab when reading has no content-script response.

- [ ] Add failing tests for phase-specific errors, login/permission URL detection, timer drift classified as `missed_sleep`, one fallback injection, and no duplicate content execution.
- [ ] Run focused tests and confirm failures.
- [ ] Implement phase reporting and watchdog scheduling without logging URL, text, answers, or profile fields.
- [ ] Add the `scripting` permission in source and generated manifest configuration; gate fallback to known Forms hosts.
- [ ] Add a page-level content-script guard and explicit-success-only finalization; structure-only changes report pending confirmation.
- [ ] Run focused tests and confirm pass.

### Task 5: Records UI and manual actions

**Files:**
- Modify: `src/options-upgrade.js:85-104`
- Modify: `src/options-locale.js:15-19`
- Modify: `src/backup.js:40-46`
- Test: `tests/local-acceptance.test.js`

**Interfaces:**
- Displays phase errors, pending confirmation, and sanitized signal names.
- Adds manual “mark submitted” and “I will check manually” actions; historical unknown records remain unchanged until clicked.

- [ ] Add failing UI tests for pending state labels, both manual actions, and no automatic state migration.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the actions through background messages; require explicit confirmation before releasing a reservation.
- [ ] Run focused tests and confirm pass.

### Task 6: Build and full verification

**Files:**
- Modify only files listed above if build output requires source correction.

- [ ] Run `npm test` and read the complete result.
- [ ] Run `npm run build` and verify generated manifest includes `scripting`.
- [ ] Run `git check-ignore -v tests/local-only tests/local-only/forms-success-real.html` and record both matches.
- [ ] Review the branch diff for authorization/activation changes, sensitive output, and merge-conflict hotspots in `src/background.js` and `src/state.js`.
