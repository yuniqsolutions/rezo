import { executeRequest } from '../react-native.js';
import { setGlobalAdapter, createRezoInstance, Rezo } from '../../core/rezo.js';
import { RezoError, RezoErrorCode } from '../../errors/rezo-error.js';
import { RezoHeaders } from '../../utils/headers.js';
import { RezoFormData } from '../../utils/form-data.js';
import { RezoCookieJar, Cookie } from '../../utils/cookies.js';
import { createDefaultHooks, mergeHooks } from '../../core/hooks.js';
import packageJson from "../../../package.json" with { type: 'json' };

export { Rezo };
export { RezoError };
export { RezoErrorCode };
export { RezoHeaders };
export { RezoFormData };
export { RezoCookieJar, Cookie };
export { createDefaultHooks };
export { mergeHooks };
export const isRezoError = RezoError.isRezoError;
export const Cancel = RezoError;
export const CancelToken = AbortController;
export const isCancel = (error) => {
  return error instanceof RezoError && error.code === "ECONNABORTED";
};
export const all = Promise.all.bind(Promise);
export const spread = (callback) => (array) => callback(...array);
export const VERSION = packageJson.version;
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);
export default rezo;
