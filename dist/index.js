export {
  Rezo,
  createRezoInstance,
  createDefaultInstance
} from './core/rezo.js';
export { RezoError, RezoErrorCode } from './errors/rezo-error.js';
export { RezoHeaders } from './utils/headers.js';
export { RezoFormData } from './utils/form-data.js';
export { RezoCookieJar, CookieJar, Cookie, Store } from './cookies/cookie-jar.js';
export { RezoCookieStore } from './cookies/cookie-store.js';
export { toCurl, fromCurl } from './utils/curl.js';
export { parseLinkHeader } from './utils/link-header.js';
export { RezoUri } from './utils/uri.js';
export { createDefaultHooks, mergeHooks } from './core/hooks.js';
export { RequestInterceptorManager, ResponseInterceptorManager } from './core/interceptor-manager.js';
export { ProxyManager } from './proxy/manager.js';
export { RezoStealth } from './stealth/stealth.js';
export { listProfiles, getProfile, getProfilesByFamily } from './stealth/profiles/index.js';
export { RezoQueue, HttpQueue, HttpQueue as RezoHttpQueue, Priority, HttpMethodPriority } from './queue/index.js';
import { RezoError } from './errors/rezo-error.js';
export const isRezoError = RezoError.isRezoError;
export const Cancel = RezoError;
export const CancelToken = AbortController;
export const isCancel = (error) => {
  return error instanceof RezoError && error.code === "ECONNABORTED";
};
export const all = Promise.all.bind(Promise);
export const spread = (callback) => (array) => callback(...array);
export { VERSION, PACKAGE_NAME } from './version.js';
import { executeRequest } from './adapters/http.js';
import { setGlobalAdapter, createRezoInstance } from './core/rezo.js';
setGlobalAdapter(executeRequest);
const rezo = createRezoInstance(executeRequest);
export default rezo;
