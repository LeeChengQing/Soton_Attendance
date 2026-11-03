# Activation Gate Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. Execute in this workspace, preserving existing uncommitted changes. No commits, pushes, deployments or server changes.

**Goal:** Add the specified Liquid Glass activation gate and enforce the same authorization decision in the background.
**Architecture:** A pure state resolver and a background gate service consume the existing device token and license metadata. Settings and popup request that service; existing task launch guards use it too. Preserve the recovered background-cloud variant through shared license client functions.
**Tech Stack:** Native HTML/CSS/JS, esbuild, node:test, existing Playwright/Chrome.
**Spec:** C:/Users/CQCQ/Downloads/codex-activation-gate-ui-spec.md

## Global Constraints
- Scope: extension UI and authorization wiring only; no payment, cryptography, database or server contract changes.
- 72-hour grace; uncertainty/network/5xx/timeout/parse errors fail open for previously activated users. New tasks require authorization; already launched tasks continue.
- Card width 540px, radius 36px, backdrop blur at most 2px, overlay rgba(6,20,26,.82); opaque/reduced-transparency/forced-colors fallbacks.
- No dependencies, external assets, CSP changes, raw keys in storage/logs/URLs, or development bypass in release output.
- Run only targeted tests and the build/ZIP checks required by this specification; never the full release command (it replaces the live root).

## Review Focus
- Ambiguous licensed:false cannot prove revocation; preserve paid users' access.
- Stored definitive revocation must survive restart; transient errors must not become definitive denial.
- Activation timeout must end the actual request, not leave a background mutation racing a retry.
- Pasting UUIDs must not silently reinterpret them as a modern key.
- Release assertions must inspect executable output, and the final ZIP's inflated contents.

### Task 1: Shared authorization and key input
**Files:** src/license-gate.js, src/plugin-license.js, src/license-key.js, src/cloud.js, src/v1.0.5/background-cloud.js, tests/activation-gate.test.js.
**Interfaces:** resolveGate(cache, result, now, version); getActivationGate({refresh}); activatePluginLicense(licenseKey).
- [x] Add failing tests covering eight states, grace boundaries, offline/5xx/parse uncertainty, restart, normalization and key leakage.
- [x] Run `node --test tests/activation-gate.test.js` (RED).
- [x] Implement the shared resolver/client, retaining metadata but never storing keys.
- [x] Re-run the targeted tests (GREEN).

### Task 2: Settings and popup
**Files:** src/activation-gate.js, src/activation-gate.css, src/gate-copy.js, src/options.html, src/options.js, src/options-locale.js, src/popup.html, src/popup.js, src/popup.css, tests/activation-gate-browser.test.js.
- [x] Add failing browser tests for focus, keyboard submission, errors, expiry, timeout/rate limiting, success delay, localization, transparency, responsive layout and leak canary.
- [x] Implement accessible dialog, hidden initial application, read-only authorization page, local transparency preference and popup gate.
- [x] Run the browser tests in existing headless Chrome (GREEN).

### Task 3: Background entry points and release safety
**Files:** src/background.js, scripts/build.mjs, scripts/package-candidate.mjs, scripts/scan-release.mjs, tests/activation-release.test.js.
- [x] Add failing tests for release bypass removal and synthetic clean/contaminated ZIP scans.
- [x] Route launch guards and popup/settings status to getActivationGate; open options on install, preserve ongoing runs, update badge.
- [x] Compile development bypass branches away with __ATTENDANCE_DEV__; assert output and ZIP contents.
- [x] Build isolated candidate, run targeted related tests, package and scan a review ZIP without replacing root runtime.

### Task 4: Delivery
**Files:** docs/ACTIVATION_GATE_ACCEPTANCE.md, DECISIONS.md, outputs/activation-gate-release-scan.json.
- [x] Record investigation, entry-point inventory, server limitations and decisions (clear all submitted keys; retain on network errors only).
- [x] Document real Chrome manual acceptance at 1280×720, 1920×1080 and 800×600, keyboard/forced colors/motion, DOM removal and offline cases.
- [x] Record actual targeted test counts and ZIP scan result; leave all changes uncommitted.

## Execution record

117 targeted tests passed; one real Chrome MV3 verification passed. Independent review fixes and server-contract limitations are documented in DECISIONS.md. No commit or live-root replacement. Final candidate ZIP and scan report are listed in docs/ACTIVATION_GATE_ACCEPTANCE.md.
