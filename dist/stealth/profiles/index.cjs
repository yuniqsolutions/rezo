const { CHROME_PROFILES } = require('./chrome-profiles.cjs');
const { FIREFOX_PROFILES } = require('./firefox-profiles.cjs');
const { SAFARI_PROFILES } = require('./safari-profiles.cjs');
const { EDGE_PROFILES } = require('./edge-profiles.cjs');
const PROFILE_REGISTRY = exports.PROFILE_REGISTRY = new Map([
  ...Object.entries(CHROME_PROFILES),
  ...Object.entries(FIREFOX_PROFILES),
  ...Object.entries(SAFARI_PROFILES),
  ...Object.entries(EDGE_PROFILES)
]);
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
function getRandomProfile() {
  const profiles = [...PROFILE_REGISTRY.values()];
  return profiles[Math.floor(Math.random() * profiles.length)];
}
function getRandomProfileByFamily(family) {
  const profiles = getProfilesByFamily(family);
  if (profiles.length === 0)
    throw new Error(`No profiles found for family: ${family}`);
  return profiles[Math.floor(Math.random() * profiles.length)];
}
const _mod_jwfhdb = require('./constants.cjs');
exports.expandPseudoOrder = _mod_jwfhdb.expandPseudoOrder;;
const _mod_p2i0sl = require('./chrome-profiles.cjs');
exports.CHROME_PROFILES = _mod_p2i0sl.CHROME_PROFILES;;
const _mod_wy3mxw = require('./firefox-profiles.cjs');
exports.FIREFOX_PROFILES = _mod_wy3mxw.FIREFOX_PROFILES;;
const _mod_zja6i5 = require('./safari-profiles.cjs');
exports.SAFARI_PROFILES = _mod_zja6i5.SAFARI_PROFILES;;
const _mod_5jn80q = require('./edge-profiles.cjs');
exports.EDGE_PROFILES = _mod_5jn80q.EDGE_PROFILES;;

exports.getProfile = getProfile;
exports.getProfilesByFamily = getProfilesByFamily;
exports.getProfilesByDevice = getProfilesByDevice;
exports.listProfiles = listProfiles;
exports.listProfilesByFamily = listProfilesByFamily;
exports.getRandomProfile = getRandomProfile;
exports.getRandomProfileByFamily = getRandomProfileByFamily;