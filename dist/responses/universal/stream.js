import { UniversalEventEmitter } from './event-emitter.js';
import { requireNodeModule } from '../../utils/node-runtime.js';

export class UniversalStreamResponse extends UniversalEventEmitter {
  _finished = false;
  _encoding;
  _pipeTargets = [];
  _earlyEvents = [];
  _replayEvents = new Set(["initiated", "start", "headers", "status", "cookies"]);
  constructor() {
    super();
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
  write(chunk) {
    for (const target of this._pipeTargets) {
      target.write(chunk);
    }
    this.emit("data", chunk);
  }
  end() {
    this._finished = true;
    this.emit("close");
  }
  pipe(destination, options) {
    const shouldEnd = options?.end !== false;
    this._pipeTargets.push(destination);
    if (shouldEnd) {
      const onFinish = () => {
        if (typeof destination.end === "function")
          destination.end();
      };
      this.on("finish", onFinish);
      this.on("done", onFinish);
    }
    this.on("error", (err) => {
      if (typeof destination.destroy === "function") {
        destination.destroy(err);
      }
    });
    return destination;
  }
  pipeTo(filePath) {
    const path = requireNodeModule("node:path");
    const fs = requireNodeModule("node:fs");
    const createWriteStream = fs?.createWriteStream;
    if (!path || !fs || !createWriteStream) {
      return this;
    }
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
    if (this._replayEvents.has(eventStr) && this.listenerCount(eventStr) === 0) {
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
}

export { UniversalStreamResponse as StreamResponse };
