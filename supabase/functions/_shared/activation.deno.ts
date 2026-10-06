import { hashActivationKeyInput, normalizeActivationKey } from "./activation.ts";

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

async function assertRejects(callback: () => Promise<unknown>) {
  try {
    await callback();
  } catch {
    return;
  }
  throw new Error("expected promise to reject");
}

Deno.test("activation key normalization trims whitespace and preserves legacy grouped/ungrouped compatibility", () => {
  const raw = "0123456789abcdef0123456789abcdef";
  const canonical = "0123456789ABCDEF0123456789ABCDEF";
  assertEquals(normalizeActivationKey(` \n${raw}\t`), canonical);
  assertEquals(normalizeActivationKey("01234567-89abcdef-01234567-89abcdef"), canonical);
  assertEquals(normalizeActivationKey("01234567-89ABCDEF-01234567-89ABCDEF"), canonical);
});

Deno.test("China semester keys trim and normalize consistently", () => {
  assertEquals(normalizeActivationKey(" ac-cn-sem-abc12345\n"), "AC-CN-SEM-ABC12345");
});

Deno.test("website standard keys uppercase hex while preserving all separators", () => {
  assertEquals(
    normalizeActivationKey(" ac-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000\n"),
    "AC-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000",
  );
});

Deno.test("international keys preserve exact mixed-case suffix and require an exact prefix", () => {
  assertEquals(normalizeActivationKey("AC-INTL-BNDL-aB12cD34"), "AC-INTL-BNDL-aB12cD34");
  assertEquals(normalizeActivationKey("AC-INTL-MOBM-aB12cD34"), "AC-INTL-MOBM-aB12cD34");
  assertEquals(normalizeActivationKey("AC-INTL-MOBY-QwErTy123456"), "AC-INTL-MOBY-QwErTy123456");
});

Deno.test("activation key normalization rejects malformed formats and separators", () => {
  for (const value of [
    null,
    123,
    "0123456789abcdef0123456789abcde",
    "0123456789abcdef0123456789abcdef0",
    "01234-56789abcdef0123456789abcdef",
    "01234567-89abcdef-0123456789abcdef",
    "01234567 89abcdef0123456701234567",
    "01234567--89abcdef-01234567-89abcdef",
    "AC-1234-5678",
    "AC-CN-SEM-1234567",
    "AC-CN-SEM-1234567890123",
    "AC-INTL-BNDL-1234567",
    "AC-INTL-OTHER-12345678",
    "ac-INTL-BNDL-aB12cD34",
  ]) {
    assertThrows(() => normalizeActivationKey(value));
  }
});

Deno.test("hash helper matches fixed Website and backward-compatibility vectors", async () => {
  assertEquals(
    await hashActivationKeyInput("0123456789ABCDEF0123456789ABCDEF"),
    "cd6c1f7d1dc6717d6371d2647910ca71ba3bf0b611083d322466b8843b4285b6",
  );
  assertEquals(
    await hashActivationKeyInput(" 01234567-89abcdef-01234567-89abcdef\n"),
    "cd6c1f7d1dc6717d6371d2647910ca71ba3bf0b611083d322466b8843b4285b6",
  );
  assertEquals(
    await hashActivationKeyInput(" ac-cn-sem-abc12345 "),
    "0a1338bcd1cadc6429adee932c3cf4d5dadb1b00e8564cf64c89f449859a5cd1",
  );
  assertEquals(
    await hashActivationKeyInput("AC-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000"),
    "f1b033378c8f604f768e6b8dac46a33bdcbdaf53f03dee0a87fae95a6c71e7df",
  );
  assertEquals(
    await hashActivationKeyInput("AC-INTL-BNDL-aB12cD34"),
    "1b93708a051500e666b03c940a6aacea6d78ed01981133395fe8b0ef775c6095",
  );
  assertEquals(
    await hashActivationKeyInput("AC-INTL-MOBM-aB12cD34"),
    "97c0df74f15246c487b14fa34bf9251200d85b5c16bb9b9454eb0ac8583a1d47",
  );
  assertEquals(
    await hashActivationKeyInput("AC-INTL-MOBY-QwErTy123456"),
    "cc3b9190688e9a38b7b75720ef42289abafc279ce28a8ad00d141c1e006ff624",
  );
});

Deno.test("hash helper rejects invalid keys before hashing", async () => {
  await assertRejects(() => hashActivationKeyInput("not-a-license-key"));
});
