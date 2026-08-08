/**
 * Small serialized, at-least-once client queue. A fresh queue is read after
 * each accepted event so an event enqueued during an in-flight request cannot
 * be removed by a stale snapshot.
 */
export function createClientStudyEventQueue({ read, write, send }) {
  if (typeof read !== "function" || typeof write !== "function" || typeof send !== "function") {
    throw new TypeError("read, write and send functions are required");
  }
  let inFlight = null;

  async function runFlush() {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const queue = read();
      if (!Array.isArray(queue) || queue.length === 0) return true;
      const entry = queue[0];
      const result = await send(entry);
      if (!result?.ok) {
        return false;
      }
      const fresh = read();
      write(Array.isArray(fresh) ? fresh.filter((candidate) => candidate.queueId !== entry.queueId) : []);
    }
    return false;
  }

  function flush() {
    if (!inFlight) {
      inFlight = runFlush().finally(() => {
        inFlight = null;
      });
    }
    return inFlight;
  }

  function enqueue(entry) {
    const current = read();
    write([...(Array.isArray(current) ? current : []), entry]);
    return flush();
  }

  function pending() {
    const current = read();
    return Array.isArray(current) ? current : [];
  }

  function acknowledge(queueIds) {
    const accepted = new Set(Array.isArray(queueIds) ? queueIds : []);
    if (accepted.size === 0) return;
    const fresh = read();
    write(Array.isArray(fresh) ? fresh.filter((entry) => !accepted.has(entry.queueId)) : []);
  }

  return Object.freeze({ enqueue, flush, pending, acknowledge });
}
