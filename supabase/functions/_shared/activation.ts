const GROUPED_KEY_PATTERN = /^[0-9a-fA-F]{8}(?:-?[0-9a-fA-F]{8}){3}$/;
const NORMALIZED_KEY_PATTERN = /^[0-9A-F]{32}$/;
const CHINA_SEMESTER_KEY_PATTERN = /^AC-CN-SEM-[A-Z0-9]{8,12}$/i;

export function normalizeActivationKey(value: unknown): string {
  if (typeof value === "string" && CHINA_SEMESTER_KEY_PATTERN.test(value)) {
    return value.toUpperCase();
  }
  if (typeof value !== "string" || !GROUPED_KEY_PATTERN.test(value)) {
    throw new TypeError("invalid_activation_key");
  }
  return value.replaceAll("-", "").toUpperCase();
}

export async function hashActivationKey(normalized: string): Promise<string> {
  if (typeof normalized !== "string"
    || (!NORMALIZED_KEY_PATTERN.test(normalized) && !CHINA_SEMESTER_KEY_PATTERN.test(normalized))) {
    throw new TypeError("activation key must be normalized before hashing");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
