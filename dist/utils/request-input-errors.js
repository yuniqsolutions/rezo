import { RezoError } from '../errors/rezo-error.js';
export function unsupportedInput(field) {
  throw new RezoError(`The request option ${field} cannot be represented by native Rezo semantics.`, { adapterUsed: null }, "REZ_UNSUPPORTED_CAPABILITY");
}
export function invalidInput(message) {
  throw new RezoError(message, { adapterUsed: null }, "ERR_INVALID_ARG_TYPE");
}
