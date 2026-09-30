const { CHROME_PROFILES } = require('./chrome-profiles.cjs');
const { FIREFOX_PROFILES } = require('./firefox-profiles.cjs');
const { SAFARI_PROFILES } = require('./safari-profiles.cjs');
const { EDGE_PROFILES } = require('./edge-profiles.cjs');
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value))
      deepFreeze(inner);
  }
  return value;
}
const registry = new Map;
for (const [id, profile] of [
  ...Object.entries(CHROME_PROFILES),
  ...Object.entries(FIREFOX_PROFILES),
  ...Object.entries(SAFARI_PROFILES),
  ...Object.entries(EDGE_PROFILES)
])
  registry.set(id, deepFreeze(profile));
const refuse = (operation) => () => {
  throw new TypeError(`PROFILE_REGISTRY is immutable: ${operation} is not allowed`);
};
Object.defineProperties(registry, {
  set: { value: refuse("set"), writable: false, configurable: false },
  delete: { value: refuse("delete"), writable: false, configurable: false },
  clear: { value: refuse("clear"), writable: false, configurable: false }
});
Object.freeze(registry);
const PROFILE_REGISTRY = exports.PROFILE_REGISTRY = registry;
function getProfile(id) {
  return PROFILE_REGISTRY.get(id);
}
function getProfilesByFamily(family) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if (profile.family === family)
      result.push(profile);
  }
  return result;
}
function getProfilesByDevice(device) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if (profile.device === device)
      result.push(profile);
  }
  return result;
}
function listProfiles() {
  return [...PROFILE_REGISTRY.keys()];
}
function listProfilesByFamily(family) {
  return getProfilesByFamily(family).map((p) => p.id);
}
function isRetiredProfile(profile) {
  if (profile.esr)
    return false;
  let current = 0;
  for (const candidate of PROFILE_REGISTRY.values())
    if (candidate.family === profile.family && !candidate.esr && candidate.majorVersion > current)
      current = candidate.majorVersion;
  return profile.majorVersion < current - 2;
}
function listActiveProfiles(family) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if ((family === undefined || profile.family === family) && !isRetiredProfile(profile))
      result.push(profile);
  }
  return result;
}
function getRandomProfile() {
  const profiles = listActiveProfiles();
  return profiles[Math.floor(Math.random() * profiles.length)];
}
function getRandomProfileByFamily(family) {
  const profiles = listActiveProfiles(family);
  if (profiles.length === 0)
    throw new Error(`No profiles found for family: ${family}`);
  return profiles[Math.floor(Math.random() * profiles.length)];
}
const _mod_yakujz = require('./constants.cjs');
exports.expandPseudoOrder = _mod_yakujz.expandPseudoOrder;;
const _mod_yoenq7 = require('./chrome-profiles.cjs');
exports.CHROME_PROFILES = _mod_yoenq7.CHROME_PROFILES;;
const _mod_bmazs4 = require('./firefox-profiles.cjs');
exports.FIREFOX_PROFILES = _mod_bmazs4.FIREFOX_PROFILES;;
const _mod_uc81m5 = require('./safari-profiles.cjs');
exports.SAFARI_PROFILES = _mod_uc81m5.SAFARI_PROFILES;;
const _mod_a9uzgr = require('./edge-profiles.cjs');
exports.EDGE_PROFILES = _mod_a9uzgr.EDGE_PROFILES;;

exports.getProfile = getProfile;
exports.getProfilesByFamily = getProfilesByFamily;
exports.getProfilesByDevice = getProfilesByDevice;
exports.listProfiles = listProfiles;
exports.listProfilesByFamily = listProfilesByFamily;
exports.isRetiredProfile = isRetiredProfile;
exports.listActiveProfiles = listActiveProfiles;
exports.getRandomProfile = getRandomProfile;
exports.getRandomProfileByFamily = getRandomProfileByFamily;