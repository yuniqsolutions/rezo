import { Writable } from "node:stream";

export class StreamResponse extends Writable {
  _finished = false;
  _encoding;
  constructor(opts) {
    super(opts);
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
    this.emit("data", chunk);
    callback();
  }
  on(event, listener) {
    super.on(event, listener);
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
