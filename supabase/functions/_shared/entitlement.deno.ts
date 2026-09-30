import { gatePhoneNotification, hasActivePhoneEntitlement } from "./entitlement.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}

const NOW = Date.parse("2026-10-01T12:00:00.000Z");

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    status: "active",
    phone_notifications: true,
    starts_at: "2026-10-01T12:00:00.000Z",
    expires_at: "2026-10-02T16:00:00.000Z",
    ...overrides,
  };
}

Deno.test("phone entitlement is active at its start and before its exclusive expiry", () => {
  assertEquals(hasActivePhoneEntitlement(entitlement(), NOW), true);
  assertEquals(hasActivePhoneEntitlement(entitlement({ starts_at: "2026-10-01T11:59:59.999Z" }), NOW), true);
});

Deno.test("phone entitlement is inactive at expiry, before start, or without phone permission", () => {
  assertEquals(hasActivePhoneEntitlement(entitlement({ expires_at: "2026-10-01T12:00:00.000Z" }), NOW), false);
  assertEquals(hasActivePhoneEntitlement(entitlement({ starts_at: "2026-10-01T12:00:00.001Z" }), NOW), false);
  assertEquals(hasActivePhoneEntitlement(entitlement({ phone_notifications: false }), NOW), false);
});

Deno.test("phone entitlement is inactive when revoked, expired, or malformed", () => {
  assertEquals(hasActivePhoneEntitlement(entitlement({ status: "revoked" }), NOW), false);
  assertEquals(hasActivePhoneEntitlement(entitlement({ status: "expired" }), NOW), false);
  assertEquals(hasActivePhoneEntitlement(null, NOW), false);
  assertEquals(hasActivePhoneEntitlement(entitlement({ expires_at: "not-a-date" }), NOW), false);
});

Deno.test("phone delivery gate records the denial and returns false for an expired entitlement", async () => {
  let denials = 0;
  const allowed = await gatePhoneNotification(
    entitlement({ expires_at: "2026-10-01T12:00:00.000Z" }),
    NOW,
    () => { denials += 1; },
  );
  assertEquals(allowed, false);
  assertEquals(denials, 1);
});

Deno.test("phone delivery gate allows an active entitlement without recording a denial", async () => {
  let denials = 0;
  const allowed = await gatePhoneNotification(entitlement(), NOW, () => { denials += 1; });
  assertEquals(allowed, true);
  assertEquals(denials, 0);
});
