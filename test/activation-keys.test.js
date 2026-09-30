import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateActivationBatch } from "../scripts/generate-activation-keys.mjs";

const termEnd = "2099-09-30";

test("activation-batch creates unique 128-bit codes and hash-only import rows", () => {
  const { shopCodes, importRows } = generateActivationBatch({
    count: 24,
    plan: "bundle",
    termEnd,
  });

  assert.equal(shopCodes.length, 24);
  assert.equal(importRows.length, 24);
  assert.equal(new Set(shopCodes).size, shopCodes.length);
  for (const [index, code] of shopCodes.entries()) {
    assert.match(code, /^[A-F0-9]{8}(?:-[A-F0-9]{8}){3}$/);
    assert.deepEqual(Object.keys(importRows[index]).sort(), ["key_hash", "plan", "term_expires_at"]);
    assert.equal(importRows[index].key_hash, createHash("sha256").update(code.replaceAll("-", "")).digest("hex"));
    assert.equal(importRows[index].plan, "bundle");
    assert.equal(importRows[index].term_expires_at, "2099-09-30T16:00:00.000Z");
  }
});

test("activation-batch interprets term end as the inclusive Malaysia calendar date", () => {
  const { importRows } = generateActivationBatch({ count: 1, plan: "phone_notifications", termEnd });
  assert.equal(importRows[0].term_expires_at, "2099-09-30T16:00:00.000Z");
});

test("activation-batch rejects invalid count, plan, or term end", () => {
  for (const count of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => generateActivationBatch({ count, plan: "bundle", termEnd }));
  }
  assert.throws(() => generateActivationBatch({ count: 1, plan: "unknown", termEnd }));
  for (const invalidDate of ["2099-02-29", "2099-9-30", "2099-09-30T00:00:00Z", "2000-01-01"]) {
    assert.throws(() => generateActivationBatch({ count: 1, plan: "bundle", termEnd: invalidDate }));
  }
});

test("activation-batch writes separate stock and hash files and refuses overwrite", () => {
  const folder = mkdtempSync(join(tmpdir(), "activation-batch-"));
  const script = fileURLToPath(new URL("../scripts/generate-activation-keys.mjs", import.meta.url));
  const args = [script, "--count", "2", "--plan", "phone_notifications", "--term-end", termEnd];
  try {
    execFileSync(process.execPath, args, { cwd: folder, stdio: "pipe" });
    const batchDir = join(folder, "activation-key-batches");
    const files = readdirSync(batchDir).sort();
    assert.deepEqual(files, [
      "phone_notifications-2099-09-30-hashes.csv",
      "phone_notifications-2099-09-30-shop.txt",
    ]);
    const shopCodes = readFileSync(join(batchDir, files[1]), "utf8").trim().split(/\r?\n/);
    const csv = readFileSync(join(batchDir, files[0]), "utf8");
    assert.equal(shopCodes.length, 2);
    assert.match(csv, /^key_hash,plan,term_expires_at\r?\n/);
    assert.doesNotMatch(csv, new RegExp(shopCodes[0]));
    assert.throws(() => execFileSync(process.execPath, args, { cwd: folder, stdio: "pipe" }));
    assert.deepEqual(readdirSync(batchDir).sort(), files);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
