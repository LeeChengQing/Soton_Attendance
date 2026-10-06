# License Key Compatibility and Store Routing Design

## Goal

Fix compatibility between keys issued by the website and the browser extension/Device API, while preserving the intended storefront selections. The website's existing plaintext license display and Copy button remain the delivery flow; this change adds no QR features.

## User flows

### Storefront entry

- A direct visit without product-selection query parameters defaults to Complete experience bundle.
- The extension's Get License Key link includes `?product=mobile_notification&billing=semester`, selecting Mobile notifications · Semester.
- Query values initialize that visit only. Do not save a query-selected product as a persistent or site-wide default.
- Preserve current currency-specific storefront behavior.

### Activation and recovery

Users continue to copy the plaintext key from the website and paste it into either extension key field. Activation and recovery share one format-aware validation/canonicalization contract and the same key hash rules, so both paths locate the same existing license record. Pasting a key does not automatically activate it or request a verification code.

## Scope and repository constraints

- Website: `C:\Auto-Check Website`. Treat the current website generators and hash implementation as the source of truth. Preserve the existing uncommitted storefront changes; do not reset or overwrite unrelated work.
- Extension and Device API: `C:\自动打卡系统`. Preserve unrelated behavior.
- Keep existing activation restrictions, device binding/limits, entitlement checks, expiration/revocation checks, recovery challenge security, verification-code expiration, attempt limits, and rate limiting.
- Do not migrate or rewrite database hashes unless investigation proves it is necessary. Prefer reproducing the hash already present in the license inventory.

## Supported key formats and canonical forms

All handlers trim surrounding whitespace, validate the complete format, and use the format-specific canonical value below. Do not apply one legacy rule to every key.

1. **Legacy extension key** — 32 hexadecimal characters, optionally grouped as four 8-character blocks. Remove only the supported grouping hyphens, uppercase the hexadecimal characters, and hash the resulting 32-character value, preserving existing legacy behavior.
2. **China semester key** — `AC-CN-SEM-` plus 8–12 ASCII alphanumeric characters. Uppercase the full key before hashing, preserving existing behavior.
3. **Website standard key** — `AC-` plus twelve four-character hexadecimal groups separated by hyphens. Uppercase hexadecimal characters, preserve the required hyphens, and hash exactly the canonical form produced by the website's current `hashActivationCode`.
4. **Website international key** — exact prefix `AC-INTL-BNDL-`, `AC-INTL-MOBM-`, or `AC-INTL-MOBY-`, followed by 8–12 case-sensitive ASCII alphanumeric characters. Preserve the generated suffix's exact casing and hash the exact generated key because the website inventory generator hashes its raw value.

Increase both activation and recovery input limits to at least 64 characters. Disable browser auto-capitalization on both fields so international suffixes remain exact. Do not truncate pasted input, uppercase international keys, or silently remove unsupported interior characters.

## Device API contract

For both activation and recovery, use the same sequence:

```text
raw input → trim → detect format → validate → canonical key → SHA-256 → existing license lookup
```

The Device API hash must match the website inventory hash for each supported website format. Activation and recovery must not diverge in validation, normalization, or hashing. A found license continues through the existing device, entitlement, ownership, and recovery rules without weakening them.

Internally retain distinct failure categories where the current architecture supports them (invalid format, not found, expired/revoked, device limit, recovery disallowed, verification rate limit). Existing generic user-facing messages may remain. Do not log plaintext keys, canonical keys, verification codes, or recovery secrets; safe metadata may record key type and whether normalization/lookup succeeded.

## Error handling and backward compatibility

- A supported website key must not fail solely because it is longer than the legacy field limit, has website hyphens/prefixes, or has a case-sensitive international suffix transformed by the extension/API.
- Keep existing legacy keys working for activation and recovery.
- Keep existing activation/recovery verification and abuse protections unchanged.
- Do not send a verification code until the user presses the existing request action and current recovery rules allow it.

## Acceptance checks

- Direct website entry selects Complete experience bundle. The extension purchase link selects Mobile notifications · Semester. Query selection does not become the default on a later direct visit.
- Currency-specific selection and current plaintext key display/copy behavior remain intact.
- Tests prove canonicalization and hashes against the current website implementation for all four key formats, including grouped/ungrouped legacy forms, lowercase standard hex, and mixed-case international suffixes.
- Activation and recovery call the same normalization/hash contract and find the same corresponding license record for supported test keys.
- Activation and recovery inputs preserve the full key without truncation.
- Existing verification-code flow becomes reachable for previously activated supported keys when current rules permit, without bypassing challenge, ownership, expiry, retry, device, or rate-limit checks.
- No database hash migration occurs unless tests/inventory evidence proves it necessary.
- No QR generation, download, picker, scanning, camera, or QR-specific code is introduced.
- Relevant automated extension, Device API, website unit, and storefront E2E checks pass.

## Deployment dependency

Deploy the corrected Device API Edge Function after implementation and regression checks, then verify live activation/recovery lookup using authorized test keys. Treat the website and extension changes as one compatible release. The user-provided plan authorizes this deployment step; do not apply a database migration unless the implementation demonstrates it is necessary and the required schema path has been reviewed.
