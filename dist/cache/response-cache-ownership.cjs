const CORE_OWNED = new WeakSet;
function claimCoreCacheOwnership(workingConfig) {
  if (workingConfig)
    CORE_OWNED.add(workingConfig);
}
function releaseCoreCacheOwnership(workingConfig) {
  if (workingConfig)
    CORE_OWNED.delete(workingConfig);
}
function takeCoreCacheOwnership(workingConfig) {
  if (!workingConfig || !CORE_OWNED.has(workingConfig))
    return false;
  CORE_OWNED.delete(workingConfig);
  return true;
}

exports.claimCoreCacheOwnership = claimCoreCacheOwnership;
exports.releaseCoreCacheOwnership = releaseCoreCacheOwnership;
exports.takeCoreCacheOwnership = takeCoreCacheOwnership;