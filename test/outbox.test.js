import test from 'node:test';
import assert from 'node:assert/strict';
import {enqueue,acknowledge,fail,nextReady} from '../src/outbox.js';

test('snapshots coalesce but acknowledging an old in-flight snapshot retains the newest',()=>{
  let q=enqueue({},'sync',{schedules:[1]},100);
  const first=q.items[0];
  q=enqueue(q,'sync',{schedules:[2]},101);
  q=acknowledge(q,first.id);
  assert.equal(q.items.length,1);assert.deepEqual(q.items[0].payload.schedules,[2]);
  assert.ok(q.items[0].payload.version>first.payload.version);
});
test('logical terminal events deduplicate and retries retain identity with backoff',()=>{
  let q=enqueue({},'event',{occurrenceKey:'one',status:'unknown'},100);
  const id=q.items[0].id;
  q=enqueue(q,'event',{occurrenceKey:'one',status:'unknown'},101);
  assert.equal(q.items.length,1);
  q=fail(q,id,'offline',102);
  assert.equal(nextReady(q,103),undefined);
  assert.equal(nextReady(q,100000).id,id);
  q=acknowledge(q,id);assert.equal(q.items.length,0);
});
