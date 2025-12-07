const { executeRequest } = require('../adapters/fetch.cjs');
const { setGlobalAdapter, createRezoInstance, Rezo } = require('../core/rezo.cjs');
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);

exports.Rezo = Rezo;
exports.rezo = rezo;
exports.default = rezo;
module.exports = Object.assign(rezo, exports);