import { RezoError } from '../errors/rezo-error.js';
const arrayBufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength").get;
const consumedStreams = new WeakSet;
export function isArrayBufferBody(body) {
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
export function requestBodyBytes(body) {
  if (ArrayBuffer.isView(body))
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (isArrayBufferBody(body))
    return new Uint8Array(body);
  return;
}
export function isBlobBody(body) {
  return typeof Blob !== "undefined" && body instanceof Blob;
}
export function isWebStreamBody(body) {
  return body !== null && typeof body === "object" && typeof Reflect.get(body, "getReader") === "function" && typeof Reflect.get(body, "cancel") === "function";
}
export function isNodeStreamBody(body) {
  return body !== null && typeof body === "object" && typeof Reflect.get(body, "pipe") === "function" && typeof Reflect.get(body, "on") === "function";
}
export function isStreamBody(body) {
  return isWebStreamBody(body) || isNodeStreamBody(body);
}
export function isRawBody(body) {
  return ArrayBuffer.isView(body) || isArrayBufferBody(body) || isBlobBody(body) || isStreamBody(body);
}
export function assertBodyAvailable(body, config, request, disturbed = false) {
  if (!isStreamBody(body))
    return;
  if (disturbed || consumedStreams.has(body) || Reflect.get(body, "locked") === true || Reflect.get(body, "destroyed") === true || Reflect.get(body, "readableEnded") === true || Reflect.get(body, "readableDidRead") === true) {
    throw new RezoError("Request body stream has already been consumed or locked; provide a fresh body for another request.", config, "REZ_STREAM_ERROR", request);
  }
}
export function claimBodyStream(body, config, request) {
  assertBodyAvailable(body, config, request);
  if (isStreamBody(body))
    consumedStreams.add(body);
}
export function extractWebBodyStream(body, config, request) {
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
