import test from 'node:test';
import assert from 'node:assert/strict';
import {transition, dueAction} from '../src/state.js';

test('only explicit form success can produce success state', () => {
  assert.equal(transition('pending','success').state,'success');
  assert.equal(transition('pending','timeout').state,'unknown');
  assert.throws(()=>transition('unknown','success'));
});

test('late occurrences are marked missed rather than automatically submitted', () => {
  assert.equal(dueAction(Date.parse('2026-10-02T09:00:00+08:00'),Date.parse('2026-10-02T09:05:00+08:00')),'missed');
  assert.equal(dueAction(Date.parse('2026-10-02T09:00:00+08:00'),Date.parse('2026-10-02T09:00:30+08:00')),'launch');
});
