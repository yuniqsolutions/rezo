import { RezoError, RezoErrorCode } from '../errors/rezo-error.js';
function refuseTlsShaping(constructorName) {
  throw new RezoError(`${constructorName} is unavailable on this runtime: the platform owns TLS here, so a stealth profile's cipher, group and signature material cannot be applied`, {}, RezoErrorCode.UNSUPPORTED_CAPABILITY);
}
export function createSecureContext(_fingerprint) {
  return refuseTlsShaping("createSecureContext");
}
export function buildTlsOptions(_fingerprint) {
  return refuseTlsShaping("buildTlsOptions");
}
