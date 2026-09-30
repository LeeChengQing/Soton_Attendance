# 368FK 商品与手机提醒密钥激活 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell first-term and renewal phone-notification entitlements through 368FK stock keys and redeem each key once in the extension.

**Architecture:** A Node CLI creates plaintext shop-stock codes and a separate SHA-256-only Supabase import file. Supabase stores each code hash, atomically redeems it for the authenticated device, and keeps one current entitlement per device. `notification-worker` remains the server-side gate for ntfy delivery; the extension only opens the shop page, submits a key, and displays the server's entitlement result.

**Tech Stack:** Node.js built-in `node:crypto`, Node test runner, Supabase Postgres migrations/RPC, Supabase Edge Functions (Deno/TypeScript), Chrome extension JavaScript/HTML/CSS, esbuild.

**Spec:** `docs/superpowers/specs/2026-10-01-shop-key-activation-design.md`

## Global Constraints

- 学期截止日期按 `Asia/Kuala_Lumpur` 当天结束处理；数据库保存次日 00:00 的排他 `expires_at`。
- 密钥格式固定为四组各八位十六进制字符；兑换时忽略大小写，只移除连字符后再计算哈希。
- “保留现有 ¥10 插件商品，不修改价格或内容。”
- “新建 ¥12 首学期套餐（`bundle`）和 ¥5/学期手机提醒续期商品（`phone_notifications`）。”
- “每学期为各商品生成一批密钥；生成批次时指定该学期的固定截止日期。”
- “第一版不接 368FK 支付 API 或订单 webhook。”
- “本机自动打卡不读取手机提醒授权，不因缺少、撤销或到期的提醒权限而停止。”
- “不把 service-role key 放入扩展。”
- Each key is a high-entropy, single-use secret; only its SHA-256 hash is stored in Supabase.
- Keep one current entitlement row per device. An active renewal sets the expiry to the later of the existing expiry and the key batch's semester end date.
- Do not change existing schedules, Forms bindings, attendance logs, notification preferences, ntfy subscriptions, or outbox history.

## Review Focus

- Same key submitted concurrently or from two devices: exactly one redemption succeeds; the other gets a used-key error (Task 2).
- Wrong, malformed, revoked, and semester-expired keys: no entitlement is created or extended (Tasks 1–3).
- Renewal key for a later semester: extends the current device entitlement without making reminders stop between terms or creating a second entitlement row (Task 2).
- `starts_at = now` is allowed but `expires_at = now` is not; future-start, expired, revoked, or non-phone entitlements never reach ntfy (Tasks 3–4).
- Changing extension storage or request fields cannot grant server permission; local check-in still works without a phone entitlement (Tasks 3 and 5).

---

## File Map

- Create `scripts/generate-activation-keys.mjs`: generate one semester's plaintext stock and hash import files using Node's built-in crypto.
- Modify `.gitignore` and `package.json`: ignore local key batches and expose the generator command.
- Create `test/activation-keys.test.js`: verify generated codes, hashes, and input validation.
- Create the CLI-generated `supabase/migrations/*_shop_activation_keys.sql`: `activation_keys`, `entitlements`, RLS, and the atomic redemption RPC.
- Create `supabase/tests/shop_activation_keys_test.sql`: database behavior for valid, invalid, reused, expired, and renewing keys.
- Create `supabase/functions/_shared/activation.ts` and `entitlement.ts`: key normalization/hash and active-phone-entitlement predicate shared with Edge Functions.
- Create `supabase/functions/_shared/activation.deno.ts` and `entitlement.deno.ts`: Deno unit tests for those pure rules.
- Modify `supabase/functions/device-api/index.ts`: authenticated status and redeem actions.
- Modify `supabase/functions/notification-worker/index.ts`: enforce the shared entitlement predicate before ntfy.
- Modify `src/cloud.js`, `src/options.html`, `src/options.js`, and `src/options.css`: store-page link, key entry, activation, and status display.
- Modify `README.md` if needed to document the new user-facing phone-reminder purchase and redemption flow.
- Regenerate tracked `extension/` using `npm run build`; do not hand-edit generated output.

## Implementation Tasks

### Task 1: Generate paired shop and Supabase key batches

**Files:**
- Create: `scripts/generate-activation-keys.mjs`
- Modify: `.gitignore`
- Modify: `package.json`
- Test: `test/activation-keys.test.js`

**Interfaces:**
- `generateActivationBatch({ count, plan, termEnd })` returns `{ shopCodes, importRows }` where every import row contains `key_hash`, `plan`, and `term_expires_at`; no import row contains plaintext.
- `termEnd` is an ISO `YYYY-MM-DD` date interpreted in `Asia/Kuala_Lumpur`; `term_expires_at` is the exclusive instant at 00:00 the following day.
- CLI: `npm run keys:generate -- --count <N> --plan <bundle|phone_notifications> --term-end <YYYY-MM-DD>`.
- Files are written under ignored `activation-key-batches/`; refuse to overwrite a batch with the same plan/end-date filename.

- [x] **Step 1: Write tests** for valid plan/count/date, unique formatted codes, SHA-256 matching normalized codes, and invalid input rejection.
- [x] **Step 2: Run `npm test -- --test-name-pattern=activation-batch`** and confirm the new cases fail.
- [x] **Step 3: Implement** `generateActivationBatch()` with `node:crypto`; generate 128 random bits per key, format keys for manual entry, hash the normalized form, and create separate plaintext and hash-only outputs.
- [x] Format codes as `8-8-8-8` hexadecimal groups and convert the inclusive term-end date to the next midnight in `Asia/Kuala_Lumpur` for `term_expires_at`.
- [x] **Step 4: Add** `keys:generate` to `package.json` and `/activation-key-batches/` to `.gitignore`.
- [x] **Step 5: Run `npm test -- --test-name-pattern=activation-batch`** and confirm the generator cases pass.

### Task 2: Add secure, atomic key redemption in Postgres

**Files:**
- Create: `supabase/migrations/20260930174454_shop_activation_keys.sql` (generated by `supabase migration new`)
- Create: `supabase/tests/shop_activation_keys_test.sql`

**Interfaces:**
- `public.redeem_activation_key(p_key_hash text, p_device_id uuid) returns jsonb`; expected success fields: `plan`, `starts_at`, `expires_at`; expected failure codes: `invalid_activation_key`, `activation_key_used`, `activation_key_revoked`, `activation_key_expired`.
- `activation_keys` stores a unique hash, plan, exclusive semester expiry timestamp, available/redeemed/revoked status, redemption device/time, creation time, and admin note.
- `entitlements.device_id` remains the primary key; the RPC grants `phone_notifications = true` and `source = 'shop'`.

- [x] **Step 1: Write database cases** for first redemption, invalid hash, expired key, revoked key, repeated redemption, expired-entitlement reactivation, and later-term renewal preserving the active entitlement.
- [ ] **Step 2: Run the Supabase database tests** and confirm the cases fail before the migration exists.
- [x] **Step 3: Implement the migration** with table constraints, expiry indexes, `updated_at` trigger, RLS deny-direct policies, and direct grants revoked for `anon`/`authenticated`.
- [x] **Step 4: Implement the RPC transaction**: lock the matching key row; reject unavailable or expired keys; mark one valid key redeemed; insert/update the single device entitlement. For an active entitlement, retain its start and set `expires_at = greatest(current expires_at, term_expires_at)`; for absent/expired/revoked entitlements, start now and use the key's `term_expires_at`.
- [x] Set the entitlement's `plan` to the most recently redeemed key's plan.
- [ ] **Step 5: Restrict RPC execution** to the backend service role and rerun the database cases; confirm each case passes.

### Task 3: Add authenticated status and redemption API actions

**Files:**
- Create: `supabase/functions/_shared/activation.ts`
- Create: `supabase/functions/_shared/entitlement.ts`
- Create: `supabase/functions/_shared/activation.deno.ts`
- Create: `supabase/functions/_shared/entitlement.deno.ts`
- Modify: `supabase/functions/device-api/index.ts`

**Interfaces:**
- `normalizeActivationKey(value: unknown): string` accepts exactly 32 hexadecimal characters with optional hyphens at the generated group boundaries, case-insensitively; it strips hyphens and rejects all other separators.
- `hashActivationKey(normalized: string): Promise<string>` returns lowercase SHA-256 hex.
- `hasActivePhoneEntitlement(entitlement, nowMs): boolean` checks active status, phone permission, `starts_at <= now`, and `expires_at > now`.
- `entitlement-status` returns only the authenticated device's `{ entitlement: null | { plan, status, phoneNotifications, startsAt, expiresAt } }`; report `expired` when a stored active entitlement has reached its exclusive expiry timestamp.
- `redeem-activation-key` accepts only the key string; device ID, plan, and expiry come from the authenticated token and RPC/database.

- [x] **Step 1: Write Deno unit cases** for normalization, hash determinism, malformed input, active expiration boundaries, future start, revocation, and missing phone permission.
- [x] **Step 2: Run `deno test supabase/functions/_shared/activation.deno.ts supabase/functions/_shared/entitlement.deno.ts`** and confirm the cases fail.
- [x] **Step 3: Implement** the shared pure helpers and make those cases pass.
- [x] **Step 4: Add** both API actions; authenticate before reading status or hashing/redeeming a key, call the RPC with the authenticated device ID, and map RPC errors to the documented JSON errors.
- [x] **Step 5: Run** `deno test supabase/functions/_shared/activation.deno.ts supabase/functions/_shared/entitlement.deno.ts` and `deno check supabase/functions/device-api/index.ts`.
- [x] **Step 6: Review** that no API action accepts client-supplied entitlement fields or writes `entitlements` outside the RPC.

### Task 4: Gate ntfy delivery on server entitlement

**Files:**
- Modify: `supabase/functions/notification-worker/index.ts`
- Reuse: `supabase/functions/_shared/entitlement.ts`

**Interfaces:**
- Before topic lookup or network send, load the device entitlement and call `hasActivePhoneEntitlement(entitlement, Date.now())`.

- [x] **Step 1: Add** the entitlement lookup before ntfy subscription lookup.
- [x] **Step 2: When unauthorized**, update only `last_error = 'subscription_required'`, keep `sent_at` null, and continue without calling ntfy.
- [x] **Step 3: Run** `deno check supabase/functions/notification-worker/index.ts`; review that authorized sends retain the existing topic validation and message body.

### Task 5: Add purchase, key activation, and status UI

**Files:**
- Modify: `src/cloud.js`
- Modify: `src/options.html`
- Modify: `src/options.js`
- Modify: `src/options.css`
- Modify: `README.md` if needed

**Interfaces:**
- `getEntitlementStatus()` calls the authenticated status action.
- `redeemActivationKey(activationKey)` calls the authenticated redemption action and returns the server result.
- Both purchase links initially target `https://shop.368fk.cn/shop/CFI5VKXO`; replace each separately when the new 368FK product URLs are supplied.

- [x] **Step 1: Add** the two cloud client methods without storing the entered key or accepting local entitlement state.
- [x] **Step 2: Add** ¥12 `bundle` and ¥5-per-term `phone_notifications` descriptions and purchase links; leave the existing ¥10 shop item untouched and out of the reminder purchase flow.
- [x] **Step 3: Add** a key field and activation button. Submit only the entered key; clear the field after success or failure; show server error text safely as text.
- [x] **Step 4: Add** status refresh on page load and the “刷新授权” action; display active/expired/revoked states and the semester end date. Keep ntfy topic text clear that a topic alone does not unlock delivery.
- [x] **Step 5: Review** that no local storage field, schedule handler, or automatic check-in path can grant or remove server phone access.

### Task 6: Build the extension and verify acceptance behavior

**Files:**
- Regenerate: `extension/` from `src/`
- Modify: `README.md` if not already updated in Task 5

- [ ] **Step 1: Run** the existing Node test suite and Deno unit/database checks from Tasks 1–4.
- [x] **Step 2: Run `npm run build`** and confirm the generated settings page and scripts include the new UI while containing no plaintext stock file or service-role key.
- [ ] **Step 3: In a non-production Supabase environment**, import a short test batch and verify: one key activates one device; the same key cannot activate a second device; an unentitled outbox row gets `subscription_required` and remains unsent; an active entitlement delivers; an expired entitlement is blocked.
- [x] **Step 4: Confirm** existing local schedules, Forms bindings, attendance logs, ntfy subscriptions, and automatic check-in behavior remain intact.

## Store Operations Outside This Code Change

- The code does not create, edit, or publish 368FK products and does not access the merchant account.
- Before selling, upload each generated plaintext batch to the matching product's auto-delivery stock and import its hash-only CSV to Supabase. Keep the plaintext batch out of Git and share it only with the store inventory workflow.
- Replace the two temporary shop-page links with the new ¥12 and ¥5 product URLs once those listings exist.
