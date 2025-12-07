const { EventEmitter } = require("node:events");

class DownloadResponse extends EventEmitter {
  fileName;
  url;
  status;
  statusText;
  _finished = false;
  constructor(fileName, url) {
    super();
    this.fileName = fileName;
    this.url = url;
  }
  isFinished() {
    return this._finished;
  }
  _markFinished() {
    this._finished = true;
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

exports.DownloadResponse = DownloadResponse;