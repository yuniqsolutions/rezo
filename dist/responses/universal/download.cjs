const { UniversalEventEmitter } = require('./event-emitter.cjs');

class UniversalDownloadResponse extends UniversalEventEmitter {
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
}

exports.DownloadResponse = UniversalDownloadResponse;
exports.UniversalDownloadResponse = UniversalDownloadResponse;