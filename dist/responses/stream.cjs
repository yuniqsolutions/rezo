const { Writable } = require("node:stream");
const { createWriteStream } = require("node:fs");

class StreamResponse extends Writable {
  _finished = false;
  _encoding;
  _pipeTargets = [];
  _earlyEvents = [];
  _replayEvents = new Set(["initiated", "start", "headers", "status", "cookies"]);
  constructor(opts) {
    super({ ...opts, highWaterMark: opts?.highWaterMark ?? 64 * 1024 });
  }
  setEncoding(encoding) {
    this._encoding = encoding;
    return this;
  }
  getEncoding() {
    return this._encoding;
  }
  isFinished() {
    return this._finished;
  }
  _markFinished() {
    this._finished = true;
  }
  _write(chunk, _encoding, callback) {
    for (const target of this._pipeTargets) {
      target.write(chunk);
    }
    this.emit("data", chunk);
    callback();
  }
  _writev(chunks, callback) {
    for (const { chunk } of chunks) {
      for (const target of this._pipeTargets) {
        target.write(chunk);
      }
      this.emit("data", chunk);
    }
    callback();
  }
  pipe(destination, options) {
    const shouldEnd = options?.end !== false;
    this._pipeTargets.push(destination);
    if (shouldEnd) {
      this.on("finish", () => {
        if (typeof destination.end === "function") {
          destination.end();
        }
      });
    }
    this.on("error", (err) => {
      if (typeof destination.destroy === "function") {
        destination.destroy(err);
      }
    });
    return destination;
  }
  pipeTo(filePath) {
    const path = require("node:path");
    const fs = require("node:fs");
    const dir = path.dirname(filePath);
    if (dir && dir !== ".")
      fs.mkdirSync(dir, { recursive: true });
    this.pipe(createWriteStream(filePath));
    return this;
  }
  emit(event, ...args) {
    const eventStr = typeof event === "string" ? event : "";
    if ((eventStr === "finish" || eventStr === "done" || eventStr === "complete") && args.length === 0) {
      return false;
    }
    if (this._replayEvents.has(eventStr) && this.listenerCount(event) === 0) {
      this._earlyEvents.push({ event: eventStr, args });
    }
    return super.emit(event, ...args);
  }
  on(event, listener) {
    super.on(event, listener);
    if (typeof event === "string" && this._earlyEvents.length > 0) {
      const toReplay = this._earlyEvents.filter((e) => e.event === event);
      if (toReplay.length > 0) {
        this._earlyEvents = this._earlyEvents.filter((e) => e.event !== event);
        for (const { args } of toReplay) {
          listener(...args);
        }
      }
    }
    return this;
  }
  once(event, listener) {
    super.once(event, listener);
    return this;
  }
  addListener(event, listener) {
    super.addListener(event, listener);
    return this;
  }
  prependListener(event, listener) {
    super.prependListener(event, listener);
    return this;
  }
  prependOnceListener(event, listener) {
    super.prependOnceListener(event, listener);
    return this;
  }
  off(event, listener) {
    super.off(event, listener);
    return this;
  }
  removeListener(event, listener) {
    super.removeListener(event, listener);
    return this;
  }
  removeAllListeners(event) {
    super.removeAllListeners(event);
    return this;
  }
}

exports.StreamResponse = StreamResponse;