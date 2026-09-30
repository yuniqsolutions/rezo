const { RezoError } = require('../errors/rezo-error.cjs');
function unsupportedInput(field) {
  throw new RezoError(`The request option ${field} cannot be represented by native Rezo semantics.`, { adapterUsed: null }, "REZ_UNSUPPORTED_CAPABILITY");
}
function invalidInput(message) {
  throw new RezoError(message, { adapterUsed: null }, "ERR_INVALID_ARG_TYPE");
}

exports.unsupportedInput = unsupportedInput;
exports.invalidInput = invalidInput;