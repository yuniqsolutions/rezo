const PERSISTENCE = new WeakMap;
export function registerCachePersistence(cache, persistence) {
  PERSISTENCE.set(cache, persistence);
}
export function cachePersistence(cache) {
  return PERSISTENCE.get(cache);
}
