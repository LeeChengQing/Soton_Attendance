# Phone Subscription Recovery Design

## Goal

Let a customer restore a previously redeemed phone-notification subscription after reinstalling the Chrome extension, without allowing possession of the activation key alone to take over that subscription.

## Approved user flow

1. On a fresh extension install with no saved cloud credentials, show a choice to activate a new key or recover an existing subscription. Do not register a replacement device or upload a schedule snapshot before that choice.
2. For recovery, the user enters the original redeemed phone-notification key and requests a verification notification.
3. The server sends a six-digit, one-time code to the ntfy topic already stored for the device linked to that redeemed key. The extension never supplies or receives the old topic before verification.
4. The user enters the code. On successful verification, the server rotates the device credentials on the original device row and returns the existing device ID, existing ntfy topic, and current entitlement state.
5. The activation key remains redeemed; entitlement status and expiry are unchanged. The old extension credential stops working.

The code is delivered in ntfy, not by SMS. No phone number is collected.

## Security and lifecycle rules

- Accept recovery only for a non-revoked key whose status is `redeemed` and whose `redeemed_device_id` still identifies the source device.
- Generate the code with a cryptographically secure random generator. Use six decimal digits, a 30-minute expiry, and a keyed HMAC-SHA-256 digest in storage; do not store or log the plaintext code, raw key, bearer token, or old ntfy topic.
- A new challenge invalidates earlier challenges for the same key. Allow one resend per 60 seconds, no more than five sends per hour and ten per 24 hours per redeemed key. Permit at most five verification attempts per challenge; then require a new challenge.
- The server looks up the old ntfy topic using the redeemed key's server-side device relation. It sends only a generic recovery message over HTTPS and never accepts a caller-provided topic.
- Keep ntfy's normal caching behavior for delivery resilience. The application rejects a code after 30 minutes, even if ntfy still shows the cached message. A resend invalidates prior codes.
- Start and completion operations use narrow service-role-only database functions. The recovery endpoints have no Supabase user session, so the Edge Function must enforce all application authentication, validation, rate limits, and generic error responses itself.
- Complete the recovery transactionally: lock the challenge, key, and source device; consume the challenge once; rotate the source device's `device_key` and `auth_token_hash`; preserve its `devices.id`, ntfy topic, entitlement row, expiry, schedules, logs, and notifications. Make a retry with the same new credentials idempotent if the response was lost after commit.
- Do not call the activation redemption function during recovery and do not insert, extend, or reactivate an entitlement. A legitimately expired entitlement stays expired.
- If the old ntfy subscription is unavailable, show a support fallback. Do not fall back to key-only recovery.

## Fresh-install and schedule-sync behavior

The current extension starts schedule processing on install and can enqueue a cloud schedule snapshot. A fresh install has no local student profile, QR/Form bindings, or timetable, and the existing sync endpoint is upload-only. Therefore:

- Gate cloud registration and snapshot delivery until the user chooses new activation or existing-subscription recovery.
- On recovery, remove stale pre-recovery `sync` queue entries and do not upload an empty first-install snapshot over the old server-side schedule.
- Keep the original server-side schedule while the new installation has no locally reconstructed schedule. Upload again after the user imports/configures courses; local student profile and bindings are not restored by this feature and may need a local backup or re-entry.
- Existing users who still have valid local cloud credentials keep the current behavior.

## Bottom operation dock

The primary users run desktop Chrome on Windows or macOS. Enlarge the fixed bottom `操作` toggle and workflow action buttons for desktop use: wider controls, more horizontal padding, clear spacing, and a roomier panel that avoids cramped wrapping at common laptop/desktop widths. Preserve existing button labels and behavior. Keep a functional responsive layout on smaller screens, but desktop is the primary design and acceptance target.

## Out of scope

- SMS, phone-number collection, email accounts, multi-device sharing, automatic cloud restoration of student profile/bindings, changing activation-key expiry rules, and deployment to the live Supabase project.

## Acceptance criteria

- Used key alone cannot recover or rotate credentials.
- Correct code received on the old ntfy subscription restores the same server device identity and phone topic, leaves the entitlement expiry unchanged, and invalidates the old bearer token.
- Wrong, expired, replayed, revoked-key, and rate-limited attempts do not rotate credentials or reveal the old topic.
- Fresh-install startup does not create a new device or overwrite the old schedule before the user chooses a path.
- Recovery never re-redeems the key or creates a second entitlement.
- At common Mac/Windows desktop widths, the bottom dock and action controls are visibly wider, easier to hit, and not cramped; smaller screens retain a usable fallback layout.
