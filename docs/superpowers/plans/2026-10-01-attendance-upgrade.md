# Attendance upgrade implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved 9/10 design as a locally reviewable candidate.
**Architecture:** Keep MV3 local scheduling serialized. Persist cloud work separately and do network I/O outside that queue. Use service-role-only transactional database functions for device ownership, snapshots, events, reminders and leased delivery. Persist setup sessions and drafts independently of attendance.
**Tech stack:** JavaScript, Chrome MV3, Node tests/Playwright, Deno Edge Functions, PostgreSQL.
**Spec:** C:/Users/CQCQ/Documents/Codex/2026-10-01/che/outputs/Soton-Attendance-9-of-10-Upgrade-Design.md

## Global constraints
- Preserve profile, bindings, schedules, terminal records and device identity. Existing active schedules remain active.
- Keep ¥12/¥5 pricing and the current shop URL. No production operations, student rollout or school submissions.
- Weekly execution is automatic and indefinite. Unknown results never retry attendance.
- Setup checks never submit and require student confirmation for each unique configuration.
- Local attendance works independently of cloud and paid phone entitlement.
- Backup excludes credentials, paid identity and in-flight state; restored schedules start in the future.

## Review focus
- MV3 termination between persistence and acknowledgements: durable replay, no duplicate submission.
- Profile/binding edits while a check is open: stale confirmation must fail.
- Multiple weekly classes for the same course: replacement must be explicit.
- Provider acceptance followed by crash: expose uncertain delivery, never assert receipt.
- Malformed import/URL/calendar input: fail before replacing committed state.

### Task 1: Local scheduler and durable cloud queue
**Files:** src/background.js, src/cloud.js, src/cloud-client.js, src/outbox.js; test/background.test.js, test/outbox.test.js, test/cloud-entitlements.test.js.
**Interfaces:** Outbox enqueue(snapshot, action, payload, now), acknowledge(snapshot,id), fail(snapshot,id,error,now). Background alone owns queue storage. Options request bounded cloud operations over messaging; no registration races across extension contexts.
- [x] Add failing tests: real extension ID + stalled cloud cannot delay launch/GET_RUN/watchdog; invalid bindings enqueue missed; restart restores watches; unknown never relaunches; latest sync survives older acknowledgement; events keep stable identity; retries back off.
- [x] Run focused Node tests and observe failures.
- [x] Implement atomic local record/outbox writes, independent bounded cloud drain, startup reconstruction and ownership-preserving initialization.
- [x] Run focused tests and full Node suite.

### Task 2: Transactional backend and secure workers
**Files:** supabase/functions/_shared/validation.ts, scheduler.ts, notification.ts; device-api/index.ts; send-reminders/index.ts; notification-worker/index.ts; config.toml; new migration and SQL tests.
**Interfaces:** register_attendance_device, replace_attendance_schedules, record_attendance_event, enqueue_attendance_reminders, claim_attendance_notifications, finish_attendance_notification, record_setup_summary (service-role-only RPCs).
- [x] Add failing boundary tests for exact URLs/calendar/time validation, scheduler denial and leased delivery outcomes. Add database tests for collisions, rollback, version ordering, idempotence, claims, dead letters and cancellations.
- [x] Observe Node failures; run native database tests when available.
- [x] Implement dedicated scheduler header authentication before client creation; atomic registration/sync/event/enqueue; recoverable claims with backoff and uncertainty.
- [x] Run Node tests, native Deno checks and isolated DB tests if available. Record unavailable boundaries explicitly.

### Task 3: Persistent setup-check coordinator
**Files:** src/setup.js, background.js, content.js; test/setup.test.js, background.test.js; scripts/smoke.mjs.
**Interfaces:** buildVariants(tasks,bindings,profile), coverageRevision(course,binding,profile), hasCoverage(history,variant), setup session {id,state,items,current,startedAt,completedAt}. Background messages START_SETUP/GET_SETUP_ITEM/REPORT_SETUP_ITEM/CONFIRM_SETUP_ITEM/CANCEL_SETUP.
- [x] Test unique delivery variants, date-independent revision, profile/binding invalidation, no pass without confirmation, cancelled tab, timeout/restart, one summary per completion.
- [x] Implement sequential tab coordinator and persisted independent history; content verifies/fills and offers explicit confirmation without calling submit.
- [x] Run focused tests and simulated Forms checks.

### Task 4: Drafts, edits and guided settings
**Files:** src/configuration.js, src/options.js/html/css; test/configuration.test.js, scripts/smoke.mjs.
**Interfaces:** validateSession(row), compareImport(existing,incoming), applyImport(existing,incoming,choices,now), readiness(data). Versioned attendanceDraft with rows/reviewedAt; coverage gates new/changed activation, legacy tasks keep policy.
- [x] Test cancellation-only update, explicit time replacement versus separate class, paused tasks, invalid calendar/time, draft restoration and activation coverage.
- [x] Implement autosave, comparison choices, saved-task edit/pause, readiness with direct actions, next Malaysia triggers, check/history UI, useful labels and persistent errors.
- [x] Verify Node tests and rendered browser flows.

### Task 5: Recovery, backup and optional phone status
**Files:** src/backup.js, src/options.js/html/css; test/backup.test.js, scripts/smoke.mjs.
**Interfaces:** createBackup(data), validateBackup(input), restoreBackup(input,current,now), recoveryForRecord(record). Import preview before commit; terminal history only, never credentials/in-flight tasks.
- [x] Test credential stripping/rejection, malformed input, future triggers, terminal conflict preservation, unknown recovery without resubmit.
- [x] Implement export/import preview, filtered paginated records, safe form/login/binding actions, ntfy copy/QR, cloud retry and separate provider/receipt status.
- [x] Verify Node and simulated browser flows.

### Task 6: Candidate packaging and release evidence
**Files:** scripts/package-candidate.mjs, package.json, scripts/build.mjs, docs/releases/attendance-upgrade-candidate.md, outputs candidate ZIP/checksums.
- [x] Test deterministic ZIP entries, manifest/source/assets consistency and exclusion of secrets.
- [x] Build and smoke; package after verification; preserve original ZIPs. Record native environment checks and outstanding installed-extension/macOS/student-trial evidence.
- [x] Review whole change with a fresh reviewer and fix important findings with regression tests. Do not deploy/push/publish.

## Execution ledger
Baseline: branch codex/attendance-upgrade from c54421d; 40 passing, 1 skipped Node tests. Existing untracked docs/SYSTEM_OVERVIEW_AND_CODEX_AUDIT_PROMPT.md preserved.
Ruling: Work in a new branch in the shared checkout, avoiding a worktree relocation so changes remain visible in the user's project. No commits or external side effects are needed to produce the candidate.
Ruling: User explicitly requested implementation of this supplied design; proceed with the detailed implementation without a redundant plan approval.
Pre-flight interfaces: background owns all outbox and setup-session writes; settings delegates cloud operations. Transactional API snapshot version is persisted per client snapshot. Coverage includes profile/binding/delivery, excludes execution date. Restores retain device identity and terminal occurrences.

Task 1: implementation complete. Actively stalled cloud delivery with real-like runtime ID, GET_RUN/watchdog independence, pending restart, event replay, queue coalescing and deduplication pass Node tests.
Task 2: implementation complete; native Deno checks and 11 tests pass. PostgreSQL transaction/permission/concurrency execution remains unverified because no isolated database/Docker service is available; SQL tests and native Deno concurrency harness are supplied.
Task 3: implementation complete. Coordinator sequence, confirmation requirement, close/cancel, timeout/restart, profile invalidation and independent history pass. Simulated content confirms zero setup submit clicks.
Task 4: implementation complete. Draft autosave/reload, activation coverage, explicit replacements, cancellation changes, task validation and responsive/accessible control naming verified in Node/simulated Chrome.
Task 5: implementation complete. Backup excludes credentials/in-flight state; import preview, paused future-only restoration, terminal-record race preservation, contextual recovery, filtered/paged export and optional phone evidence states implemented.
Task 6: candidate packaging complete after source build, Node suite and simulated browser flow. Bundles/manifest/assets and deterministic ZIP roundtrip verified. Windows MV3 runner supplied but browser launch/sideload unavailable; macOS, staging phone receipt and novice trial remain release-review evidence.
Ruling: Restored tasks start paused and require fresh setup coverage while keeping older independent check history — imported backup evidence is not a current setup check — cost: one setup check before enabling restored tasks.
Ruling: Legacy sent_at does not prove provider acceptance because the former notifications read endpoint also set it. Backfill completed legacy rows as uncertain and discarded rows as discarded — cost: old genuine provider acceptances remain labelled unverified until student confirmation.
Final review: fresh read-only reviewer; no critical findings, three important findings reproduced and fixed (durable registration proof; serialized restore; strict original weekday/kind). Delivery-history finding regraded for truthful status and fixed locally; database backfill execution unverified. No code findings deferred.
Final: fixed registration response loss — registration replay retains durable ownership proof RED→GREEN.
Final: fixed restore race — backup restore serialized with terminal reports RED→GREEN.
Final: fixed malformed weekdays — null/boolean/string/undefined original weekdays and unsupported kinds rejected RED→GREEN.
Local verification details and release gates: outputs/verification-summary.json; reviewed source fingerprint and ZIP hashes: outputs/candidate-provenance.json.

## User follow-up: 2.5.1 (1 October 2026)

These direct user corrections supersede the earlier comparison and sequential-check design details.
- [x] Go to today precedes day selection on a previous-month calendar; select and validate today also on an already-current calendar with disabled navigation. Read-only calendar inputs can use their picker.
- [x] Remove import comparison and import choice controls; save reviewed lessons directly with exact lesson deduplication.
- [x] Open all named course types in separate tabs, auto-select delivery answers, record independent confirmations, and never submit. Forms without a delivery question still keep separate course coverage.
- [x] Group mapping save/read/test actions; keep review, global test and enable actions in a fixed dock with section shortcuts and responsive sizing.
- [x] Authorize genuine extension settings tabs by URL/identity for cloud, retry, setup and restore operations. Refuse school content scripts.
- [x] Fresh review: two findings reproduced and fixed (course variants collapsed without delivery question; conflicting module starts silently reused another session). No deferred code findings.
- [x] Real Chrome simulated integration uses the actual background coordinator and bundled content for LEC/LAB/TUT, readonly calendar, out-of-order confirmations, zero submit clicks and exactly one summary. Full Node suite: 73 pass, 1 optional QR photo sample skip; candidate browser flow/package verification recorded in outputs/verification-summary.json.

Live cloud service connectivity and installed MV3 school form behavior remain distinct from simulated tests. The corrected permission decision is verified; no real school submissions, device registration, cloud deployment or student notifications were performed.

## User follow-up: 2.5.2 (1 October 2026)

The user's simplification requests override the original visible readiness, backup and setup-history cards.
- [x] Remove the three cards: 下一步, 备份与恢复, 检查设置，再启用. Preserve background coverage checks and independent page confirmations.
- [x] Replace the broad fixed status/action bar with a minimal 操作 button and hover/click/keyboard-expandable navbar; group review, test, enable and necessary section links there. Escape returns focus, collapsed controls are inert, and leaving closes the panel.
- [x] Place phone purchase/activation last and collapsed; student section links to this entry. Fold connection details, matched mapping fields, saved student details and records.
- [x] Draft course delete is directly accessible without opening the row; removal resets review and preserves other rows.
- [x] Reproduce false dirty-profile error with Chrome-style reordered storage keys; fix comparison of normalized relevant fields. Full UI smoke and profile regression tests pass.
- [x] Fresh review exposed stale draft review during asynchronous activation. Paused-storage browser reproduction RED→GREEN; revision checks, cloned rows and serialized writes prevent stale activation and preserve later draft edits.
- [x] Fresh navbar review exposed narrow-screen toast overlap. Measure expanded panel, place toast above it and disable toast pointer interception. Browser geometry/hit-test checks and reviewer confirmation pass at 1360/390/320px.
- [x] Full Node verification: 75 pass, 1 optional sample skip, 0 failures. Current source build, simulated browser smoke and deterministic 21-file ZIP validation pass. Detailed evidence and final package fingerprint are in outputs/verification-summary.json and outputs/candidate-provenance.json.

No real school forms were submitted. Installed-extension and live cloud verification remain the previously recorded external release boundaries.

## User follow-up: 2.5.3 one-click course confirmation (2 October 2026)

- [x] Show a navbar confirmation button only during an active all-course check; keep it disabled until all pages are awaiting confirmation.
- [x] Add a settings-page-only background action which atomically confirms all ready course variants after rechecking saved form/profile revisions. It never submits forms, and enabling tasks remains a separate action.
- [x] Keep “启用每周任务” immediately to its right so confirmation precedes activation.
- [x] Rebuild and package version 2.5.3. Per current task instructions, no tests were added or run for this follow-up; 2.5.2 verification is retained separately.

## User follow-up: consolidate course-card actions, 2.5.4 (2 October 2026)

- [x] Remove repeated per-course form-open and all-variant-test buttons; keep one of each in the bottom navbar.
- [x] Navbar form-open targets the focused course or next incomplete binding. QR upload fills the URL, then uses this shared action to inspect the form.
- [x] Keep the per-course binding-save control next to its question mapping.
- [x] Build and package source version 2.5.4. Tests not run for this follow-up.

## User follow-up: mobile ntfy QR and subscription-gated status, 2.5.5 (2 October 2026)

- [x] Generate Android QR payloads with the official ntfy `ntfy://` topic deep link, including a display name so installed Android apps subscribe automatically.
- [x] Keep a dedicated iOS QR mode with an honest in-app limitation note and manual-add instructions; current ntfy iOS does not provide the required deep link.
- [x] Reveal connection and delivery status only for an active, unexpired entitlement that includes phone notifications; hide on lookup errors and at expiry.
- [x] Build and package source version 2.5.5. Tests were not added or run.
