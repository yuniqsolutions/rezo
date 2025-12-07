export {
  Rezo,
  createRezoInstance,
  createDefaultInstance
} from './core/rezo.js';
export { RezoError, RezoErrorCode } from './errors/rezo-error.js';
export { RezoHeaders } from './utils/headers.js';
export { RezoFormData } from './utils/form-data.js';
export { RezoCookieJar } from './utils/cookies.js';
export { createDefaultHooks, mergeHooks } from './core/hooks.js';
import { RezoError } from './errors/rezo-error.js';
export const isRezoError = RezoError.isRezoError;
export const Cancel = RezoError;
export const CancelToken = AbortController;
export const isCancel = (error) => {
  return error instanceof RezoError && error.code === "ECONNABORTED";
};
export const all = Promise.all.bind(Promise);
export const spread = (callback) => (array) => callback(...array);
import packageJson from "../package.json" with { type: 'json' };
export const VERSION = packageJson.version;
import { executeRequest } from './adapters/http.js';
import { setGlobalAdapter, createRezoInstance } from './core/rezo.js';
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);
export default rezo;
