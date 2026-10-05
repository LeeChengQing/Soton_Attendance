import { createHash, randomInt } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const OUTPUT_ROOT = "generated_keys/china_region";
const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const KEY_COUNT = 50;
const KEY_LENGTH = 12;

function randomSuffix() {
  let suffix = "";
  for (let index = 0; index < KEY_LENGTH; index += 1) {
    suffix += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)];
  }
  return suffix;
}

function hashKey(rawKey) {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

function makeKeys(prefix) {
  const keys = [];
  const seen = new Set();

  while (keys.length < KEY_COUNT) {
    const rawKey = `${prefix}${randomSuffix()}`;
    if (seen.has(rawKey)) continue;
    seen.add(rawKey);
    keys.push(rawKey);
  }

  return keys;
}

function writeOutputs(directory, keys) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    `${directory}/sem_keys.csv`,
    [
      "key_hash,plan,status",
      ...keys.map((rawKey) => `${hashKey(rawKey)},sem_subscription,available`),
    ].join("\n") + "\n",
    { encoding: "utf8", flag: "wx" },
  );
  writeFileSync(
    `${directory}/sem_keys_raw.txt`,
    keys.join("\n") + "\n",
    { encoding: "utf8", flag: "wx" },
  );
}

function main() {
  rmSync("generated_keys", { recursive: true, force: true });

  const semesterDir = `${OUTPUT_ROOT}/sem_subscription`;
  const semesterKeys = makeKeys("AC-CN-SEM-");

  writeOutputs(semesterDir, semesterKeys);

  console.log(`Generated ${KEY_COUNT} China semester keys: ${semesterDir}/sem_keys.csv`);
  console.log(`Raw keys for manual entry: ${semesterDir}/sem_keys_raw.txt`);
}

main();
