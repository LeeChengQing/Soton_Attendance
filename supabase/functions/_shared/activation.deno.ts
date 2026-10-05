import { hashActivationKey, normalizeActivationKey } from "./activation.ts";

function assertEquals(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
}

function assertThrows(callback: () => unknown) {
  try {
    callback();
  } catch {
    return;
  }
  throw new Error("expected callback to throw");
}

Deno.test("activation key normalization accepts grouped or ungrouped hex case-insensitively", () => {
  const raw = "0123456789abcdef0123456789abcdef";
  assertEquals(normalizeActivationKey(raw), raw.toUpperCase());
  assertEquals(normalizeActivationKey("01234567-89abcdef-01234567-89abcdef"), raw.toUpperCase());
  assertEquals(normalizeActivationKey("01234567-89ABCDEF-01234567-89ABCDEF"), raw.toUpperCase());
});

Deno.test("activation key normalization rejects malformed values and non-boundary separators", () => {
  for (const value of [
    null,
    123,
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "01234-56789abcdef0123456789abcdef",
    "01234567 89abcdef0123456701234567",
    " 0123456789abcdef0123456789abcdef",
  ]) {
    assertThrows(() => normalizeActivationKey(value));
  }
});

Deno.test("China semester keys normalize consistently with the generated raw-key hash", async () => {
  const normalized = normalizeActivationKey("ac-cn-sem-abc12345");
  assertEquals(normalized, "AC-CN-SEM-ABC12345");
  assertEquals(
    await hashActivationKey(normalized),
    "0a1338bcd1cadc6429adee932c3cf4d5dadb1b00e8564cf64c89f449859a5cd1",
  );
});

Deno.test("activation key hash is deterministic SHA-256 of its normalized form", async () => {
  assertEquals(
    await hashActivationKey("0123456789ABCDEF0123456789ABCDEF"),
    "cd6c1f7d1dc6717d6371d2647910ca71ba3bf0b611083d322466b8843b4285b6",
  );
  assertEquals(
    await hashActivationKey(normalizeActivationKey("01234567-89abcdef-01234567-89abcdef")),
    "cd6c1f7d1dc6717d6371d2647910ca71ba3bf0b611083d322466b8843b4285b6",
  );
});
