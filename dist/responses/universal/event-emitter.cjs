class UniversalEventEmitter {
  _listeners = new Map;
  _onceListeners = new Map;
  on(event, listener) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set);
    }
    this._listeners.get(event).add(listener);
    return this;
  }
  once(event, listener) {
    if (!this._onceListeners.has(event)) {
      this._onceListeners.set(event, new Set);
    }
    this._onceListeners.get(event).add(listener);
    return this;
  }
  off(event, listener) {
    this._listeners.get(event)?.delete(listener);
    this._onceListeners.get(event)?.delete(listener);
    return this;
  }
  removeListener(event, listener) {
    return this.off(event, listener);
  }
  removeAllListeners(event) {
    if (event) {
      this._listeners.delete(event);
      this._onceListeners.delete(event);
    } else {
      this._listeners.clear();
      this._onceListeners.clear();
    }
    return this;
  }
  addListener(event, listener) {
    return this.on(event, listener);
  }
  prependListener(event, listener) {
    return this.on(event, listener);
  }
  prependOnceListener(event, listener) {
    return this.once(event, listener);
  }
  emit(event, ...args) {
    let hasListeners = false;
    const listeners = this._listeners.get(event);
    if (listeners && listeners.size > 0) {
      hasListeners = true;
      for (const listener of listeners) {
        try {
          listener(...args);
        } catch (err) {
          console.error("EventEmitter listener error:", err);
        }
      }
    }
    const onceListeners = this._onceListeners.get(event);
    if (onceListeners && onceListeners.size > 0) {
      hasListeners = true;
      const toCall = [...onceListeners];
      onceListeners.clear();
      for (const listener of toCall) {
        try {
          listener(...args);
        } catch (err) {
          console.error("EventEmitter once listener error:", err);
        }
      }
    }
    return hasListeners;
  }
  listenerCount(event) {
    const regular = this._listeners.get(event)?.size || 0;
    const once = this._onceListeners.get(event)?.size || 0;
    return regular + once;
  }
  listeners(event) {
    const regular = this._listeners.get(event) || new Set;
    const once = this._onceListeners.get(event) || new Set;
    return [...regular, ...once];
  }
  eventNames() {
    const names = new Set;
    for (const key of this._listeners.keys()) {
      names.add(key);
    }
    for (const key of this._onceListeners.keys()) {
      names.add(key);
    }
    return [...names];
  }
  setMaxListeners(_n) {
    return this;
  }
  getMaxListeners() {
    return 1 / 0;
  }
  rawListeners(event) {
    return this.listeners(event);
  }
}

exports.UniversalEventEmitter = UniversalEventEmitter;