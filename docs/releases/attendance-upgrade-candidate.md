# Attendance 2.5.5 candidate

Implements the approved design dated 1 October 2026 (Malaysia). This is an implementation candidate, not a achieved 9/10 score or a production release.
The supplied design is preserved at `docs/superpowers/specs/2026-10-01-attendance-upgrade-design.md`.

## Delivered behavior

- Local scheduling no longer performs cloud I/O inside its attendance queue. Records and terminal-event queue entries persist together; synchronization coalesces to the latest version, event replay has stable identities, deadlines and backoff. Restart reconstructs alarms and resolves overdue launched/pending runs as failed/unknown. Unknown attendance is never retried.
- Device initialization has one background owner. Registration collisions cannot replace existing credentials. Invalid credentials remain visible without changing identity. Cloud failures do not prevent local messages, watches or setup checking.
- Service-role-only RPCs register devices, atomically replace schedules/preferences, retain newer versions, record events with notification enqueue, and create unique reminders. Reminders include cancellations and enabled/readiness flags, and accurately describe automatic weekly execution.
- Global workers require a dedicated `x-scheduler-secret` matching `ATTENDANCE_SCHEDULER_SECRET` before creating a privileged database client. Queue rows have atomic claims, lease tokens, bounded sends, retry/backoff, dead letters and explicit uncertainty after crashes. Provider acceptance and student-confirmed receipt are separate.
- Settings keep student details, timetable, binding/test and weekly tasks in a short flow. Optional records and phone subscription collapse. A small hover/click/keyboard-expandable navigation keeps review, all-variant testing and activation together. Module mapping save/read/test controls share an action group, with automatically matched fields collapsed. Mapping selects/URLs have labels, errors persist, and reduced-motion support is retained.
- Inactive versioned drafts autosave and restore. Import comparison and replacement choices have been removed at the user’s request. Valid reviewed drafts save directly; identical lessons deduplicate and cancellation dates update, while different times remain separate lessons. Saved tasks support editing, pause and delete. New/changed activation requires relevant confirmed setup coverage; legacy active tasks are preserved.
- Parallel course-tab setup checks persist independently of attendance history, open all course variants at once, fill each supported Forms variant without submission and await independent confirmation on each page. Even forms without a delivery question retain distinct named course coverage. Closing/cancelling/timing out never passes. Profile/binding/delivery edits invalidate coverage; a date change alone does not. One completed-session summary is queued only if server phone entitlement is active; local history survives delivery failure.
- Records filter/page beyond 40 and export terminal history. Recovery opens the existing tab or clean form, repairs bindings, or directs login/manual inspection without automatic resubmission. The backup/restore card was removed at the user's request; validation and background restoration helpers remain compatible and tested, with restored tasks paused.
- `npm run candidate` runs Node tests, source build and simulated browser flow, then validates current bundles/manifest/assets and emits a deterministic ZIP, SHA-256 file and source/file provenance. Supplied original ZIPs are preserved.

## User follow-up fixes (1 October 2026)

The user’s five direct corrections supersede comparison, sequential checking and course-choice details in the attached design.

- When a Forms calendar is on the previous month, click “转到今日 / Go to today” before selecting today, then validate the actual date value. For an already-current month, Fluent Calendar disables that button; select today and verify the result. This state is defined in Microsoft’s [Calendar implementation](https://github.com/microsoft/fluentui/blob/master/packages/react/src/components/Calendar/Calendar.base.tsx). A correct prefilled date also receives calendar verification.
- Remove the comparison UI, per-course import choices and test-course dropdown. Test every named course variant in an independent tab, including shared forms with no Module Delivery question. Repeated occurrences of the same named course do not create redundant tabs.
- Permit genuine options.html messages with sender.tab by checking the extension sender URL/identity. School content scripts remain refused for cloud, setup-start/cancel, retry and restore operations. Regression tests verify that tabbed settings reach mocked networking and do not expose device tokens.
- Group related mapping actions and provide a fixed review/test/enable dock with shortcuts to the relevant settings sections. Running checks disable other test buttons; conflicting start requests have an explicit error.
- Browser integration executes the actual background coordinator and content code across Lecture, Laboratory and Tutorial pages, verifies independent answers and out-of-order confirmations, and checks zero submission clicks and exactly one summary.

## User interface follow-up: 2.5.2 (1 October 2026)

These direct corrections supersede the earlier visible readiness, setup-history and backup cards.

- Remove the “下一步”, “备份与恢复” and “检查设置，再启用” cards. Coverage and independent confirmations still gate activation in the background. Keep only necessary actions in a compact expandable navigation; idle shows one “操作” button. Mouse hover, click/tap and keyboard Enter open it, leaving closes it, and Escape restores focus to the button. Collapsed controls are inert.
- Place optional phone purchase/activation last, initially collapsed. The student section has only a subscription shortcut to open and scroll to that entry. Connection details and subscription terms are nested optional disclosures.
- Put each draft lesson’s delete action outside its disclosure so students can delete directly. Save/collapse student details; collapse already matched mapping fields and record tools.
- Fix false unsaved-profile errors caused by Chrome storage dictionary key ordering: compare normalized student ID, name and identity instead of serialized object order. The full browser flow reproduces the original error and now tests/activates successfully with reordered keys.
- Fix activation racing with draft edits: use revision checks, clone reviewed rows, and serialize writes. A paused-storage regression verifies that an edit during the activation read blocks activation until renewed review; serialized commits also preserve later edits as drafts.
- Browser checks cover collapsed cards, subscription location/shortcut, closed-row deletion, hover navigation, keyboard focus/Escape, tap/click, and overflow at 1360, 390 and 320 pixels.

## User follow-up: one-click setup confirmation, 2.5.3 (2 October 2026)

- After “测试全部课型 · 不提交” starts, the workflow navbar shows “一键确认全部课型” immediately. It stays disabled until every test page has finished filling and is waiting for confirmation.
- One options-page action confirms every ready variant. The background accepts this only from extension settings, rejects incomplete/failed checks, and rechecks every saved profile/form revision before marking coverage passed. An already individually confirmed variant can be included.
- Confirmation still never submits Forms. Enable remains a separate action after confirmation.
- No test suite was rerun for this small follow-up. Build and package consistency checks were run for the 2.5.3 artifact; 2.5.2 test evidence remains recorded separately.

## User follow-up: remove repeated course-card buttons, 2.5.4 (2 October 2026)

- Remove the per-course “打开并核对表单” and “测试全部课型 · 不提交” buttons. Keep one global action for each in the bottom workflow navbar.
- The global form-verification action opens the focused course, or the next course that still needs a saved binding. QR upload now only reads/fills the Forms URL; the same navbar action opens the form. The per-course “保存表单绑定” action remains beside its question mapping because each module can have a different question schema.
- Build and package consistency are verified; no tests were run for this follow-up.

## User follow-up: mobile ntfy QR and subscription-gated status, 2.5.5 (2 October 2026)

- Android QR codes now use ntfy's documented `ntfy://` topic link, which opens the ntfy Android app and subscribes automatically. The app link cannot change Instant Delivery settings, so the extension explains how to enable it. iOS QR codes remain HTTPS and explain the current manual-app setup and notification permission.
- Hide “连接手机与通知状态” unless the server reports an active, in-date entitlement with phone notifications enabled; refresh failures and expiry fail closed.
- Build and package source version 2.5.5. No tests were added or run for this follow-up.

## Production notification diagnosis (2 October 2026)

Read-only inspection of the linked `Soton Attendance` project found that production was on the pre-candidate database/API: migrations stopped at `20261001063213`, `device-api` was version 7, and `notification-worker` was version 5. The version-7 `notifications` action marked rows `sent_at` merely when the settings page read them. The worker also uses `sent_at IS NULL` to find work, so a refresh could consume a successful-attendance notification before ntfy received it. The single observed success row was created at 21:02:09 UTC and marked sent at 21:02:21 UTC, while the worker returned `pending: 0` at 21:02 and 21:03; it had not been accepted by the worker/provider.

The same deployed `device-api` does not handle `setup-summary`, which explains the queued `unknown_action`. The local API already reads notifications without mutating delivery state and accepts that action. A compatibility mapping now interprets the current worker's `sent_at` as provider acceptance while retaining the newer delivery-state fields.

With explicit user authorization, migration `20261001212217_attendance_reliability` was applied, `device-api` was deployed as version 8 (custom device-token authentication retained and JWT verification left disabled), and only the identified success row was requeued. The unchanged version-5 worker then set its `sent_at` timestamp after ntfy returned success; this records provider acceptance, not confirmed phone display. The settings API maps this legacy worker timestamp to accepted without mutating it during reads. The worker and minute cron were left unchanged. Tests were not run.

## Release review still required

1. Apply all migrations to an isolated PostgreSQL/Supabase instance. Run `supabase test db`, including the new reliability tests. Run the concurrent-worker harness against that isolated database. Verify rollback, privileges, snapshot version ordering and queue behavior with competing transactions. No database service or Docker is available in this session, so database behavior remains unverified until these checks pass.
   Run the harness with `ATTENDANCE_TEST_DATABASE_URL` set, using `deno test --node-modules-dir=none --allow-env --allow-net supabase/tests/concurrency.deno.ts`. Remote staging additionally requires `ATTENDANCE_ISOLATED_DB=1`. Use an empty isolated notification queue. Include migration fixtures with historical `sent_at`/`discarded_at`: old `sent_at` was also used by notification reads, so the candidate conservatively marks legacy completed delivery uncertain rather than asserting provider acceptance.
2. Configure a long random `ATTENDANCE_SCHEDULER_SECRET` in server secrets and cron headers. Candidate `verify_jwt=false` settings depend on handler credential verification. Coordinate migration, function, cron authentication and client rollout in one reviewed deployment. Never place this credential or service-role keys in the extension.
3. Install the candidate into isolated Chrome profiles on Windows and macOS. Validate MV3 startup/suspension, alarms, messaging and school-login redirects without submitting school forms. `npm run test:mv3` is supplied with production/school hosts blocked. The bundled Windows Chromium failed to launch (`spawn UNKNOWN`); installed Chrome 154 did not accept command-line sideloading and produced no extension worker. Neither is a passing installed-extension test. macOS is unavailable.
4. Use an explicitly approved test device/topic for staging phone latency and receipt checks. No real student notifications or topics were used in development.
5. Run the independent 10-student installation/configuration/recovery trial and keyboard/accessibility checks from the supplied scorecard. Report measured evidence before claiming 9/10.

## Local verification

Results, candidate hashes and any remaining findings are recorded in `outputs/verification-summary.json` and `outputs/candidate-provenance.json`. Node mocks/simulated browser checks are not substitutes for native database or installed-extension evidence. Native Deno checks and tests are separately run.

## Implementation decisions

- Work stays on `codex/attendance-upgrade` in the shared checkout so the changes are visible in the user's project; the existing untracked audit document is preserved.
- The user's implementation request authorizes execution of the supplied design without another design approval.
- Restored tasks begin paused because backup files do not carry trusted, current setup coverage. Completing setup checks and enabling them preserves the future-trigger rule and prevents automatic recovery submissions.
- Expired sending leases are quarantined as uncertain because provider acceptance may precede the crash; already-accepted phone delivery is never claimed exactly once. Explicit provider rejections retry with backoff; five rejected attempts are retired.
- Database/platform/student observations are release gates; this task prepares their tests and reports the unavailable boundaries rather than claiming they passed.

## Review and references

One fresh read-only whole-change review found three important defects: response-loss registration recovery, settings-side restore races and coerced malformed weekdays. Each was reproduced by a failing regression test, corrected, and verified with the suite. Registration now persists a 256-bit ownership proof before networking and accepts replay only with the same proof; unauthenticated collisions remain rejected. Restore now runs inside the background queue. Weekday and kind validation now checks original types. The delivery-history finding was also addressed conservatively; native migration verification remains a release gate. No minor code findings were deferred.

Supabase's current [function authentication guide](https://supabase.com/docs/guides/functions/auth) describes custom handler authentication with gateway JWT checks disabled; the candidate uses its dedicated scheduler-header mechanism. Transactional changes are implemented as service-role-only [database functions](https://supabase.com/docs/guides/database/functions).
