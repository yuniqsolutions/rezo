const PERSISTENCE = new WeakMap;
function registerCachePersistence(cache, persistence) {
  PERSISTENCE.set(cache, persistence);
}
function cachePersistence(cache) {
  return PERSISTENCE.get(cache);
}

exports.registerCachePersistence = registerCachePersistence;
exports.cachePersistence = cachePersistence;