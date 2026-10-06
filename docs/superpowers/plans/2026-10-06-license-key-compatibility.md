# License Key Compatibility and Store Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all current website-issued keys work through extension activation and recovery while keeping direct website visits on the bundle and the extension link on semester notifications.

**Architecture:** Keep the website as the source of truth for key generation and canonical hashes. Use format-aware canonicalizers in the extension and Device API; route both server activation and recovery through one hash-from-raw-key helper. Preserve the website's existing query-seeded selection behavior and add regression tests around it.

**Tech Stack:** JavaScript browser extension, Deno 2 Supabase Edge Function, Next.js 16/React 19 website, Node test runner, Playwright, Supabase MCP.

**Spec:** `docs/superpowers/specs/2026-10-06-license-key-compatibility-design.md`

## Global Constraints

- The website's current key generators and hash implementation are the source of truth.
- Direct website visits without selection parameters default to Complete experience bundle; the extension link carries `?product=mobile_notification&billing=semester`; query choices are visit-specific.
- Preserve the existing currency-specific storefront behavior and plaintext license display/Copy button.
- Preserve existing uncommitted storefront changes in `C:\Auto-Check Website`; stage only task-owned files or hunks.
- Add no QR generation, download, picker, scanning, camera, or QR-specific functionality.
- Both activation and recovery trim surrounding whitespace and use the same format-specific validation, canonicalization, and hash contract.
- Legacy keys remove only supported grouping hyphens; China keys uppercase; standard website keys uppercase and retain hyphens; international website keys preserve exact generated suffix casing.
- Activation and recovery inputs accept at least 64 characters, do not truncate keys, and disable browser auto-capitalization.
- Preserve activation restrictions, device binding/limits, entitlement/expiry/revocation checks, recovery ownership/challenge checks, expiry, attempt limits, and rate limits.
- Do not log plaintext keys, canonical keys, verification codes, or recovery secrets.
- Do not rewrite/migrate activation-key hashes. Apply the existing recovery migration only because read-only production inspection confirmed its table and RPCs are absent.

## Review Focus

- A 62-character website standard key with hyphens reaches both extension requests intact and hashes with all separators preserved — Task 3 field/request regression and Task 4 hash vector.
- A mixed-case international suffix survives browser input and client/server normalization byte-for-byte — Task 2 normalization, Task 3 field, and Task 4 hash vector.
- Grouped and ungrouped legacy keys with surrounding whitespace produce the same legacy hash in activation and recovery — Task 2 and Task 4 tests.
- Unsupported prefixes, malformed group separators, invalid lengths, and non-key text are rejected before any device registration, recovery-state mutation, or network request — Task 2 and Task 3 tests.
- A previously activated key reaches the existing recovery challenge only when existing ownership and rate-limit rules allow it; no code is sent just by pasting — Task 3 recovery tests and Task 6 schema/API verification.

---

### Task 1: Lock website and extension purchase routing

**Files:**
- Create: `C:\Auto-Check Website\tests\checkout-e2e\product-entry.spec.ts`
- Read-only reference: `C:\自动打卡系统\tests\subscription-link.test.js`
- Read-only reference: `C:\Auto-Check Website\tests\admin-keys.test.ts` (already pins the website standard-key hash and hyphen-preserving format)
- Existing user-owned changes to preserve: `C:\Auto-Check Website\app\page.tsx`, `components\Homepage.tsx`, `components\SiteConfigProvider.tsx`, `tests\checkout-e2e\storefront.spec.ts`, `tests\storefront-settings.test.ts`

**Interfaces:**
- Consumes: website `hashActivationCode(code: string): string`; route query fields `product` and `billing`; extension `subscriptionCheckoutUrl(currency)`.
- Produces: regression coverage proving direct entry selects `bundle`, extension entry selects notification semester, and the query selection does not persist to a later direct visit.

- [ ] **Step 1: Add routing regression coverage**

  In the new Playwright spec, visit `/` and assert the bundle radio is selected. In the same browser context, visit `/?product=mobile_notification&billing=semester` and assert the notification radio and semester tab are selected; then return to `/` and assert the bundle is selected again. Cover desktop and mobile viewports.

- [ ] **Step 2: Confirm the existing standard website hash reference test**

  Preserve the existing `tests/admin-keys.test.ts` fixture, which asserts a fixed `hashActivationCode` digest for an uppercase, hyphen-preserving standard key. The Device API tests in Task 4 will use the matching key/hash fixture.

- [ ] **Step 3: Verify the extension's actual purchase URL source**

  Run `node --test tests/subscription-link.test.js` and inspect `src/subscription-link.js`. Assert that the RM URL points to the production website with exactly `product=mobile_notification` and `billing=semester`, and that the RMB destination stays unchanged. If the actual URL source is wrong or the test exposes a mismatch, update `src/subscription-link.js` to the correct production URL and adjust/add the focused test. This task explicitly permits repairing the real URL source; a passing test alone is not enough if the source points somewhere incorrect.

- [ ] **Step 4: Run focused tests**

  Run: `npm run test:e2e -- --config playwright.checkout.config.ts tests/checkout-e2e/product-entry.spec.ts`

  Run: `npx tsx --test tests/admin-keys.test.ts`

  Expected: all assertions pass, including the routing checks and the verified extension URL source.

- [ ] **Step 5: Repair only missing routing behavior**

  If routing tests fail, make the smallest change to `app/page.tsx`/selection initialization. Preserve the existing uncommitted diff and do not add product or billing persistence.

- [ ] **Step 6: Commit task-owned website tests/fixes**

  Stage only the new routing test, any narrowly reviewed website routing hunks, and the extension URL source/test if corrected. Do not stage the existing user-owned storefront files wholesale.

---

### Task 2: Add the extension's format-aware key canonicalizer

**Files:**
- Create: `src/license-key.js`
- Create: `tests/license-key.test.js`

**Interfaces:**
- Produces: `normalizeLicenseKey(value: unknown): string`, returning the exact canonical values defined by the spec and throwing `Error('invalid_activation_key')` for unsupported input.
- Later tasks consume `normalizeLicenseKey` for activation and recovery requests.

- [ ] **Step 1: Write tests for all supported forms**

  Cover trimmed legacy hex in grouped and ungrouped forms; mixed-case China semester keys; lowercase website-standard hex that canonicalizes to uppercase while retaining hyphens; exact-prefix international keys with mixed-case suffixes; and malformed values, unsupported prefixes, and separators.

- [ ] **Step 2: Run the focused test to verify it fails**

  Run: `node --test tests/license-key.test.js`

  Expected: FAIL because `src/license-key.js` does not yet export the normalizer.

- [ ] **Step 3: Implement `normalizeLicenseKey(value)`**

  Trim only surrounding whitespace. Detect the four formats in the spec. Remove hyphens only for the supported legacy grouped form; preserve all website-standard hyphens; uppercase only legacy, China, and standard keys; preserve the exact international suffix. Reject URLs, arbitrary text, invalid prefix case, malformed separators, and lengths outside the specified ranges.

- [ ] **Step 4: Run the focused test to verify it passes**

  Run: `node --test tests/license-key.test.js`

  Expected: PASS for every canonical value and rejection case.

- [ ] **Step 5: Commit the helper and tests**

  ```powershell
  git add tests/license-key.test.js src/license-key.js
  git commit -m "feat: normalize supported license key formats"
  ```

---

### Task 3: Use the canonicalizer for extension activation and recovery inputs

**Files:**
- Modify: `src/cloud.js`
- Modify: `src/options.html`
- Modify: `tests/cloud-entitlements.test.js`
- Create: `tests/cloud-recovery.test.js`
- Create: `tests/license-key-fields.test.js`

**Interfaces:**
- Consumes: `normalizeLicenseKey(value)` from Task 2.
- Produces: activation and recovery requests send the same canonical key; invalid input fails before device registration, recovery-state writes, network requests, or code delivery.

- [ ] **Step 1: Add request-path regression tests**

  Assert activation sends a website-standard canonical key unchanged (including hyphens), preserves international suffix case, and does not store the key. Assert recovery sends the same canonical string, preserves mixed case, and does not write pending recovery state or send a request for malformed input.

- [ ] **Step 2: Add input-field regression tests**

  Open `src/options.html`; assert both key inputs have `maxlength="64"` or higher and `autocapitalize="off"`. Type a 62-character standard website key into each field and assert the complete value remains present.

- [ ] **Step 3: Run focused tests to verify missing behaviors**

  Run: `node --test tests/cloud-entitlements.test.js tests/cloud-recovery.test.js tests/license-key-fields.test.js`

  Expected: new request and input assertions fail before implementation.

- [ ] **Step 4: Normalize before activation or recovery side effects**

  Import `normalizeLicenseKey` into `src/cloud.js`. Normalize before `ensureCloudDevice` in `redeemActivationKey`, and before recovery pending-state writes in `startPhoneSubscriptionRecovery`. Send only the canonical key. Retain server-side validation and existing recovery challenge behavior.

- [ ] **Step 5: Raise both key field limits and disable auto-capitalization**

  Set both key inputs to at least `maxlength="64"` and `autocapitalize="off"`; do not change verification-code input rules.

- [ ] **Step 6: Run focused tests to verify they pass**

  Run: `node --test tests/cloud-entitlements.test.js tests/cloud-recovery.test.js tests/license-key-fields.test.js`

  Expected: PASS; invalid input causes no registration/network or recovery-state side effect.

- [ ] **Step 7: Commit extension request and input changes**

  ```powershell
  git add src/cloud.js src/options.html tests/cloud-entitlements.test.js tests/cloud-recovery.test.js tests/license-key-fields.test.js
  git commit -m "fix: preserve website license keys in activation and recovery"
  ```

---

### Task 4: Align Device API validation and hashing with website inventory

**Files:**
- Modify: `supabase/functions/_shared/activation.ts`
- Modify: `supabase/functions/_shared/activation.deno.ts`
- Modify: `supabase/functions/device-api/index.ts`

**Interfaces:**
- Produces: `normalizeActivationKey(value: unknown): string` and `hashActivationKeyInput(value: unknown): Promise<string>`.
- Both `redeemActivationKey` and `startPhoneSubscriptionRecovery` consume `hashActivationKeyInput` so they cannot drift in normalization or hashing.

- [ ] **Step 1: Add Deno regression vectors**

  Test the four key formats, surrounding whitespace, grouped/ungrouped legacy parity, hyphen-preserving standard canonicalization, exact mixed-case international preservation, and fixed hash values copied from the website's known-good hash vectors. Hard-code each expected digest from the website's fixtures or independently verified generator output; never compute expected values dynamically by calling the backend or shared implementation under test. Update the old test that rejects surrounding whitespace to assert it is trimmed.

- [ ] **Step 2: Run backend tests to verify failure**

  Run: `npm run test:backend`

  Expected: FAIL for website-standard and international formats, and for the new shared hash helper.

- [ ] **Step 3: Implement format-aware normalization and hashing**

  Expand the normalized-key validators for standard and international formats. Add `hashActivationKeyInput(value)` to normalize once and hash the canonical value. Preserve the legacy and China canonical rules. Change both API operations to use this helper and keep invalid-key responses generic as they are today.

- [ ] **Step 4: Re-run backend tests**

  Run: `npm run test:backend`

  Expected: PASS for key-format vectors and existing entitlement/reliability tests. The assertions must compare against fixed Website-known digests (including the standard key fixture already pinned in `tests/admin-keys.test.ts` and hard-coded values for the remaining formats), not values generated at test runtime from the code under test.

- [ ] **Step 5: Commit the Device API source and tests**

  ```powershell
  git add supabase/functions/_shared/activation.ts supabase/functions/_shared/activation.deno.ts supabase/functions/device-api/index.ts
  git commit -m "fix: hash website license formats consistently"
  ```

---

### Task 5: Run complete local regression and build checks

**Files:**
- Verify changes from Tasks 1–4 across both repositories.

- [ ] **Step 1: Run extension tests and build checks**

  Run in `C:\自动打卡系统`: `npm test`, `npm run test:backend`, `npm run build`, and `npm run smoke`.

  Expected: all commands exit successfully and the build output contains the updated extension.

- [ ] **Step 2: Run website tests and typecheck**

  Run in `C:\Auto-Check Website`: `npm test`, `npm run typecheck`, and `npm run test:e2e -- --config playwright.checkout.config.ts tests/checkout-e2e/product-entry.spec.ts`.

  Expected: all unit/type checks pass; direct and extension-query storefront selections pass in desktop and mobile viewports.

- [ ] **Step 3: Review diffs and repository status**

  Confirm the website's pre-existing uncommitted files remain intact and are not accidentally staged. Confirm no QR-related code and no activation-key hash rewrite or unrelated change was introduced.

- [ ] **Step 4: Fix any regression and rerun its owning test**

  Do not deploy while any local check is failing.

---

### Task 6: Apply the necessary recovery schema and deploy the Device API

**Files:**
- Existing migration: `supabase/migrations/20261002080603_phone_subscription_recovery.sql` (apply only; do not rewrite activation-key hashes).
- Conditional performance follow-up: `supabase/migrations/20261006035442_phone_subscription_recovery_device_index.sql` (add only if the Supabase advisor reports the new table's `device_id` foreign key is unindexed).
- Deploy source: `supabase/functions/device-api/index.ts`, `supabase/functions/device-api/deno.json`, and its imported `_shared` modules.
- Production project: `[CHINA] AutoCheck-DB`, ref `qckpwckfukyurkobrsig`.

**Interfaces:**
- Consumes: passing local checks from Task 5 and the user's conditional authorization to apply a migration only when required.
- Produces: recovery table/RPCs present in production and a deployed Device API version that uses the new key contract.

- [ ] **Step 1: Reconfirm production prerequisites read-only**

  Verify the target project ref/name, whether `private.phone_subscription_recovery_challenges` and both recovery RPCs exist, and the current `device-api` version. The initial read-only inspection found the table/RPCs absent and `device-api` at v9; repeat before mutation.

- [ ] **Step 2: Apply only the existing recovery migration if still absent**

  Use Supabase MCP `apply_migration` on `qckpwckfukyurkobrsig` with the contents of the existing migration and name `phone_subscription_recovery`. Do not run a key-hash migration. If the table and RPCs have appeared since inspection, skip this step. The conditional index migration belongs only to Step 3 when confirmed by the advisor.

- [ ] **Step 3: Verify recovery schema and security settings read-only**

  Confirm the table and both RPC signatures exist, RLS is enabled, and only `service_role` can execute the RPCs. Run Supabase security and performance advisors after the DDL change. If the new table's `device_id` foreign key is reported without an index, add and apply the narrow follow-up index migration, then rerun the performance advisor. Do not change any license-key hashes.

- [ ] **Step 4: Deploy the Device API first**

  Use the Supabase MCP Edge Function deployment tool to upload `device-api/index.ts`, `device-api/deno.json`, and every relative `_shared` dependency. Keep `verify_jwt=false` because the existing function uses its own authenticated device-token contract; do not alter that authentication mode.

- [ ] **Step 5: Verify deployed function version and safe smoke behavior**

  Confirm `device-api` is active at a version newer than v9. Use only a designated test license/device for any live activation or recovery request; never consume a customer key or send a recovery code to a customer as a test. If no designated test fixture exists, stop at deployment/schema checks and report live lookup as unverified.

---

### Task 7: Publish the extension after the backend is active

**Files:**
- Update: `docs/releases/v1.0.0.md`
- Build: `outputs/Soton-Auto-Check-v1.0.0-latest-Windows-macOS.zip`
- Publish: existing GitHub `V1.0.0 Release` for `cqcq-bot/Soton_Attendance`

**Interfaces:**
- Consumes: completed Task 6 and verified active Device API deployment.
- Produces: one updated extension ZIP attached to the existing release, with the release date set to the current Malaysia date and no older assets remaining.

- [ ] **Step 1: Update release notes for the current Malaysia date**

  Record the actual release date in `Asia/Kuala_Lumpur` and summarize the website key-format compatibility, activation/recovery normalization fix, and corrected Mobile notifications · Semester extension entry. Do not claim live recovery delivery was verified unless a designated test fixture was available and safely used.

- [ ] **Step 2: Build and inspect the release candidate**

  Run `npm run release` only after Task 6 confirms the Device API is active. Inspect the package manifest, included files, ZIP name, and SHA-256 sidecar. Do not publish a package before the backend deployment is complete.

- [ ] **Step 3: Replace the existing release assets**

  Update the existing `V1.0.0 Release` body/date, remove all previously attached assets, and attach only the newly built `Soton-Auto-Check-v1.0.0-latest-Windows-macOS.zip`. Do not move or force-update the existing release tag.

- [ ] **Step 4: Verify the published result**

  Read the release back from GitHub and confirm its date/body and that exactly one asset remains with the expected filename. Download or otherwise verify its published SHA-256 against the local package before reporting completion.

> **Deployment order is mandatory: Device API/backend first, extension package/release second.**

---

## Handoff

This work crosses two repositories and has a production API/schema step, but its code paths share a single normalization contract and should be reviewed together. The recommended execution method is **Native**: implement the tasks sequentially in this session, then perform one independent whole-change review before considering the work complete.
