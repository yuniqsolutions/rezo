const HEADER_FRAME = "rezo.response-cache.headers.v2";
const IDENTITY_FRAME = "rezo.response-cache.identity.v2";
const BOUND_NAMESPACE = "rezo.rc.v2.bound";
const UNBOUND_NAMESPACE = "rezo.rc.v2.unbound";
const K = new Uint32Array([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
function utf8Bytes(value) {
  const bytes = [];
  for (let index = 0;index < value.length; index++) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 55296 && codePoint <= 56319 && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 56320 && low <= 57343) {
        codePoint = (codePoint - 55296 << 10) + (low - 56320) + 65536;
        index++;
      }
    }
    if (codePoint < 128) {
      bytes.push(codePoint);
    } else if (codePoint < 2048) {
      bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
    } else if (codePoint < 65536) {
      bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    } else {
      bytes.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
    }
  }
  return bytes;
}
function sha256Hex(input) {
  const bytes = utf8Bytes(input);
  const bitLength = bytes.length * 8;
  bytes.push(128);
  while (bytes.length % 64 !== 56)
    bytes.push(0);
  bytes.push(0, 0, 0, 0);
  bytes.push(bitLength >>> 24 & 255, bitLength >>> 16 & 255, bitLength >>> 8 & 255, bitLength & 255);
  const hash = new Uint32Array([
    1779033703,
    3144134277,
    1013904242,
    2773480762,
    1359893119,
    2600822924,
    528734635,
    1541459225
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0;offset < bytes.length; offset += 64) {
    for (let i = 0;i < 16; i++) {
      w[i] = (bytes[offset + i * 4] << 24 | bytes[offset + i * 4 + 1] << 16 | bytes[offset + i * 4 + 2] << 8 | bytes[offset + i * 4 + 3]) >>> 0;
    }
    for (let i = 16;i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7 | w[i - 15] << 25) ^ (w[i - 15] >>> 18 | w[i - 15] << 14) ^ w[i - 15] >>> 3) >>> 0;
      const s1 = ((w[i - 2] >>> 17 | w[i - 2] << 15) ^ (w[i - 2] >>> 19 | w[i - 2] << 13) ^ w[i - 2] >>> 10) >>> 0;
      w[i] = w[i - 16] + s0 + w[i - 7] + s1 >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let i = 0;i < 64; i++) {
      const S1 = ((e >>> 6 | e << 26) ^ (e >>> 11 | e << 21) ^ (e >>> 25 | e << 7)) >>> 0;
      const ch = (e & f ^ ~e & g) >>> 0;
      const temp1 = h + S1 + ch + K[i] + w[i] >>> 0;
      const S0 = ((a >>> 2 | a << 30) ^ (a >>> 13 | a << 19) ^ (a >>> 22 | a << 10)) >>> 0;
      const maj = (a & b ^ a & c ^ b & c) >>> 0;
      const temp2 = S0 + maj >>> 0;
      h = g;
      g = f;
      f = e;
      e = d + temp1 >>> 0;
      d = c;
      c = b;
      b = a;
      a = temp1 + temp2 >>> 0;
    }
    hash[0] = hash[0] + a >>> 0;
    hash[1] = hash[1] + b >>> 0;
    hash[2] = hash[2] + c >>> 0;
    hash[3] = hash[3] + d >>> 0;
    hash[4] = hash[4] + e >>> 0;
    hash[5] = hash[5] + f >>> 0;
    hash[6] = hash[6] + g >>> 0;
    hash[7] = hash[7] + h >>> 0;
  }
  let hex = "";
  for (let i = 0;i < 8; i++)
    hex += hash[i].toString(16).padStart(8, "0");
  return hex;
}
const CACHE_DERIVED_HEADERS = new Set(["if-none-match", "if-modified-since"]);
function canonicalizeHeaderMultimap(headers) {
  if (!headers)
    return `${HEADER_FRAME}|0|`;
  const entries = [];
  for (const rawName of Object.keys(headers)) {
    const value = headers[rawName];
    if (value === undefined)
      continue;
    const name = rawName.toLowerCase();
    if (CACHE_DERIVED_HEADERS.has(name))
      continue;
    const values = Array.isArray(value) ? value.map(String) : [String(value)];
    const existing = entries.find(([candidate]) => candidate === name);
    if (existing)
      existing[1].push(...values);
    else
      entries.push([name, values]);
  }
  entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  let encoded = `${HEADER_FRAME}|${entries.length}|`;
  for (const [name, values] of entries) {
    encoded += `${utf8Bytes(name).length}:${name}|${values.length}|`;
    for (const value of values)
      encoded += `${utf8Bytes(value).length}:${value}|`;
  }
  return encoded;
}
function headerMultimapDigest(headers) {
  return sha256Hex(canonicalizeHeaderMultimap(headers));
}
function createResponseCacheIdentity(input) {
  const namespace = input.mode === null ? UNBOUND_NAMESPACE : BOUND_NAMESPACE;
  const method = String(input.method || "GET").toUpperCase();
  const urlDigest = sha256Hex(`${IDENTITY_FRAME}|url|${utf8Bytes(input.url).length}:${input.url}`);
  const mode = input.mode === null ? "-" : input.mode;
  const digest = headerMultimapDigest(input.headers);
  const credentials = input.credentials ?? "unknown-scope";
  return `${namespace}|${method}|${urlDigest}|${mode}|${digest}|${credentials}`;
}
function identityMatchesTarget(identity, method, url) {
  const parts = identity.split("|");
  if (parts.length !== 6)
    return false;
  const [, identityMethod, identityUrlDigest] = parts;
  if (method !== undefined && identityMethod !== String(method).toUpperCase())
    return false;
  return identityUrlDigest === sha256Hex(`${IDENTITY_FRAME}|url|${utf8Bytes(url).length}:${url}`);
}

exports.sha256Hex = sha256Hex;
exports.canonicalizeHeaderMultimap = canonicalizeHeaderMultimap;
exports.headerMultimapDigest = headerMultimapDigest;
exports.createResponseCacheIdentity = createResponseCacheIdentity;
exports.identityMatchesTarget = identityMatchesTarget;