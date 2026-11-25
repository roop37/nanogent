export class Emitter {
  constructor() {
    this.handlers = {};
  }

  #add(event, original, call) {
    const entry = { original, call };
    if (!this.handlers[event]) this.handlers[event] = [];
    this.handlers[event].push(entry);
    return () => this.#remove(event, entry);
  }

  #remove(event, entry) {
    const list = this.handlers[event];
    if (!list) return;
    const index = list.indexOf(entry);
    if (index >= 0) list.splice(index, 1);
  }

  // Returns a function that removes the handler.
  on(event, fn) {
    return this.#add(event, fn, fn);
  }

  once(event, fn) {
    const remove = this.#add(event, fn, (...args) => {
      remove();
      fn(...args);
    });
    return remove;
  }

  off(event, fn) {
    const list = this.handlers[event];
    if (!list) return;
    const index = list.findIndex((entry) => entry.original === fn);
    if (index >= 0) list.splice(index, 1);
  }

  emit(event, ...args) {
    for (const entry of [...(this.handlers[event] || [])]) entry.call(...args);
  }

  listenerCount(event) {
    return (this.handlers[event] || []).length;
  }
}
