const legacyUngroupedPattern = /^[0-9a-f]{32}$/i;
const legacyGroupedPattern = /^(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/i;
const chinaSemesterPattern = /^AC-CN-SEM-[A-Z0-9]{8,12}$/i;
const standardWebsitePattern = /^AC-(?:[0-9a-f]{4}-){11}[0-9a-f]{4}$/i;
const internationalPrefixes = ['AC-INTL-BNDL-', 'AC-INTL-MOBM-', 'AC-INTL-MOBY-'];

export function normalizeLicenseKey(value) {
  if (typeof value !== 'string') throw new Error('invalid_activation_key');

  const trimmed = value.trim();
  if (legacyUngroupedPattern.test(trimmed) || legacyGroupedPattern.test(trimmed)) {
    return trimmed.replaceAll('-', '').toUpperCase();
  }

  if (chinaSemesterPattern.test(trimmed)) return trimmed.toUpperCase();
  if (standardWebsitePattern.test(trimmed)) return trimmed.toUpperCase();

  const prefix = internationalPrefixes.find(candidate => trimmed.startsWith(candidate));
  if (prefix && /^[A-Za-z0-9]{8,12}$/.test(trimmed.slice(prefix.length))) return trimmed;

  throw new Error('invalid_activation_key');
}
