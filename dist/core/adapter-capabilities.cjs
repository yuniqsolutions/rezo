const REGISTRY_KEY = Symbol.for("solutions.yuniq.rezo.internal.adapter-capability-registry.v1");
const INVALID_REGISTRY_MESSAGE = "[Rezo] Invalid adapter capability registry v1; refusing to overwrite the existing realm slot.";
const INVALID_VISIBILITY_MESSAGE = "[Rezo] A registered adapter returned an invalid redirect visibility result.";
const VISIBLE = Object.freeze({ visibility: "visible" });
const HIDDEN = Object.freeze({
  "curl-native": Object.freeze({ visibility: "hidden", lane: "curl-native" }),
  "react-native-stock-fetch": Object.freeze({
    visibility: "hidden",
    lane: "react-native-stock-fetch"
  }),
  "react-native-file-upload": Object.freeze({
    visibility: "hidden",
    lane: "react-native-file-upload"
  }),
  "react-native-file-download": Object.freeze({
    visibility: "hidden",
    lane: "react-native-file-download"
  }),
  "browser-fetch": Object.freeze({ visibility: "hidden", lane: "browser-fetch" }),
  xhr: Object.freeze({ visibility: "hidden", lane: "xhr" })
});
const LANE_INFO = Object.freeze({
  "curl-native": Object.freeze({ adapter: "curl", label: "Native cURL" }),
  "react-native-stock-fetch": Object.freeze({
    adapter: "react-native",
    label: "React Native stock Fetch"
  }),
  "react-native-file-upload": Object.freeze({
    adapter: "react-native",
    label: "React Native file upload provider"
  }),
  "react-native-file-download": Object.freeze({
    adapter: "react-native",
    label: "React Native file download provider"
  }),
  "browser-fetch": Object.freeze({ adapter: "fetch", label: "Browser Fetch" }),
  xhr: Object.freeze({ adapter: "xhr", label: "XMLHttpRequest" })
});
function isRegistry(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  try {
    if (!Object.isFrozen(value))
      return false;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== 2 || !keys.includes("protocol") || !keys.includes("adapters")) {
      return false;
    }
    const protocol = Object.getOwnPropertyDescriptor(value, "protocol");
    const adapters = Object.getOwnPropertyDescriptor(value, "adapters");
    return !!protocol && "value" in protocol && protocol.configurable === false && protocol.enumerable === true && protocol.writable === false && protocol.value === 1 && !!adapters && "value" in adapters && adapters.configurable === false && adapters.enumerable === true && adapters.writable === false && adapters.value instanceof WeakMap;
  } catch {
    return false;
  }
}
function getRegistry(create) {
  const existing = Object.getOwnPropertyDescriptor(globalThis, REGISTRY_KEY);
  if (existing) {
    if (existing.configurable !== false || existing.enumerable !== false || existing.writable !== false || !isRegistry(existing.value)) {
      throw new Error(INVALID_REGISTRY_MESSAGE);
    }
    return existing.value;
  }
  if (!create)
    return;
  const registry = Object.freeze({
    protocol: 1,
    adapters: new WeakMap
  });
  Object.defineProperty(globalThis, REGISTRY_KEY, {
    configurable: false,
    enumerable: false,
    value: registry,
    writable: false
  });
  return registry;
}
function normalizeVisibility(result) {
  if (result?.visibility === "visible")
    return VISIBLE;
  if (result?.visibility === "hidden" && Object.prototype.hasOwnProperty.call(HIDDEN, result.lane)) {
    return HIDDEN[result.lane];
  }
  throw new Error(INVALID_VISIBILITY_MESSAGE);
}
function visibleRedirectVisibility() {
  return VISIBLE;
}
function hiddenRedirectVisibility(lane) {
  return HIDDEN[lane];
}
function registerAdapterCapabilities(adapter, descriptor) {
  const frozenDescriptor = Object.freeze({
    evaluateRedirectVisibility: descriptor.evaluateRedirectVisibility
  });
  getRegistry(true).adapters.set(adapter, frozenDescriptor);
}
function evaluateAdapterRedirectVisibility(adapter, context) {
  const descriptor = getRegistry(false)?.adapters.get(adapter);
  if (!descriptor)
    return VISIBLE;
  return normalizeVisibility(descriptor.evaluateRedirectVisibility(context));
}
function collectRedirectGuarantees(context) {
  const guarantees = [];
  if (typeof context.request.beforeRedirect === "function" || typeof context.defaults.beforeRedirect === "function") {
    guarantees.push("beforeRedirect");
  }
  if (typeof context.request.onRedirect === "function" || typeof context.defaults.onRedirect === "function") {
    guarantees.push("onRedirect");
  }
  if (context.request.hooks?.beforeRedirect?.length || context.defaults.hooks?.beforeRedirect?.length || context.effectiveHooks.beforeRedirect?.length) {
    guarantees.push("hooks.beforeRedirect");
  }
  return Object.freeze(guarantees);
}
function formatUnsupportedRedirectCapabilities(lane, guarantees) {
  const label = LANE_INFO[lane].label;
  if (lane === "curl-native") {
    return `${label} cannot enforce redirect capability "${guarantees.join(", ")}" before dispatch.`;
  }
  const noun = guarantees.length === 1 ? "capability" : "capabilities";
  const names = guarantees.map((guarantee) => `"${guarantee}"`).join(", ");
  return `${label} cannot enforce redirect ${noun} ${names} before dispatch.`;
}
function getRedirectLaneAdapter(lane) {
  return LANE_INFO[lane].adapter;
}

exports.visibleRedirectVisibility = visibleRedirectVisibility;
exports.hiddenRedirectVisibility = hiddenRedirectVisibility;
exports.registerAdapterCapabilities = registerAdapterCapabilities;
exports.evaluateAdapterRedirectVisibility = evaluateAdapterRedirectVisibility;
exports.collectRedirectGuarantees = collectRedirectGuarantees;
exports.formatUnsupportedRedirectCapabilities = formatUnsupportedRedirectCapabilities;
exports.getRedirectLaneAdapter = getRedirectLaneAdapter;