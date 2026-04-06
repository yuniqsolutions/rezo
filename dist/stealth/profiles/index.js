import { CHROME_PROFILES } from './chrome-profiles.js';
import { FIREFOX_PROFILES } from './firefox-profiles.js';
import { SAFARI_PROFILES } from './safari-profiles.js';
import { EDGE_PROFILES } from './edge-profiles.js';
export const PROFILE_REGISTRY = new Map([
  ...Object.entries(CHROME_PROFILES),
  ...Object.entries(FIREFOX_PROFILES),
  ...Object.entries(SAFARI_PROFILES),
  ...Object.entries(EDGE_PROFILES)
]);
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
export function getRandomProfile() {
  const profiles = [...PROFILE_REGISTRY.values()];
  return profiles[Math.floor(Math.random() * profiles.length)];
}
export function getRandomProfileByFamily(family) {
  const profiles = getProfilesByFamily(family);
  if (profiles.length === 0)
    throw new Error(`No profiles found for family: ${family}`);
  return profiles[Math.floor(Math.random() * profiles.length)];
}
export { expandPseudoOrder } from './constants.js';
export { CHROME_PROFILES } from './chrome-profiles.js';
export { FIREFOX_PROFILES } from './firefox-profiles.js';
export { SAFARI_PROFILES } from './safari-profiles.js';
export { EDGE_PROFILES } from './edge-profiles.js';
