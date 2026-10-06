# License Key QR and Store Routing Design

## Goal

After a payment is confirmed, show the delivered license key as a downloadable QR image that the extension can scan locally into either the activation or recovery field. Keep direct website visits on the Complete experience bundle selection; the extension's purchase link selects Mobile notifications · Semester.

## Scope

- Website repository: `C:\Auto-Check Website`.
- Extension and device API repository: `C:\自动打卡系统`.
- Preserve the website repository's existing uncommitted storefront changes and build on them without resetting or replacing them.
- Keep manual key entry available in both extension flows.

## User flows

### Website purchase selection

- A visit to the website with no product query defaults to `bundle` (Complete experience bundle).
- The extension's “Get License Key” link uses `?product=mobile_notification&billing=semester`, selecting Mobile notifications · Semester.
- These query values initialize that visit's selection only. Product and billing choices are not persisted as a site-wide default.
- Existing currency-specific purchase behavior remains intact.

### Payment receipt QR

- The success route continues to verify payment server-side and retrieve/decrypt the issued key as it does today.
- Show a QR only when the order status is confirmed paid and the issued key was retrieved successfully. Do not show a QR for pending, unverified, failed, locally simulated, or unavailable deliveries.
- Encode the exact raw license key as plain text in the QR. Do not encode an activation URL or send the key to a QR service.
- Display the QR beside the existing plaintext key and provide a PNG download action.
- If QR generation fails, preserve the current plaintext copy/manual-entry path and show a clear recoverable message. A QR failure must not invalidate the payment receipt or key delivery.

### Extension QR import

- Add a local image picker to both “activate new key” and “recover phone notifications” key inputs.
- Reuse the existing local `decodeQrFile` path. Validate the decoded payload as a supported license key, then prefill only the field whose image picker was used.
- Do not upload the selected image or decoded key, store it, activate the license, or send a recovery code automatically. The user continues with the existing explicit action button.
- Keep manual typing and pasting available. On an unreadable image, unsupported payload, or malformed key, explain the problem and leave the entered value intact so the user can try again or type the key.

## Key format and hashing contract

The extension and device API must accept and hash every key format currently issued by the website, while preserving existing extension keys:

1. Legacy extension keys: 32 hexadecimal characters, optionally grouped as four 8-character blocks. Canonical form is 32 uppercase hexadecimal characters without separators; hash this canonical value, as today.
2. China semester keys: `AC-CN-SEM-` followed by 8–12 ASCII alphanumeric characters. Canonical form is uppercase; hash this canonical value, as today.
3. Website standard keys: `AC-` followed by twelve 4-character uppercase hexadecimal groups separated by hyphens. Canonical form is uppercase with hyphens retained, matching the website's `hashActivationCode` behavior.
4. Website international keys: exact prefixes `AC-INTL-BNDL-`, `AC-INTL-MOBM-`, or `AC-INTL-MOBY-`, followed by 8–12 case-sensitive ASCII alphanumeric characters. Preserve exact casing when hashing because the website inventory generator hashes the raw generated value.

Trim surrounding whitespace before validation. Do not silently strip interior characters or separators from website formats. Increase activation and recovery text limits to at least 64 characters so standard website keys fit. Add tests proving the extension/API canonical hashes match the website's current generators, including lowercase characters in international suffixes.

## Error handling and privacy

- QR decoding runs in the extension locally, using the selected image only in memory.
- Only supported license-key payloads are accepted; arbitrary URLs, form links, or unrelated QR content are rejected without replacing the current field value.
- Malformed or unreadable QR input must not initiate network requests.
- Keep existing backend generic error behavior, rate limits, and recovery challenge flow unchanged.
- Do not log plaintext keys, QR payloads, generated QR data, or uploaded image contents.

## Acceptance checks

- Website direct entry selects the bundle; the extension link selects semester notifications; a prior query selection does not become a default on a later direct visit.
- A confirmed paid order with a successfully decrypted supported key displays a QR that decodes to that exact key and can be downloaded.
- Pending/unverified orders, unavailable key delivery, and local simulations never display a license QR.
- Both extension QR pickers prefill their respective key fields for every supported format; neither picker activates or sends a recovery request.
- Invalid images, undecodable images, arbitrary QR payloads, unsupported keys, and casing changes to case-sensitive international suffixes fail visibly while preserving manual entry.
- Existing legacy key activation/recovery paths remain compatible.
- Run the relevant extension unit/browser checks, device API key normalization tests, and website unit/E2E checks for receipt delivery and entry selection.

## Deployment dependency

Website QR rendering, extension image import, and the device API's key-format/hash support must ship as one compatible release. The device API implementation requires a deployed Edge Function before users can activate or recover website-issued keys.
