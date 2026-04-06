import { UniversalEventEmitter } from './event-emitter.js';

export class UniversalUploadResponse extends UniversalEventEmitter {
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

export { UniversalUploadResponse as UploadResponse };
