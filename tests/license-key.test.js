import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLicenseKey } from '../src/license-key.js';

test('legacy hexadecimal keys normalize grouped and ungrouped input identically', () => {
  const ungrouped = '0123456789abcdef0123456789abcdef';
  const grouped = '01234567-89abcdef-01234567-89abcdef';
  assert.equal(normalizeLicenseKey(` \n${ungrouped}\t`), '0123456789ABCDEF0123456789ABCDEF');
  assert.equal(normalizeLicenseKey(grouped), '0123456789ABCDEF0123456789ABCDEF');
});

test('China semester keys normalize the full key to uppercase', () => {
  assert.equal(normalizeLicenseKey(' ac-cn-sem-a1b2c3d4e5 '), 'AC-CN-SEM-A1B2C3D4E5');
});

test('website standard keys uppercase hex and retain all required separators', () => {
  const input = 'ac-0123-4567-89ab-cdef-0123-4567-89ab-cdef-0123-4567-89ab-cdef';
  const expected = 'AC-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF-0123-4567-89AB-CDEF';
  assert.equal(input.length, 62);
  assert.equal(normalizeLicenseKey(input), expected);
});

test('international keys preserve the exact suffix casing and require an exact prefix', () => {
  assert.equal(normalizeLicenseKey('AC-INTL-BNDL-aB12cD34'), 'AC-INTL-BNDL-aB12cD34');
  assert.equal(normalizeLicenseKey('AC-INTL-MOBM-Aa09Zz88'), 'AC-INTL-MOBM-Aa09Zz88');
  assert.equal(normalizeLicenseKey('AC-INTL-MOBY-QwErTy123456'), 'AC-INTL-MOBY-QwErTy123456');
  assert.throws(() => normalizeLicenseKey('ac-INTL-BNDL-aB12cD34'), { message: 'invalid_activation_key' });
});

test('unsupported key formats and malformed separators are rejected', () => {
  const invalid = [
    null,
    123,
    '',
    'https://vf-auto-check.vercel.app/license/AC-12345678',
    'ordinary text',
    '01234567-89abcdef-0123456789abcdef',
    'AC-1234-5678',
    'AC-CN-SEM-1234567',
    'AC-CN-SEM-1234567890123',
    'AC-INTL-BNDL-1234567',
    'AC-INTL-OTHER-12345678',
  ];
  for (const value of invalid) {
    assert.throws(() => normalizeLicenseKey(value), { message: 'invalid_activation_key' }, String(value));
  }
});

test('canonical 160-bit and historical plugin/UUID inputs retain backend normalization', () => {
  assert.equal(normalizeLicenseKey(' ac-lic-aaaa-bbbb-cccc-dddd-eeee-ffff-gggg-hhhh '), 'AC-LIC-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH');
  assert.equal(normalizeLicenseKey('ac-lic-abcd-1234-5678-ef01'), 'AC-LIC-ABCD-1234-5678-EF01');
  assert.equal(normalizeLicenseKey('ABCDEF01-1234-4234-8234-123456789ABC'), 'abcdef01-1234-4234-8234-123456789abc');
});
