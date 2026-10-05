# Soton Attendance: design for a 9/10 student experience

Date: 1 October 2026, Malaysia time. Baseline: repository commit `c54421d`, extension 2.4.0, product v1.0.0. The supplied Downloads ZIP matches the audited repository ZIP exactly.

## Intended outcome

A student with no technical background can install the extension, configure their own supported timetable and Microsoft Forms, confirm that every relevant course type fills correctly without submitting, activate the intended weekly tasks, and understand what to do when a run fails or its result is uncertain.

The audit is the evidence baseline. This design defines the proposed behavior before implementation; it does not claim those improvements are already present. “9/10” is a measurable usability and reliability target. Perfect operation cannot be guaranteed when Chrome is closed, a computer sleeps, school login expires, Forms changes, or an external service is unavailable.

## Approach

**Recommended: improve the existing system in stages.** Preserve the local extension architecture, bundled recognition tools, supported Forms types and existing payment model. Fix scheduling and security defects, then add guided setup, complete non-submit checks, useful recovery actions and repeatable packaging. This keeps the installation model familiar and limits migration risk.

A cosmetic UI refresh would reduce some confusion but leave missed execution and lost notifications. A complete replacement with accounts, a phone application and a new backend would increase implementation and migration cost without removing the browser/school-session dependency. Neither is recommended for this target.

The work is architectural because it separates local execution from cloud work, adds persistent checking/recovery state, and introduces transactional backend interfaces. It is divided into independently testable subsystems below.

## Constraints and preserved policies

- Keep ¥12 for the first-term bundle and ¥5 per term for phone-notification renewal. Do not change shop products, inventory or payment policies during local implementation.
- Local attendance remains independent of paid phone entitlement. The server remains the authority for phone permission and expiry.
- Keep automatic weekly execution, without daily confirmation. Correct the reminder wording to match this behavior.
- Preserve current profiles, bindings, schedules, terminal records and device identity during upgrade. Existing active tasks continue under their current policy; show clearly when they have not yet received the new setup check.
- Retain the current supported Forms hosts and question types: supported single-line text, date and single-choice questions. Unsupported questions produce a clear blocker. Do not promise support for every Forms layout.
- Never submit a school form during setup testing. Never automatically retry an uncertain attendance submission. Do not bypass school authentication, CAPTCHA or policy checks.
- Repository implementation, migrations and a candidate installation ZIP are separate from production deployment. Production functions, cron credentials, stock and student rollout require a concrete release review before changes are made.
- Treat ntfy acceptance, actual phone receipt and school attendance acceptance as separate outcomes.

## 1. Local scheduling that works without the cloud

The background worker retains serialized access to local attendance state. It completes local validation, saves records and establishes the next alarm without waiting for registration, synchronization or event reporting.

Cloud work uses a separate persisted outbound queue. Network attempts have a bounded timeout and retry/backoff; they do not occupy the local attendance queue. Startup and maintenance resume queued cloud work after service-worker suspension. Timetable synchronization represents the newest desired snapshot; terminal events retain an occurrence/event identity until acknowledged.

The watchdog records launched→failed or pending→unknown correctly and produces a desktop notification even when the cloud is unavailable. Fix the undeclared status variable. Every terminal path, including missing/invalid bindings, uses the same local-record and cloud-enqueue mechanism.

Before clicking submit, the content script still verifies the task, tab, date, schema and actual values. Background authorization for an automatic run remains tied to its current task and record. A deleted task cannot be authorized for a new submission. Local scheduling and cloud replay never trigger a second school submission for a terminal occurrence.

**Acceptance:** stalled registration/sync/event requests do not delay tab authorization, result messages or watchdogs; alarms survive reconstruction; terminal events recover after reconnection; unknown runs do not retry. Include tests with a real-like extension runtime ID and tests of service-worker restart behavior.

## 2. Secure and consistent cloud operations

### Device ownership

New registration creates a device; it cannot replace credentials for an existing identifier without authenticated ownership. Reject unauthenticated collisions. Coordinate extension initialization so simultaneous settings/background calls do not create competing registrations.

Do not automatically discard an invalid token and register over the old device. Show a usable error and preserve local operation. Account-level recovery and paid-device transfer remain outside this upgrade unless a separate policy is approved.

### Scheduler authorization

Reminder generation and notification delivery require a verified dedicated scheduler credential before any privileged database operation. Align gateway settings with that mechanism. Missing or ordinary user credentials cannot invoke global work. Do not place this credential in the extension or log its value.

Changing production cron authentication is a coordinated deployment step, not a local code change to apply blindly.

### Atomic synchronization and event recording

Replace schedules inside one database transaction, with full validation and per-device concurrency/version control. A rejected snapshot or insertion failure retains the last committed snapshot. Use exact Forms host/path validation and valid calendar/time values.

Store an attendance event and its notification enqueue operation transactionally. Retries are idempotent for the logical event. Repeated reminder generation creates one logical reminder per device/date. API success reflects persisted work, not an ignored insertion error.

Synchronize exception dates and automation readiness. The reminder generator applies cancellations and does not imply that an unbound or disabled task will execute.

### Notification queue

Workers claim rows atomically using a lease, with recovery after a crashed worker. Attempts have deadlines and backoff; permanently failing items move out of the active queue so healthy notifications continue. Handle failures to update delivery state explicitly.

Provider acceptance followed by a crash can leave uncertain delivery. Record that uncertainty and avoid claiming exactly-once phone delivery without provider support. Every send, including setup-check summaries, still passes the server entitlement gate.

**Acceptance:** unauthorized credential replacement fails; workers reject ordinary callers; schedule failures roll back; events/reminders enqueue idempotently; concurrent workers cannot claim the same live row; 100 bad old messages cannot starve a healthy new message; cancellation dates agree locally and in reminders.

## 3. Guided setup and complete non-submit checking

### Visible readiness

Settings begin with a compact next-action summary rather than asking students to infer readiness from separate sections. Show:

- Profile saved or the exact missing field.
- Timetable draft reviewed, active tasks and their next Malaysia trigger times.
- Which module bindings are missing or incompatible.
- How many course/form/delivery variants have a confirmed setup check.
- Local automation state, cloud synchronization state and optional phone entitlement separately.

Place task activation after binding/checking in the visual sequence. Each blocker has a direct action. Explain the school-login and awake-computer requirements beside activation.

Keep the interface language consistent with the existing Chinese settings and English school question/option labels. Properly label mapping selects, URL fields and controls for keyboard/screen-reader use. Keep existing reduced-motion behavior.

### Persistent drafts and schedule edits

Autosave timetable review state locally as an inactive, versioned draft. Closing or reloading settings restores it. Saving a draft does not activate tasks.

Allow editing a saved task's day/time/cancellations. An import comparison displays additions, proposed changes and retained tasks; students explicitly choose replacements. Changing a time removes its obsolete trigger. Changing cancellations updates the intended task instead of being ignored as a duplicate. Do not guess that two separate weekly classes are replacements merely because they share a course code.

Show recurring-task policy prominently. This upgrade keeps indefinite weekly repetition and provides a clear pause/delete action; a compulsory semester end date is not introduced.

### One complete setup-check session

Add “Check my setup.” A persistent coordinator builds a sequential checklist of unique module/form/delivery configurations required by the intended tasks. Each item opens the appropriate Forms page, fills it using the existing validated non-submit path and verifies values. The student confirms the displayed answers for that variant before it becomes passed.

Test states include queued, opening, filling, awaiting student confirmation, passed, failed, cancelled and timed out. Closing a test tab never counts as a pass. A page reporting correct filling without the student confirmation never counts as a completed setup check.

Save an independent check history, separate from attendance records, containing its timestamp, configuration revision, tested variants and per-item outcomes. Relevant profile/binding/delivery changes invalidate the corresponding coverage. A date change alone does not invalidate mapping coverage; execution still verifies the actual date every time. Clearly show the date of the last test rather than promising the external form will never change.

New or changed tasks display missing coverage and require a confirmed check before activation through the new guided flow. Preserve existing tasks during upgrade, mark their missing coverage, and direct the student to check them; do not silently disable previously active schedules.

Finish with one understandable summary. With an active server entitlement, enqueue one logical phone summary for the completed check session. Without entitlement, preserve the local history and explain activation. Retrying a cloud summary never reruns the Forms test and never submits it. Abandoned sessions remain recorded locally and are not presented as complete.

**Acceptance:** all intended supported variants are covered; zero submit clicks in every test path; edits revoke stale coverage; close/reload restores the draft and session; a cancelled tab fails/cancels visibly; successful local checking remains successful when phone delivery fails; one summary event per completed session.

## 4. Recovery, backup and accurate phone status

Record rows provide actions matched to the failure: open the existing run tab/form, repair a changed binding, check school login, or inspect an uncertain submission manually. Do not offer an automatic resubmit button for unknown results. Show more than 40 records through pagination/filtering and allow export.

Configuration backup includes the profile, bindings, schedules and supported terminal-history data needed for safe recovery. It excludes bearer credentials, activation keys and active/in-flight run state. Import validates the file, previews the changes and restores configuration without silently transferring paid device identity. Restored tasks begin from future eligible triggers; an import must not automatically resubmit an old occurrence.

Provide copy/QR controls for the ntfy topic, explicit network/sync errors and a retry action. Distinguish topic ready, phone permission active, notification queued, ntfy accepted and student-confirmed receipt. Keep the phone setup optional and state that local attendance still works without phone payment.

Keep the current shop URL until actual separate product URLs are supplied; label it honestly as the shop. An unavailable product URL is not fabricated. Production phone verification uses an explicitly approved test device, not real student topics.

**Acceptance:** a student can determine the next safe action from each terminal result; backup/import retains intended configuration without cloning credentials; missing phone connectivity cannot stall local setup; displayed delivery claims match the evidence available.

## 5. Verification and candidate release

Use the existing Node runner and simulated browser flow. Add focused behavior tests at the boundaries where the audit found defects, including cloud-enabled background execution, failure/restart/replay, schedule edits, setup-check coverage, external-form changes, input validation and notification worker races.

Run native Deno checks and database integration/concurrency tests in a local or isolated staging environment. If these tools/services are unavailable, report the unverified boundary rather than treating a Node shim or mocked database as a substitute.

Test actual installed Chrome extensions on Windows and macOS for MV3 startup, suspension, alarms, messaging and login redirects. Real school attendance submissions are not part of automatic development testing.

Add repeatable candidate ZIP creation after checks and source build. Verify manifest version, required assets, bundle/source consistency and checksums. Preserve the supplied original ZIP; put a clearly named candidate deliverable in the chat outputs. Do not overwrite or publish a student release merely because a local build passes.

## 9/10 acceptance scorecard

| Area | Required evidence |
| --- | --- |
| Independent install | At least 9 of 10 novice students install and open settings within 5 minutes without live help. |
| First configuration | At least 9 of 10 independently configure the supplied supported three-module/mixed-type timetable within 15 minutes; all intended days/times/groups are correct. |
| Safe setup checking | Every required variant is explicitly confirmed; automated test paths produce zero attendance submissions. |
| Local reliability | All controlled fault scenarios pass, including cloud stalls, restart, login failure, changed form, deleted task, date boundary, timeout and corrected schedules. |
| Recovery | At least 9 of 10 students identify and complete the safe recovery action in a simulated failure/unknown-result task without assistance. |
| Phone reliability | Entitlement gates and duplicate/queue-failure tests pass; measured staging delivery latency and phone receipt are recorded separately. |
| Security | Existing-identifier registration and non-scheduler global calls are rejected; database rollback/concurrency/permissions checks pass; no privileged credentials in client packages. |
| Accessibility | Main flow completes by keyboard; all actionable controls have useful accessible names; errors remain available beyond a brief toast. |
| Release readiness | Candidate ZIP is reproducible, tested against installed-extension behavior, and traceable to a reviewed source revision. |

A final 9/10 claim requires these observations, not a prettier settings page or a larger unit-test count. Before the student trial and production/staging checks, report implementation readiness and remaining limits instead of assigning an achieved score.

## Proposed delivery sequence

1. Local execution and durable cloud queue; timeout regression protection.
2. Backend ownership, scheduler authorization, transactions, cancellations and reliable outbox processing.
3. Persistent drafts, saved-task edits and guided readiness; complete non-submit checking and independent history.
4. Contextual recovery, backup/import, accurate optional-phone setup and repeatable candidate packaging.
5. Installed-extension/platform tests, isolated backend tests and independent student trial; prepare the deployment/release review.

Each subsystem receives a detailed implementation plan and tests before product changes. The remaining product assumptions are explicit above: current pricing, automatic execution, indefinite weekly schedules, shared module binding for supported courses, confirmation per tested variant, and configuration-only recovery without automatic paid-device transfer.

## Approval requested

Approve this design to proceed with the detailed implementation plan. Any desired change to the preserved policies or proposed confirmation/recovery behavior should be made here first. No production or student rollout is authorized by this design review.
