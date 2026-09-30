const { RezoHeaders } = require('./headers.cjs');
const { classifyRedirectOrigin } = require('./tools.cjs');
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const INVALID_URL = Object.freeze({ ok: false, reason: "invalid-url" });

class ImmutableRedirectHeaderPatch {
  #orderedEntries;
  constructor(entries) {
    this.#orderedEntries = Object.freeze([...entries]);
    Object.freeze(this);
  }
  get size() {
    return this.#orderedEntries.length;
  }
  get(name) {
    const normalizedName = name.toLowerCase();
    return this.#orderedEntries.find(([entryName]) => entryName === normalizedName)?.[1];
  }
  *entries() {
    yield* this.#orderedEntries;
  }
}
function normalizeUrl(value, base) {
  try {
    const url = value instanceof URL ? new URL(value.href) : new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      return;
    if (url.username || url.password)
      return;
    return url;
  } catch {
    return;
  }
}
function normalizeHeaderName(value) {
  if (typeof value !== "string" || !HEADER_NAME.test(value)) {
    throw new TypeError("Invalid header name");
  }
  return value.toLowerCase();
}
function normalizeHeaderValues(value) {
  if (value === undefined)
    return null;
  const isArrayValue = Array.isArray(value);
  const candidates = isArrayValue ? value : [value];
  if (candidates.length === 0)
    return null;
  const normalized = candidates.map((candidate) => {
    if (!isArrayValue && typeof candidate === "number") {
      if (!Number.isFinite(candidate))
        throw new TypeError("Invalid header value");
    } else if (typeof candidate !== "string") {
      throw new TypeError("Invalid header value");
    }
    const text = String(candidate);
    for (let index = 0;index < text.length; index++) {
      const codeUnit = text.charCodeAt(index);
      const isForbiddenControl = codeUnit < 32 && codeUnit !== 9;
      if (isForbiddenControl || codeUnit === 127 || codeUnit > 255) {
        throw new TypeError("Invalid header value");
      }
    }
    return text.replace(/^[\t ]+|[\t ]+$/g, "");
  });
  return normalized;
}
function snapshotRedirectHeaders(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    throw new TypeError("Invalid header carrier");
  }
  const operations = new Map;
  const apply = (rawName, rawValue) => {
    const name = normalizeHeaderName(rawName);
    const values = normalizeHeaderValues(rawValue);
    if (values === null || name === "proxy-authorization") {
      operations.set(name, { kind: "delete" });
      return;
    }
    const previous = operations.get(name);
    operations.set(name, {
      kind: "set",
      values: previous?.kind === "set" ? [...previous.values, ...values] : [...values]
    });
  };
  const knownIterable = value instanceof Headers || Array.isArray(value);
  const ownKeys = knownIterable ? [] : Object.keys(value);
  const iterator = !knownIterable && ownKeys.length === 0 ? Reflect.get(value, Symbol.iterator) : undefined;
  const useIterator = knownIterable || typeof iterator === "function";
  if (knownIterable) {
    for (const entry of value) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError("Invalid header entry");
      }
      apply(entry[0], entry[1]);
    }
  } else if (useIterator) {
    const capturedIterable = {
      [Symbol.iterator]() {
        return Reflect.apply(iterator, value, []);
      }
    };
    for (const entry of capturedIterable) {
      if (!Array.isArray(entry) || entry.length !== 2) {
        throw new TypeError("Invalid header entry");
      }
      apply(entry[0], entry[1]);
    }
  } else {
    for (const name of ownKeys)
      apply(name, Reflect.get(value, name));
  }
  const entries = [...operations].map(([name, operation]) => {
    const frozenOperation = operation.kind === "delete" ? Object.freeze({ kind: "delete" }) : Object.freeze({
      kind: "set",
      values: Object.freeze([...operation.values])
    });
    return Object.freeze([name, frozenOperation]);
  });
  return new ImmutableRedirectHeaderPatch(entries);
}
function snapshotField(field, name) {
  if (field?.kind === "absent")
    return Object.freeze({ kind: "absent" });
  if (field?.kind !== "present") {
    return Object.freeze({ ok: false, reason: "invalid-header-patch", field: name });
  }
  try {
    return Object.freeze({ kind: "present", patch: snapshotRedirectHeaders(field.value) });
  } catch {
    return Object.freeze({ ok: false, reason: "invalid-header-patch", field: name });
  }
}
function createState(currentUrl, redirectCount, history, persistent, oneHop) {
  return Object.freeze({
    currentUrl,
    redirectCount,
    history: Object.freeze([...history]),
    persistent,
    oneHop
  });
}
function createRedirectHeaderPolicyState(initialNormalizedUrl) {
  const url = normalizeUrl(initialNormalizedUrl);
  if (!url)
    return INVALID_URL;
  return Object.freeze({
    ok: true,
    state: createState(url.href, 0, [url.href], null, null)
  });
}
function stageRedirectHeaderTransition(current, input) {
  const finalizedUrl = normalizeUrl(input.finalizedNormalizedUrl, current.currentUrl);
  if (!finalizedUrl)
    return INVALID_URL;
  const oneHopField = snapshotField(input.setHeaders, "setHeaders");
  if ("ok" in oneHopField)
    return oneHopField;
  const persistentField = snapshotField(input.setHeadersOnRedirects, "setHeadersOnRedirects");
  if ("ok" in persistentField)
    return persistentField;
  const relation = classifyRedirectOrigin(current.currentUrl, finalizedUrl);
  if (relation === "invalid")
    return INVALID_URL;
  let persistent = current.persistent;
  if (persistent && classifyRedirectOrigin(persistent.anchorOrigin, finalizedUrl) !== "same-origin") {
    persistent = null;
  }
  if (persistentField.kind === "present") {
    persistent = persistentField.patch.size === 0 ? null : Object.freeze({
      anchorOrigin: finalizedUrl.origin,
      patch: persistentField.patch
    });
  }
  const oneHop = oneHopField.kind === "present" && oneHopField.patch.size > 0 ? oneHopField.patch : null;
  const state = createState(finalizedUrl.href, current.redirectCount + 1, [...current.history, finalizedUrl.href], persistent, oneHop);
  return Object.freeze({ ok: true, relation, state });
}
function applyPatch(target, patch) {
  for (const [name, operation] of patch.entries()) {
    if (operation.kind === "delete") {
      target.delete(name);
      continue;
    }
    target.set(name, operation.values[0]);
    for (const value of operation.values.slice(1))
      target.append(name, value);
  }
}
function composeRedirectHeaders(state, layers) {
  const result = new RezoHeaders(layers.targetBase);
  applyPatch(result, snapshotRedirectHeaders(layers.destinationHeaders));
  if (state.persistent)
    applyPatch(result, state.persistent.patch);
  if (state.oneHop)
    applyPatch(result, state.oneHop);
  result.delete("proxy-authorization");
  return result;
}

exports.composeRedirectHeaders = composeRedirectHeaders;
exports.createRedirectHeaderPolicyState = createRedirectHeaderPolicyState;
exports.stageRedirectHeaderTransition = stageRedirectHeaderTransition;