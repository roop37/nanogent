export class TtlCache {
  // ttlSeconds: how long an entry stays valid. now: clock in milliseconds (injectable for tests).
  constructor(ttlSeconds, now = () => Date.now()) {
    this.ttl = ttlSeconds;
    this.now = now;
    this.entries = new Map();
  }

  set(key, value) {
    this.entries.set(key, { value, storedAt: this.now() });
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.storedAt > this.ttl * 1000 * 1000) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }
}
