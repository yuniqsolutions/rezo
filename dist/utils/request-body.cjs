const { RezoError } = require('../errors/rezo-error.cjs');
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const consumedStreams = new WeakSet;
function isArrayBufferBody(body) {
  if (body instanceof ArrayBuffer)
    return true;
  if (body === null || typeof body !== "object")
    return false;
  try {
    arrayBufferLength.call(body);
    return true;
  } catch {
    return false;
  }
}
function requestBodyBytes(body) {
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (isArrayBufferBody(body))
    return new Uint8Array(body);
  return;
}
function isBlobBody(body) {
  return typeof Blob !== "undefined" && body instanceof Blob;
}
function isWebStreamBody(body) {
  return body !== null && typeof body === "object" && typeof Reflect.get(body, "getReader") === "function" && typeof Reflect.get(body, "cancel") === "function";
}
function isNodeStreamBody(body) {
  return body !== null && typeof body === "object" && typeof Reflect.get(body, "pipe") === "function" && typeof Reflect.get(body, "on") === "function";
}
function isStreamBody(body) {
  return isWebStreamBody(body) || isNodeStreamBody(body);
}
function isRawBody(body) {
  return ArrayBuffer.isView(body) || isArrayBufferBody(body) || isBlobBody(body) || isStreamBody(body);
}
function assertBodyAvailable(body, config, request, disturbed = false) {
  if (!isStreamBody(body))
    return;
  if (disturbed || consumedStreams.has(body) || Reflect.get(body, "locked") === true || Reflect.get(body, "destroyed") === true || Reflect.get(body, "readableEnded") === true || Reflect.get(body, "readableDidRead") === true) {
    throw new RezoError("Request body stream has already been consumed or locked; provide a fresh body for another request.", config, "REZ_STREAM_ERROR", request);
  }
}
function claimBodyStream(body, config, request) {
  assertBodyAvailable(body, config, request);
  if (isStreamBody(body))
    consumedStreams.add(body);
}
function extractWebBodyStream(body, config, request) {
  if (typeof Response === "undefined")
    return body;
  try {
    return new Response(body).body;
  } catch (error) {
    if (error instanceof TypeError)
      assertBodyAvailable(body, config, request, true);
    throw error;
  }
}

exports.isArrayBufferBody = isArrayBufferBody;
exports.requestBodyBytes = requestBodyBytes;
exports.isBlobBody = isBlobBody;
exports.isWebStreamBody = isWebStreamBody;
exports.isNodeStreamBody = isNodeStreamBody;
exports.isStreamBody = isStreamBody;
exports.isRawBody = isRawBody;
exports.assertBodyAvailable = assertBodyAvailable;
exports.claimBodyStream = claimBodyStream;
exports.extractWebBodyStream = extractWebBodyStream;