import { resolveProfile, detectProfileFromUserAgent } from './resolver.js';
import { getRandomProfile, getRandomProfileByFamily } from './profiles/index.js';

export class RezoStealth {
  _input;
  _resolved;
  _autoDetect;
  _rotate;
  constructor(input) {
    this._input = input;
    this._autoDetect = input === undefined;
    this._rotate = typeof input === "object" && input !== null && !("id" in input) && !!input.rotate;
  }
  get isAutoDetect() {
    return this._autoDetect;
  }
  get isRotate() {
    return this._rotate;
  }
  resolve(userAgent) {
    if (this._rotate) {
      return resolveProfile(this._input);
    }
    if (!this._resolved) {
      if (this._autoDetect) {
        if (userAgent) {
          const profile = detectProfileFromUserAgent(userAgent);
          this._resolved = resolveProfile(profile ?? getRandomProfileByFamily("chrome"));
        } else {
          this._resolved = resolveProfile(getRandomProfileByFamily("chrome"));
        }
      } else {
        this._resolved = resolveProfile(this._input);
      }
    }
    return this._resolved;
  }
  get profileName() {
    return this.resolve().profileId;
  }
  get profile() {
    return this.resolve().profile;
  }
  withOverrides(overrides) {
    const base = this.resolve();
    return new RezoStealth({
      profile: base.profile,
      ...overrides
    });
  }
  static from(name) {
    return new RezoStealth(name);
  }
  static chrome() {
    return new RezoStealth({ family: "chrome" });
  }
  static firefox() {
    return new RezoStealth({ family: "firefox" });
  }
  static safari() {
    return new RezoStealth({ family: "safari" });
  }
  static edge() {
    return new RezoStealth({ family: "edge" });
  }
  static random() {
    return new RezoStealth(getRandomProfile());
  }
  static fromUserAgent(userAgent) {
    const profile = detectProfileFromUserAgent(userAgent);
    if (profile)
      return new RezoStealth(profile);
    return RezoStealth.chrome();
  }
}
