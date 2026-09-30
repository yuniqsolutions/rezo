const { importNodeModule } = require('../utils/node-runtime.cjs');
const { sha256Hex } = require('./response-cache-identity.cjs');
const ENVELOPE_VERSION = 2;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const MAX_HYDRATED_ARTIFACTS = 1e4;
const ARTIFACT_PREFIX = "rezo-v2-";
const ARTIFACT_NAME = /^rezo-v2-[0-9a-f]{64}\.json$/;
const RESIDUE_NAME = /^rezo-v2-[0-9a-f]{64}\.json\.[a-z0-9]+\.tmp$/;
function artifactName(identity) {
  return `${ARTIFACT_PREFIX}${sha256Hex(identity)}.json`;
}
const VIEW_CONSTRUCTORS = {
  Uint8Array,
  Int8Array,
  Uint8ClampedArray,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array
};
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const INTRINSIC_VIEW_TAG = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag)?.get;
const INTRINSIC_VIEW_BUFFER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "buffer")?.get;
const INTRINSIC_VIEW_OFFSET = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteOffset")?.get;
const INTRINSIC_VIEW_LENGTH = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, "byteLength")?.get;
const INTRINSIC_BUFFER_LENGTH = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")?.get;
const INTRINSIC_BLOB_ARRAY_BUFFER = typeof Blob === "undefined" ? undefined : Blob.prototype.arrayBuffer;
const INTRINSIC_BLOB_TYPE = typeof Blob === "undefined" ? undefined : Object.getOwnPropertyDescriptor(Blob.prototype, "type")?.get;
function intrinsicViewKind(value) {
  if (typeof INTRINSIC_VIEW_TAG !== "function")
    return;
  try {
    const tag = INTRINSIC_VIEW_TAG.call(value);
    return typeof tag === "string" ? tag : undefined;
  } catch {
    return;
  }
}
function intrinsicArrayBufferBytes(value) {
  if (typeof INTRINSIC_BUFFER_LENGTH !== "function")
    return;
  try {
    INTRINSIC_BUFFER_LENGTH.call(value);
  } catch {
    return;
  }
  return new Uint8Array(value).slice();
}
function intrinsicViewBytes(value) {
  if (typeof INTRINSIC_VIEW_BUFFER !== "function" || typeof INTRINSIC_VIEW_OFFSET !== "function" || typeof INTRINSIC_VIEW_LENGTH !== "function")
    return;
  try {
    const buffer = INTRINSIC_VIEW_BUFFER.call(value);
    if (!(buffer instanceof ArrayBuffer))
      return;
    const offset = INTRINSIC_VIEW_OFFSET.call(value);
    const length = INTRINSIC_VIEW_LENGTH.call(value);
    return new Uint8Array(buffer, offset, length).slice();
  } catch {
    return;
  }
}
function toBase64(bytes) {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function fromBase64(value) {
  if (typeof value !== "string" || !CANONICAL_BASE64.test(value))
    return;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : undefined;
}
function serializeEnvelope(envelope) {
  return JSON.stringify(detachPrototypes(envelope));
}
function detachPrototypes(value) {
  if (Array.isArray(value)) {
    const detachedList = [];
    Object.setPrototypeOf(detachedList, null);
    for (let index = 0;index < value.length; index += 1) {
      detachedList[index] = detachPrototypes(value[index]);
    }
    return detachedList;
  }
  if (!value || typeof value !== "object")
    return value;
  const detached = Object.create(null);
  for (const key of Object.keys(value)) {
    detached[key] = detachPrototypes(value[key]);
  }
  return detached;
}
function isWellFormedBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return false;
  const tagged = body;
  const keys = Object.keys(tagged);
  const hasType = tagged.k === "blob" || tagged.k === "view";
  if (keys.length !== (hasType ? 3 : 2) || keys.some((key) => key !== "k" && key !== "v" && !(hasType && key === "t")))
    return false;
  switch (tagged.k) {
    case "json":
      return Object.prototype.hasOwnProperty.call(tagged, "v");
    case "buffer":
    case "arraybuffer":
      return typeof tagged.v === "string";
    case "blob":
      return typeof tagged.v === "string" && typeof tagged.t === "string";
    case "view":
      return typeof tagged.v === "string" && typeof tagged.t === "string" && Object.prototype.hasOwnProperty.call(VIEW_CONSTRUCTORS, tagged.t);
    default:
      return false;
  }
}
function toArrayBuffer(bytes) {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}
function encodeBody(data) {
  try {
    return classifyAndSnapshot(data);
  } catch {
    return;
  }
}
function classifyAndSnapshot(data) {
  if (typeof Buffer === "undefined") {
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data))
      return;
  } else {
    const bufferBytes = intrinsicArrayBufferBytes(data);
    if (bufferBytes)
      return { k: "arraybuffer", v: toBase64(bufferBytes) };
    const viewKind = intrinsicViewKind(data);
    if (viewKind !== undefined) {
      const viewBytes = intrinsicViewBytes(data);
      if (!viewBytes)
        return;
      if (Buffer.isBuffer(data) && viewKind === "Uint8Array") {
        return { k: "buffer", v: toBase64(viewBytes) };
      }
      if (!Object.prototype.hasOwnProperty.call(VIEW_CONSTRUCTORS, viewKind))
        return;
      return { k: "view", t: viewKind, v: toBase64(viewBytes) };
    }
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data) || Buffer.isBuffer(data)) {
      return;
    }
  }
  if (typeof Blob !== "undefined" && data instanceof Blob)
    return PENDING_BLOB;
  const snapshot = snapshotLosslessJson(data, new Set);
  if (!snapshot)
    return;
  return { k: "json", v: snapshot.value };
}
function snapshotLosslessJson(value, seen) {
  if (value === null)
    return { value: null };
  switch (typeof value) {
    case "boolean":
    case "string":
      return { value };
    case "number":
      return Number.isFinite(value) && !Object.is(value, -0) ? { value } : undefined;
    case "object":
      break;
    default:
      return;
  }
  const object = value;
  if (seen.has(object))
    return;
  seen.add(object);
  const descriptors = Object.getOwnPropertyDescriptors(object);
  if (Object.getOwnPropertySymbols(descriptors).length > 0)
    return;
  if (Array.isArray(object)) {
    const lengthDescriptor = descriptors["length"];
    if (!lengthDescriptor || typeof lengthDescriptor.value !== "number")
      return;
    const length = lengthDescriptor.value;
    if (Object.keys(descriptors).length !== length + 1)
      return;
    const copy = [];
    for (let index = 0;index < length; index++) {
      const descriptor = descriptors[index];
      if (!descriptor || "get" in descriptor || "set" in descriptor)
        return;
      const element = snapshotLosslessJson(descriptor.value, seen);
      if (!element)
        return;
      copy.push(element.value);
    }
    return { value: copy };
  }
  if (Object.getPrototypeOf(object) !== Object.prototype)
    return;
  const copy = {};
  for (const key of Object.keys(descriptors)) {
    const descriptor = descriptors[key];
    if ("get" in descriptor || "set" in descriptor)
      return;
    if (!descriptor.enumerable)
      return;
    if (descriptor.value === undefined)
      return;
    if (key === "toJSON")
      return;
    const entry = snapshotLosslessJson(descriptor.value, seen);
    if (!entry)
      return;
    Object.defineProperty(copy, key, {
      value: entry.value,
      writable: true,
      enumerable: true,
      configurable: true
    });
  }
  return { value: copy };
}
const PENDING_BLOB = Object.freeze({ k: "pending-blob" });
function isPendingBlob(body) {
  return body.k === "pending-blob";
}
async function resolveBlobBody(data) {
  try {
    if (typeof INTRINSIC_BLOB_ARRAY_BUFFER !== "function" || typeof INTRINSIC_BLOB_TYPE !== "function")
      return;
    const type = INTRINSIC_BLOB_TYPE.call(data);
    const bytes = new Uint8Array(await INTRINSIC_BLOB_ARRAY_BUFFER.call(data));
    return { k: "blob", v: toBase64(bytes), t: typeof type === "string" ? type : "" };
  } catch {
    return;
  }
}
function decodeBody(body) {
  switch (body.k) {
    case "json":
      return { data: body.v };
    case "buffer": {
      const bytes = fromBase64(body.v);
      return bytes ? { data: bytes } : undefined;
    }
    case "arraybuffer": {
      const bytes = fromBase64(body.v);
      return bytes ? { data: toArrayBuffer(bytes) } : undefined;
    }
    case "blob": {
      if (typeof Blob === "undefined")
        return;
      const bytes = fromBase64(body.v);
      return bytes ? { data: new Blob([toArrayBuffer(bytes)], { type: body.t }) } : undefined;
    }
    case "view": {
      const ViewConstructor = VIEW_CONSTRUCTORS[body.t];
      const bytes = ViewConstructor ? fromBase64(body.v) : undefined;
      return bytes ? { data: new ViewConstructor(toArrayBuffer(bytes)) } : undefined;
    }
    default:
      return;
  }
}
const DIRECTORY_QUEUES = new Map;
const LEASE_FILE = ".rezo-cache-lease.json";
const DIRECTORY_LEASES = new Map;
const DIRECTORY_LEASE_ACQUISITIONS = new Map;
let exitCleanupRegistered = false;
function registerExitCleanup(fs, path) {
  if (exitCleanupRegistered)
    return;
  exitCleanupRegistered = true;
  const host = globalThis.process;
  host?.once?.("exit", () => {
    for (const [directory, lease] of DIRECTORY_LEASES) {
      const leasePath = path.join(directory, LEASE_FILE);
      try {
        const held = JSON.parse(fs.readFileSync(leasePath, "utf-8"));
        if (held.token === lease.token)
          fs.unlinkSync(leasePath);
      } catch {}
    }
  });
}
function enqueue(directory, operation) {
  const previous = DIRECTORY_QUEUES.get(directory) ?? Promise.resolve();
  const next = previous.then(operation, operation);
  DIRECTORY_QUEUES.set(directory, next.then(() => {
    return;
  }, () => {
    return;
  }));
  return next;
}

class ResponseCachePersistence {
  fs;
  path;
  canonicalDirectory = "";
  stateValue;
  settled;
  constructor(requestedDirectory) {
    if (!requestedDirectory) {
      this.stateValue = "not-requested";
      this.settled = Promise.resolve();
      return;
    }
    this.stateValue = "initializing";
    this.settled = this.initialize(requestedDirectory);
  }
  get state() {
    return this.stateValue;
  }
  get isReady() {
    return this.stateValue === "ready";
  }
  async drain() {
    await this.settled;
    if (!this.canonicalDirectory)
      return;
    await (DIRECTORY_QUEUES.get(this.canonicalDirectory) ?? Promise.resolve());
  }
  async initialize(directory) {
    const fs = await importNodeModule("node:fs");
    const path = await importNodeModule("node:path");
    if (!fs?.promises || !path) {
      this.stateValue = "unavailable";
      return;
    }
    try {
      await fs.promises.mkdir(directory, { recursive: true });
      const canonical = await fs.promises.realpath(directory);
      if (!await this.acquireLease(fs, path, canonical)) {
        this.stateValue = "unavailable";
        return;
      }
      this.canonicalDirectory = canonical;
      this.fs = fs;
      this.path = path;
      this.stateValue = "ready";
    } catch {
      this.stateValue = "unavailable";
    }
  }
  async acquireLease(fs, path, directory) {
    const shared = DIRECTORY_LEASES.get(directory);
    if (shared) {
      shared.owners++;
      return true;
    }
    const pending = DIRECTORY_LEASE_ACQUISITIONS.get(directory);
    if (pending) {
      if (!await pending)
        return false;
      const won = DIRECTORY_LEASES.get(directory);
      if (!won)
        return false;
      won.owners++;
      return true;
    }
    const attempt = this.claimLeaseFile(fs, path, directory);
    DIRECTORY_LEASE_ACQUISITIONS.set(directory, attempt);
    try {
      return await attempt;
    } finally {
      DIRECTORY_LEASE_ACQUISITIONS.delete(directory);
    }
  }
  async claimLeaseFile(fs, path, directory) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const leasePath = path.join(directory, LEASE_FILE);
    try {
      await fs.promises.writeFile(leasePath, JSON.stringify(detachPrototypes({
        pid: globalThis.process?.pid ?? null,
        token,
        startedAt: Date.now()
      })), { encoding: "utf-8", flag: "wx" });
    } catch {
      return false;
    }
    DIRECTORY_LEASES.set(directory, { token, owners: 1 });
    registerExitCleanup(fs, path);
    return true;
  }
  artifactPath(identity) {
    return this.path.join(this.canonicalDirectory, artifactName(identity));
  }
  write(identity, entry) {
    const classified = encodeBody(entry.data);
    const body = classified;
    if (!body)
      return;
    const envelope = {
      v: ENVELOPE_VERSION,
      identity: entry.identity,
      status: entry.status,
      statusText: entry.statusText,
      headers: { ...entry.headers },
      body,
      timestamp: entry.timestamp,
      ttl: entry.ttl,
      etag: entry.etag,
      lastModified: entry.lastModified
    };
    const eagerSerialized = isPendingBlob(envelope.body) ? undefined : serializeEnvelope(envelope);
    const pendingBody = isPendingBlob(envelope.body) ? resolveBlobBody(entry.data) : undefined;
    this.afterReady(async () => {
      if (pendingBody) {
        const resolved = await pendingBody;
        if (!resolved)
          return;
        envelope.body = resolved;
      }
      const serialized = eagerSerialized ?? serializeEnvelope(envelope);
      if (Buffer.byteLength(serialized, "utf-8") > MAX_ARTIFACT_BYTES)
        return;
      const fs = this.fs;
      const fileName = artifactName(identity);
      const finalPath = this.artifactPath(identity);
      const temporaryPath = `${finalPath}.${Math.random().toString(36).slice(2)}.tmp`;
      let temporaryCreated = false;
      try {
        const occupantIsForeign = await this.pathIsForeign(fileName);
        if (occupantIsForeign)
          return;
        await fs.promises.writeFile(temporaryPath, serialized, { encoding: "utf-8", flag: "wx" });
        temporaryCreated = true;
        await this.flushPath(temporaryPath, false);
        await fs.promises.rename(temporaryPath, finalPath);
        await this.flushPath(this.canonicalDirectory, true);
      } catch {
        if (temporaryCreated)
          await fs.promises.unlink(temporaryPath).catch(() => {
            return;
          });
      }
    }, undefined);
  }
  remove(identity) {
    this.afterReady(async () => {
      const fileName = artifactName(identity);
      if (!await this.ownsArtifact(fileName))
        return;
      await this.fs.promises.unlink(this.artifactPath(identity)).catch(() => {
        return;
      });
    }, undefined);
  }
  async afterReady(operation, fallback) {
    await this.settled;
    if (!this.isReady)
      return fallback;
    return enqueue(this.canonicalDirectory, operation);
  }
  removeMatching(matches) {
    return this.afterReady(async () => {
      const fs = this.fs;
      const path = this.path;
      const directory = this.canonicalDirectory;
      const removed = [];
      let files;
      try {
        files = await fs.promises.readdir(directory);
      } catch {
        return removed;
      }
      for (const file of files) {
        if (!ARTIFACT_NAME.test(file))
          continue;
        const filePath = path.join(directory, file);
        try {
          const stats = await fs.promises.lstat(filePath);
          if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES)
            continue;
          const envelope = this.decodeNamed(await fs.promises.readFile(filePath, "utf-8"), file);
          if (!envelope || !matches(envelope.identity))
            continue;
          let unlinked = true;
          await fs.promises.unlink(filePath).catch(() => {
            unlinked = false;
          });
          if (unlinked)
            removed.push(envelope.identity);
        } catch {}
      }
      return removed;
    }, []);
  }
  removeAll() {
    this.afterReady(async () => {
      const fs = this.fs;
      const path = this.path;
      const directory = this.canonicalDirectory;
      try {
        const files = await fs.promises.readdir(directory);
        for (const file of files) {
          if (!await this.ownsArtifact(file))
            continue;
          await fs.promises.unlink(path.join(directory, file)).catch(() => {
            return;
          });
        }
      } catch {}
    }, undefined);
  }
  async pathIsForeign(fileName) {
    const filePath = this.path.join(this.canonicalDirectory, fileName);
    try {
      await this.fs.promises.lstat(filePath);
    } catch {
      return false;
    }
    return !await this.ownsArtifact(fileName);
  }
  async flushPath(target, isDirectory) {
    const fs = this.fs;
    let handle;
    try {
      handle = await fs.promises.open(target, isDirectory ? "r" : "r+");
      await handle.sync();
    } catch (error) {
      if (!isDirectory)
        throw error;
    } finally {
      await handle?.close().catch(() => {
        return;
      });
    }
  }
  async reclaimResidue() {
    const fs = this.fs;
    const path = this.path;
    try {
      for (const file of await fs.promises.readdir(this.canonicalDirectory)) {
        if (!RESIDUE_NAME.test(file))
          continue;
        const filePath = path.join(this.canonicalDirectory, file);
        const finalName = file.slice(0, file.indexOf(".json") + ".json".length);
        let owned = false;
        try {
          const stats = await fs.promises.lstat(filePath);
          if (stats.isFile() && stats.size <= MAX_ARTIFACT_BYTES) {
            owned = this.decodeNamed(await fs.promises.readFile(filePath, "utf-8"), finalName) !== undefined;
          }
        } catch {
          owned = false;
        }
        if (!owned)
          continue;
        await fs.promises.unlink(filePath).catch(() => {
          return;
        });
      }
    } catch {}
  }
  async ownsArtifact(fileName) {
    if (!ARTIFACT_NAME.test(fileName))
      return false;
    const fs = this.fs;
    const filePath = this.path.join(this.canonicalDirectory, fileName);
    try {
      const stats = await fs.promises.lstat(filePath);
      if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES)
        return false;
      return this.decodeNamed(await fs.promises.readFile(filePath, "utf-8"), fileName) !== undefined;
    } catch {
      return false;
    }
  }
  readOne(identity) {
    if (!this.isReady)
      return;
    const fs = this.fs;
    const filePath = this.artifactPath(identity);
    try {
      const stats = fs.lstatSync(filePath);
      if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES)
        return;
      const envelope = this.decode(fs.readFileSync(filePath, "utf-8"), identity);
      return envelope;
    } catch {
      return;
    }
  }
  hydrate() {
    if (!this.isReady)
      return Promise.resolve([]);
    return enqueue(this.canonicalDirectory, () => this.readAll());
  }
  async readAll() {
    await this.reclaimResidue();
    const fs = this.fs;
    const path = this.path;
    const directory = this.canonicalDirectory;
    const loaded = [];
    let files;
    try {
      files = await fs.promises.readdir(directory);
    } catch {
      return [];
    }
    let examined = 0;
    for (const file of files) {
      if (examined >= MAX_HYDRATED_ARTIFACTS)
        break;
      if (!ARTIFACT_NAME.test(file))
        continue;
      examined++;
      const filePath = path.join(directory, file);
      try {
        const stats = await fs.promises.lstat(filePath);
        if (!stats.isFile() || stats.size > MAX_ARTIFACT_BYTES)
          continue;
        const raw = await fs.promises.readFile(filePath, "utf-8");
        const envelope = this.decodeNamed(raw, file);
        if (!envelope)
          continue;
        if (envelope.timestamp + envelope.ttl <= Date.now()) {
          await fs.promises.unlink(filePath).catch(() => {
            return;
          });
          continue;
        }
        loaded.push([envelope.identity, envelope]);
      } catch {}
    }
    return loaded;
  }
  decode(raw, expectedIdentity) {
    const envelope = this.parse(raw);
    if (!envelope || envelope.identity !== expectedIdentity)
      return;
    return this.restore(envelope);
  }
  decodeNamed(raw, fileName) {
    const envelope = this.parse(raw);
    if (!envelope)
      return;
    if (artifactName(envelope.identity) !== fileName)
      return;
    return this.restore(envelope);
  }
  restore(envelope) {
    const decoded = decodeBody(envelope.body);
    if (!decoded)
      return;
    return {
      identity: envelope.identity,
      status: envelope.status,
      statusText: envelope.statusText,
      headers: envelope.headers,
      data: decoded.data,
      timestamp: envelope.timestamp,
      ttl: envelope.ttl,
      etag: envelope.etag,
      lastModified: envelope.lastModified
    };
  }
  parse(raw) {
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      return;
    }
    if (!value || typeof value !== "object")
      return;
    const envelope = value;
    const permitted = new Set(["v", "identity", "status", "statusText", "headers", "body", "timestamp", "ttl", "etag", "lastModified"]);
    for (const key of Object.keys(envelope)) {
      if (!permitted.has(key))
        return;
    }
    if (envelope.v !== ENVELOPE_VERSION)
      return;
    if (typeof envelope.identity !== "string" || envelope.identity.length === 0)
      return;
    if (typeof envelope.statusText !== "string")
      return;
    if (!Number.isInteger(envelope.status) || envelope.status < 100 || envelope.status > 599)
      return;
    if (!Number.isFinite(envelope.timestamp) || !Number.isFinite(envelope.ttl))
      return;
    if (envelope.timestamp <= 0 || envelope.ttl <= 0)
      return;
    if (!envelope.headers || typeof envelope.headers !== "object" || Array.isArray(envelope.headers))
      return;
    for (const headerValue of Object.values(envelope.headers)) {
      if (typeof headerValue !== "string")
        return;
    }
    if (envelope.etag !== undefined && typeof envelope.etag !== "string")
      return;
    if (envelope.lastModified !== undefined && typeof envelope.lastModified !== "string")
      return;
    if (!isWellFormedBody(envelope.body))
      return;
    return envelope;
  }
}

exports.ENVELOPE_VERSION = ENVELOPE_VERSION;
exports.ResponseCachePersistence = ResponseCachePersistence;