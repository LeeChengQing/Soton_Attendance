const legacyUngroupedPattern = /^[0-9a-f]{32}$/i;
const legacyGroupedPattern = /^(?:[0-9a-f]{8}-){3}[0-9a-f]{8}$/i;
const chinaSemesterPattern = /^AC-CN-SEM-[A-Z0-9]{8,12}$/i;
const standardWebsitePattern = /^AC-(?:[0-9a-f]{4}-){11}[0-9a-f]{4}$/i;
const internationalPrefixes = ['AC-INTL-BNDL-', 'AC-INTL-MOBM-', 'AC-INTL-MOBY-'];
const pluginPattern = /^AC-LIC(?:(?:-[A-Z0-9]{4}){4}|(?:-[A-Z2-7]{4}){8})$/i;
const uuidPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

const cleanGateKey=value=>String(value).trim().replace(/[–—−]/g,'-').replace(/\s+/g,'').toUpperCase();
export function normalizeGateKey(value) {
  const clean=cleanGateKey(value);
  if(uuidPattern.test(clean)) return normalizeLicenseKey(clean);
  const body=clean.replace(/^AC-LIC-?/,'').replaceAll('-','');
  if(!/^[A-Z0-9]+$/.test(body)||![16,32].includes(body.length)) throw Error('invalid_activation_key');
  return normalizeLicenseKey(`AC-LIC-${body.match(/.{4}/g).join('-')}`);
}
export function formatGateKey(value) {
  const clean=cleanGateKey(value);
  if(uuidPattern.test(clean)) return clean.toLowerCase();
  const body=clean.replace(/^AC-LIC-?/,'').replaceAll('-','');
  // Do not discard invalid characters or truncate a pasted key into a valid one.
  return /^[A-Z0-9]*$/.test(body)?(body.match(/.{1,4}/g)||[]).join('-'):clean;
}

export function normalizeLicenseKey(value) {
  if (typeof value !== 'string') throw new Error('invalid_activation_key');

  const trimmed = value.trim();
  if (pluginPattern.test(trimmed)) return trimmed.toUpperCase();
  if (uuidPattern.test(trimmed)) return trimmed.toLowerCase();
  if (legacyUngroupedPattern.test(trimmed) || legacyGroupedPattern.test(trimmed)) {
    return trimmed.replaceAll('-', '').toUpperCase();
  }

  if (chinaSemesterPattern.test(trimmed)) return trimmed.toUpperCase();
  if (standardWebsitePattern.test(trimmed)) return trimmed.toUpperCase();

  const prefix = internationalPrefixes.find(candidate => trimmed.startsWith(candidate));
  if (prefix && /^[A-Za-z0-9]{8,12}$/.test(trimmed.slice(prefix.length))) return trimmed;

  throw new Error('invalid_activation_key');
}
