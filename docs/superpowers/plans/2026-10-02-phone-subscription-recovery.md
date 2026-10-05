# Phone Subscription Recovery and Bottom Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore an existing phone-notification subscription after extension reinstall using the original key plus a one-time code sent to its existing ntfy topic, and enlarge the bottom operation dock controls.

**Architecture:** Add server-side, one-time recovery challenges and transactional credential rotation on the original device row. Expose recovery through the existing device API and extension options UI, while gating fresh-install cloud registration/sync until the customer chooses recovery or new activation. Preserve the old server schedule until the fresh install has a locally reconstructed schedule.

**Tech Stack:** Chrome Manifest V3 extension (JavaScript), Supabase Edge Functions (Deno/TypeScript), PostgreSQL migration/RPCs, ntfy HTTPS publish API, CSS.

**Spec:** `docs/superpowers/specs/2026-10-02-phone-subscription-recovery-design.md`

## Global Constraints

- Recovery uses the original redeemed key plus a code sent only to the stored old ntfy topic; no SMS or phone number.
- Code: 6 digits, 30-minute expiry, maximum 5 attempts per challenge, 60-second resend cooldown, 5 sends/hour and 10 sends/day per key.
- Recovery rotates credentials on the same device row; it never re-redeems a key or changes entitlement dates.
- Do not expose service-role credentials, raw codes, raw keys, bearer tokens, or the old topic to logs or unauthenticated clients.
- A fresh install must not register a new cloud device or upload an empty schedule snapshot before the customer chooses recovery/new activation.
- Preserve existing uncommitted work; do not deploy migrations or Edge Functions to the live Supabase project in this change.
- Preserve the existing 2.5.5 candidate ZIP, checksum, and provenance as a recoverable backup before replacing them with the updated package.
- Prioritize wider, roomier bottom dock controls for desktop Chrome on Windows/macOS; retain a usable smaller-screen fallback without treating mobile as the primary target.

## Review Focus

1. A redeemed key with an incorrect, expired, replayed, or revoked challenge cannot rotate credentials.
2. A resend invalidates all earlier codes and respects per-key limits.
3. A lost HTTP response after a successful database commit can be retried only with the same replacement credentials.
4. A clean install cannot upload an empty snapshot over the original cloud schedule before recovery or explicit new activation.
5. At common laptop/desktop widths, the dock controls are visibly wider and do not wrap into a cramped layout; smaller widths retain a usable fallback.

---

### Task 1: Database-backed recovery challenge and atomic rebind

**Files:**
- Create: Supabase migration generated with `supabase migration new phone_subscription_recovery`
- Reference: `supabase/migrations/20260930174454_shop_activation_keys.sql`
- Reference: `supabase/migrations/0001_attendance_backend.sql`

**Interfaces:**
- `begin_phone_subscription_recovery(p_key_hash, p_target_device_key, p_target_token_hash, p_code_hmac)` returns a private Edge Function payload containing a challenge ID and old topic, or a generic rejection.
- `complete_phone_subscription_recovery(p_challenge_id, p_code_hmac, p_target_token_hash)` returns the original device ID, topic, and entitlement status only after transactional verification; the challenge already binds the redeemed key and replacement device key.

- [x] Add a private challenge table with source device/key hash, target device key/token hash, HMAC digest, attempts, expiry, send timestamps, and consumed state.
- [x] Enable RLS, deny direct anon/authenticated access, revoke function execute from PUBLIC/anon/authenticated, and grant only service_role; use fixed empty search paths and fully qualified objects.
- [x] Implement per-key send limits and single-use attempt/expiry checks with row locks.
- [x] Rotate only credentials on the original device row; preserve its foreign-key identity and entitlement/schedule/topic data; make completion idempotent for the same target credentials.
- [x] Review the migration for grants, RLS, transactional behavior, and unintended entitlement writes.

### Task 2: Edge Function recovery API and ntfy delivery

**Files:**
- Modify: `supabase/functions/device-api/index.ts`
- Reference: `supabase/functions/_shared/activation.ts`
- Reference: `supabase/config.toml`

**Interfaces:**
- `action: "recovery-start"` accepts the activation key and replacement credentials, creates a challenge, and sends a generic code to the server-looked-up ntfy topic.
- `action: "recovery-complete"` accepts challenge ID and code; the replacement bearer token is supplied for its stored token hash. The activation key is not sent again.

- [x] Add secure code generation and HMAC-SHA-256 digesting using a server-only secret already available to the function.
- [x] Hash/normalize activation keys using the existing helper; never log request bodies, code, key, topic, or bearer value.
- [x] Publish only to the topic returned by the restricted database function; use HTTPS, generic title/body, and no personal data.
- [x] Return generic responses for invalid/unknown/revoked keys and challenges; return the topic only after successful completion.
- [x] Add router cases without weakening existing device-token authentication for existing actions.

### Task 3: Extension recovery flow and fresh-install sync gate

**Files:**
- Modify: `src/cloud.js`
- Modify: `src/cloud-client.js`
- Modify: `src/background.js`
- Modify: `src/options.html`
- Modify: `src/options.js`
- Modify: `src/options.css`

**Interfaces:**
- `startPhoneSubscriptionRecovery(activationKey)` generates and stores a pending replacement identity, sends its device-key/token hashes with the key to `recovery-start`, and does not register a new device or persist the activation key.
- `completePhoneSubscriptionRecovery(challengeId, code)` completes rebind using the challenge-bound replacement credentials and persists the returned original device ID/topic plus replacement credentials.

- [x] On a fresh install, prevent automatic cloud registration/draining until the customer chooses recovery or new activation; keep local attendance behavior available.
- [x] Keep the existing activation flow as the explicit new-device path.
- [x] Add a recovery form with separate send-code and verify-code states, resend cooldown, clear expiry/attempt errors, and ntfy-only explanation.
- [x] After successful recovery, clear pending/stale sync entries and preserve the prior server schedule until local courses are reconstructed; never send a blank first-install snapshot.
- [x] Keep entitlement expiry unchanged and refresh the subscription status after recovery.
- [x] Preserve current behavior when a valid cloud identity already exists.

### Task 4: Enlarge the desktop-first bottom operation dock

**Files:**
- Modify: `src/options.css`

- [x] Increase the dock toggle and action-button minimum height, font size, horizontal padding, and minimum widths for desktop use.
- [x] Widen the desktop panel and adjust gaps so action buttons have comfortable spacing at common Mac/Windows laptop widths.
- [x] Keep the existing compact two-column mobile fallback usable without changing button order or actions.

### Task 5: Non-test verification and handoff

**Files:**
- Review only: files above

- [x] Review the dock at common desktop viewport sizes and confirm controls are not cramped; run syntax/static validation only, without adding or running test suites unless explicitly requested.
- [x] Inspect the migration diff and `git diff` to ensure all pre-existing dirty files remain intact and unrelated changes are untouched.
- [x] Report that live Supabase migration/function deployment remains a separate step and identify any required deployment secret or setup.

### Task 6: Build and verify the 2.5.5 Windows/macOS ZIP

**Files:**
- Regenerate: `extension/`
- Replace after backup: `outputs/Soton-Auto-Check-v2.5.5-candidate-Windows-macOS.zip`
- Replace after backup: ZIP checksum and candidate provenance

- [x] Back up the existing extension output and 2.5.5 package metadata to a uniquely named folder under `outputs/`.
- [x] Rebuild the extension from `src/` and package with the existing deterministic candidate packager; do not run the `candidate` npm script because it invokes the test suite.
- [x] Verify ZIP contents, manifest version, SHA-256, package provenance, and inclusion of recovery UI while ensuring no server secret is packaged.
- [x] Return the updated ZIP path and state clearly that Supabase deployment was not performed.
