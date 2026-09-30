const { RezoError, RezoErrorCode } = require('../errors/rezo-error.cjs');
function refuseTlsShaping(constructorName) {
  throw new RezoError(`${constructorName} is unavailable on this runtime: the platform owns TLS here, so a stealth profile's cipher, group and signature material cannot be applied`, {}, RezoErrorCode.UNSUPPORTED_CAPABILITY);
}
function createSecureContext(_fingerprint) {
  return refuseTlsShaping("createSecureContext");
}
function buildTlsOptions(_fingerprint) {
  return refuseTlsShaping("buildTlsOptions");
}

exports.createSecureContext = createSecureContext;
exports.buildTlsOptions = buildTlsOptions;