const { createResponseCacheIdentity } = require('./response-cache-identity.cjs');
const BACKENDS = new WeakMap;
function registerResponseCacheBackend(cache, accessor) {
  BACKENDS.set(cache, accessor);
}
function bindResponseCache(cache, canonicalMode) {
  const accessor = BACKENDS.get(cache);
  if (!accessor)
    return;
  const identityFor = (method, url, headers) => createResponseCacheIdentity({ method, url, mode: canonicalMode, headers });
  return {
    get: (method, url, headers) => accessor.getByIdentity(identityFor(method, url, headers)) ?? undefined,
    set: (method, url, response, headers) => accessor.setByIdentity(identityFor(method, url, headers), method, url, response, headers),
    getConditionalHeaders: (method, url, headers) => accessor.conditionalHeadersByIdentity(identityFor(method, url, headers)),
    updateRevalidated: (method, url, responseHeaders, headers) => accessor.updateRevalidatedByIdentity(identityFor(method, url, headers), responseHeaders) ?? undefined
  };
}

exports.registerResponseCacheBackend = registerResponseCacheBackend;
exports.bindResponseCache = bindResponseCache;