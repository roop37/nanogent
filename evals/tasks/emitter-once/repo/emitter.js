export class Emitter {
  constructor() {
    this.handlers = {};
  }

  // Returns a function that removes the handler.
  on(event, fn) {
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const wrapper = (...args) => {
      fn(...args);
      this.off(event, fn);
    };
    return this.on(event, wrapper);
  }

  off(event, fn) {
    const list = this.handlers[event];
    if (!list) return;
    const index = list.indexOf(fn);
    if (index >= 0) list.splice(index, 1);
  }

  emit(event, ...args) {
    for (const fn of this.handlers[event] || []) fn(...args);
  }

  listenerCount(event) {
    return (this.handlers[event] || []).length;
  }
}
