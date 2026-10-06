const LEGACY_UNGROUPED_KEY_PATTERN = /^[0-9a-f]{32}$/i;
const LEGACY_GROUPED_KEY_PATTERN = /^(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/i;
const NORMALIZED_LEGACY_KEY_PATTERN = /^[0-9A-F]{32}$/;
const CHINA_SEMESTER_KEY_PATTERN = /^AC-CN-SEM-[A-Z0-9]{8,12}$/i;
const STANDARD_WEBSITE_KEY_PATTERN = /^AC-(?:[0-9a-f]{4}-){11}[0-9a-f]{4}$/i;
const NORMALIZED_STANDARD_WEBSITE_KEY_PATTERN = /^AC-(?:[0-9A-F]{4}-){11}[0-9A-F]{4}$/;
const INTERNATIONAL_KEY_PREFIXES = ["AC-INTL-BNDL-", "AC-INTL-MOBM-", "AC-INTL-MOBY-"] as const;

function isInternationalKey(value: string): boolean {
  const prefix = INTERNATIONAL_KEY_PREFIXES.find((candidate) => value.startsWith(candidate));
  return Boolean(prefix && /^[A-Za-z0-9]{8,12}$/.test(value.slice(prefix.length)));
}

function isNormalizedKey(value: string): boolean {
  return NORMALIZED_LEGACY_KEY_PATTERN.test(value)
    || CHINA_SEMESTER_KEY_PATTERN.test(value)
    || NORMALIZED_STANDARD_WEBSITE_KEY_PATTERN.test(value)
    || isInternationalKey(value);
}

export function normalizeActivationKey(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("invalid_activation_key");
  const trimmed = value.trim();

  if (LEGACY_UNGROUPED_KEY_PATTERN.test(trimmed) || LEGACY_GROUPED_KEY_PATTERN.test(trimmed)) {
    return trimmed.replaceAll("-", "").toUpperCase();
  }
  if (CHINA_SEMESTER_KEY_PATTERN.test(trimmed)) return trimmed.toUpperCase();
  if (STANDARD_WEBSITE_KEY_PATTERN.test(trimmed)) return trimmed.toUpperCase();
  if (isInternationalKey(trimmed)) return trimmed;

  throw new TypeError("invalid_activation_key");
}

export async function hashActivationKey(normalized: string): Promise<string> {
  if (typeof normalized !== "string" || !isNormalizedKey(normalized)) {
    throw new TypeError("activation key must be normalized before hashing");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashActivationKeyInput(value: unknown): Promise<string> {
  return hashActivationKey(normalizeActivationKey(value));
}
