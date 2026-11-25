export class LruCache {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1)
      throw new Error("capacity must be a positive integer");
    this.capacity = capacity;
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  has(key) {
    return this.map.has(key);
  }

  get(key) {
    return this.map.get(key);
  }

  set(key, value) {
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      this.map.delete(oldest);
    }
    this.map.set(key, value);
    return this;
  }

  delete(key) {
    return this.map.delete(key);
  }

  keys() {
    return [...this.map.keys()];
  }
}
