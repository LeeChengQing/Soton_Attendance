import test from 'node:test';
import assert from 'node:assert/strict';
import {randomSubmitDelay} from '../src/submit-delay.js';

test('random submit delay stays between 15 and 20 seconds inclusive', () => {
  const values = [
    randomSubmitDelay(() => 0),
    randomSubmitDelay(() => 0.499),
    randomSubmitDelay(() => 0.999),
  ];

  assert.deepEqual(values, [15000, 17000, 20000]);
});
