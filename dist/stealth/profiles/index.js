import { CHROME_PROFILES } from './chrome-profiles.js';
import { FIREFOX_PROFILES } from './firefox-profiles.js';
import { SAFARI_PROFILES } from './safari-profiles.js';
import { EDGE_PROFILES } from './edge-profiles.js';
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
export const PROFILE_REGISTRY = registry;
export function getProfile(id) {
  return PROFILE_REGISTRY.get(id);
}
export function getProfilesByFamily(family) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if (profile.family === family)
      result.push(profile);
  }
  return result;
}
export function getProfilesByDevice(device) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if (profile.device === device)
      result.push(profile);
  }
  return result;
}
export function listProfiles() {
  return [...PROFILE_REGISTRY.keys()];
}
export function listProfilesByFamily(family) {
  return getProfilesByFamily(family).map((p) => p.id);
}
export function isRetiredProfile(profile) {
  if (profile.esr)
    return false;
  let current = 0;
  for (const candidate of PROFILE_REGISTRY.values())
    if (candidate.family === profile.family && !candidate.esr && candidate.majorVersion > current)
      current = candidate.majorVersion;
  return profile.majorVersion < current - 2;
}
export function listActiveProfiles(family) {
  const result = [];
  for (const profile of PROFILE_REGISTRY.values()) {
    if ((family === undefined || profile.family === family) && !isRetiredProfile(profile))
      result.push(profile);
  }
  return result;
}
export function getRandomProfile() {
  const profiles = listActiveProfiles();
  return profiles[Math.floor(Math.random() * profiles.length)];
}
export function getRandomProfileByFamily(family) {
  const profiles = listActiveProfiles(family);
  if (profiles.length === 0)
    throw new Error(`No profiles found for family: ${family}`);
  return profiles[Math.floor(Math.random() * profiles.length)];
}
export { expandPseudoOrder } from './constants.js';
export { CHROME_PROFILES } from './chrome-profiles.js';
export { FIREFOX_PROFILES } from './firefox-profiles.js';
export { SAFARI_PROFILES } from './safari-profiles.js';
export { EDGE_PROFILES } from './edge-profiles.js';
