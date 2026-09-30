import { RezoError } from '../errors/rezo-error.js';
const REQUEST_INPUTS = Object.freeze({
  auto: "auto",
  json: "json",
  text: "text",
  blob: "blob",
  arrayBuffer: "arrayBuffer",
  arraybuffer: "arrayBuffer",
  buffer: "buffer",
  binary: "buffer",
  stream: "stream",
  download: "download",
  upload: "upload"
});
const FACADE_MODES = new Set([
  "stream",
  "download",
  "upload"
]);
function refuse(config) {
  const predispatchConfig = config ?? { adapterUsed: null };
  throw new RezoError("Invalid Response Type", predispatchConfig, "REZ_INVALID_RESPONSE_TYPE");
}
export function resolveResponseType(requestResponseType, defaultResponseType, config) {
  if (requestResponseType !== undefined) {
    if (typeof requestResponseType !== "string")
      refuse(config);
    const canonical = Object.prototype.hasOwnProperty.call(REQUEST_INPUTS, requestResponseType) ? REQUEST_INPUTS[requestResponseType] : undefined;
    if (canonical === undefined)
      refuse(config);
    return canonical;
  }
  if (defaultResponseType !== undefined) {
    if (typeof defaultResponseType !== "string")
      refuse(config);
    const canonical = Object.prototype.hasOwnProperty.call(REQUEST_INPUTS, defaultResponseType) ? REQUEST_INPUTS[defaultResponseType] : undefined;
    if (canonical === undefined || FACADE_MODES.has(canonical))
      refuse(config);
    return canonical;
  }
  return "auto";
}
export function isFacadeResponseMode(mode) {
  return FACADE_MODES.has(mode);
}
