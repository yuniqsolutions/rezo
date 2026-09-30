const CORE_OWNED = new WeakSet;
export function claimCoreCacheOwnership(workingConfig) {
  if (workingConfig)
    CORE_OWNED.add(workingConfig);
}
export function releaseCoreCacheOwnership(workingConfig) {
  if (workingConfig)
    CORE_OWNED.delete(workingConfig);
}
export function takeCoreCacheOwnership(workingConfig) {
  if (!workingConfig || !CORE_OWNED.has(workingConfig))
    return false;
  CORE_OWNED.delete(workingConfig);
  return true;
}
