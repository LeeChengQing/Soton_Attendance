import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PLANS = new Set(["bundle", "phone_notifications"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const MALAYSIA_OFFSET_MS = 8 * 60 * 60 * 1000;

function getTermExpiry(termEnd) {
  if (typeof termEnd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(termEnd)) {
    throw new TypeError("termEnd must use YYYY-MM-DD format");
  }

  const utcStart = Date.parse(`${termEnd}T00:00:00.000Z`);
  if (!Number.isFinite(utcStart) || new Date(utcStart).toISOString().slice(0, 10) !== termEnd) {
    throw new RangeError("termEnd must be a valid calendar date");
  }

  const expiresAt = new Date(utcStart + DAY_MS - MALAYSIA_OFFSET_MS);
  if (expiresAt.getTime() <= Date.now()) {
    throw new RangeError("termEnd must not be in the past");
  }
  return expiresAt.toISOString();
}

function formatCode() {
  const hex = randomBytes(16).toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 16)}-${hex.slice(16, 24)}-${hex.slice(24)}`;
}

function hashCode(code) {
  return createHash("sha256").update(code.replaceAll("-", "").toUpperCase()).digest("hex");
}

export function generateActivationBatch({ count, plan, termEnd }) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError("count must be a positive safe integer");
  }
  if (!PLANS.has(plan)) throw new TypeError("plan must be bundle or phone_notifications");
  const termExpiresAt = getTermExpiry(termEnd);

  const shopCodes = [];
  const importRows = [];
  const seen = new Set();
  while (shopCodes.length < count) {
    const code = formatCode();
    if (seen.has(code)) continue;
    seen.add(code);
    shopCodes.push(code);
    importRows.push({
      key_hash: hashCode(code),
      plan,
      term_expires_at: termExpiresAt,
    });
  }

  return { shopCodes, importRows };
}

function parseArgs(args) {
  const parsed = new Map();
  const optionNames = new Map([
    ["--count", "count"],
    ["--plan", "plan"],
    ["--term-end", "termEnd"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const name = optionNames.get(args[index]);
    if (!name) throw new Error(`unknown option: ${args[index]}`);
    if (parsed.has(name)) throw new Error(`duplicate option: ${args[index]}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${args[index]}`);
    parsed.set(name, value);
    index += 1;
  }

  for (const name of optionNames.values()) {
    if (!parsed.has(name)) throw new Error(`missing --${name === "termEnd" ? "term-end" : name}`);
  }

  const countText = parsed.get("count");
  if (!/^\d+$/.test(countText)) throw new Error("count must be a positive integer");
  return {
    count: Number(countText),
    plan: parsed.get("plan"),
    termEnd: parsed.get("termEnd"),
  };
}

function writeBatch({ count, plan, termEnd }) {
  const { shopCodes, importRows } = generateActivationBatch({ count, plan, termEnd });
  const outputDir = join(process.cwd(), "activation-key-batches");
  const prefix = `${plan}-${termEnd}`;
  const shopPath = join(outputDir, `${prefix}-shop.txt`);
  const importPath = join(outputDir, `${prefix}-hashes.csv`);

  mkdirSync(outputDir, { recursive: true });
  if (existsSync(shopPath) || existsSync(importPath)) {
    throw new Error(`activation batch already exists for ${plan} ending ${termEnd}`);
  }

  const csv = [
    "key_hash,plan,term_expires_at",
    ...importRows.map((row) => `${row.key_hash},${row.plan},${row.term_expires_at}`),
  ].join("\n") + "\n";
  const createdPaths = [];
  try {
    writeFileSync(shopPath, `${shopCodes.join("\n")}\n`, { encoding: "utf8", flag: "wx" });
    createdPaths.push(shopPath);
    writeFileSync(importPath, csv, { encoding: "utf8", flag: "wx" });
    createdPaths.push(importPath);
  } catch (error) {
    for (const path of createdPaths) unlinkSync(path);
    if (error?.code === "EEXIST") {
      throw new Error(`activation batch already exists for ${plan} ending ${termEnd}`);
    }
    throw error;
  }

  return { shopPath, importPath };
}

function main() {
  const paths = writeBatch(parseArgs(process.argv.slice(2)));
  console.log(`Shop stock: ${paths.shopPath}`);
  console.log(`Supabase hash import: ${paths.importPath}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
