const { UniversalEventEmitter } = require('./event-emitter.cjs');

class UniversalUploadResponse extends UniversalEventEmitter {
  url;
  fileName;
  status;
  statusText;
  _finished = false;
  constructor(url, fileName) {
    super();
    this.url = url;
    this.fileName = fileName;
  }
  isFinished() {
    return this._finished;
  }
  _markFinished() {
    this._finished = true;
  }
}

exports.UploadResponse = UniversalUploadResponse;
exports.UniversalUploadResponse = UniversalUploadResponse;