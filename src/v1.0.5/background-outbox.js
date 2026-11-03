// Recovered V1.0.5 background runtime variant; see docs/SOURCE_DRIFT_V1.0.5.md.

function enqueue(snapshot = {}, action, payload, now = Date.now()) {
  const q = { version: snapshot.version || 0, items: [...snapshot.items || []] };
  const logical = action === "sync" ? "sync" : action === "event" ? `event:${payload.occurrenceKey}` : `${action}:${payload.sessionId}`;
  if (action !== "sync" && q.items.some((item) => item.logical === logical)) return q;
  if (action === "sync") {
    q.version = Math.max(q.version + 1, now);
    q.items = q.items.filter((item) => item.action !== "sync");
    payload = { ...payload, version: q.version };
  }
  q.items.push({ id: crypto.randomUUID(), logical, action, payload, attempts: 0, availableAt: now });
  return q;
}
var acknowledge = (q, id) => ({ ...q, items: (q.items || []).filter((item) => item.id !== id), lastSuccessAt: (/* @__PURE__ */ new Date()).toISOString() });
function fail(q, id, error, now = Date.now()) {
  return { ...q, items: (q.items || []).map((item) => item.id !== id ? item : { ...item, attempts: item.attempts + 1, lastError: String(error).slice(0, 300), availableAt: now + Math.min(36e5, 15e3 * 2 ** Math.min(item.attempts, 8)) }) };
}
var nextReady = (q, now = Date.now()) => (q.items || []).find((item) => item.availableAt <= now);
export { enqueue, acknowledge, fail, nextReady };
