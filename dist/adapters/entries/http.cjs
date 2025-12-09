const { executeRequest } = require('../http.cjs');
const { setGlobalAdapter, createRezoInstance, Rezo } = require('../../core/rezo.cjs');
const { RezoError, RezoErrorCode } = require('../../errors/rezo-error.cjs');
const { RezoHeaders } = require('../../utils/headers.cjs');
const { RezoFormData } = require('../../utils/form-data.cjs');
const { RezoCookieJar, Cookie } = require('../../utils/cookies.cjs');
const { createDefaultHooks, mergeHooks } = require('../../core/hooks.cjs');
const packageJson = require("../../../package.json");

exports.Rezo = Rezo;
exports.RezoError = RezoError;
exports.RezoErrorCode = RezoErrorCode;
exports.RezoHeaders = RezoHeaders;
exports.RezoFormData = RezoFormData;
exports.RezoCookieJar = RezoCookieJar;
exports.Cookie = Cookie;
exports.createDefaultHooks = createDefaultHooks;
exports.mergeHooks = mergeHooks;
const isRezoError = exports.isRezoError = RezoError.isRezoError;
const Cancel = exports.Cancel = RezoError;
const CancelToken = exports.CancelToken = AbortController;
const isCancel = exports.isCancel = (error) => {
  return error instanceof RezoError && error.code === "ECONNABORTED";
};
const all = exports.all = Promise.all.bind(Promise);
const spread = exports.spread = (callback) => (array) => callback(...array);
const VERSION = exports.VERSION = packageJson.version;
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);

exports.default = rezo;
module.exports = Object.assign(rezo, exports);