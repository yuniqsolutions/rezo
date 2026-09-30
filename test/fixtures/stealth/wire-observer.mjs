// Wire observers for the stealth carriers (Phase 1, PLAN/stealth-wire-fidelity v4).
//
// Everything a stealth identity claims is measured here from the SERVER side of a real connection:
//  - a raw `net` server parses the TLS ClientHello (cipher order, sigalgs, supported groups, key-share
//    groups, ALPN, supported versions, extension order) — the client never completes the handshake;
//  - an HTTPS/1.1 server records `req.rawHeaders` in wire order;
//  - an HTTP/2 server records the stream's raw header order (pseudo + regular) and its remote settings;
//  - a raw TLS server speaks just enough HTTP/2 to record the client's SETTINGS frame (id set, values,
//    order) and its connection-level WINDOW_UPDATE increment;
//  - CONNECT, HTTP-forward and SOCKS5 proxy fixtures for the route-parity rows.
// Certificates are generated per run with the pinned OpenSSL CLI (subjectAltName=IP:127.0.0.1 — a CN-only
// self-signed certificate crashes Chrome 146; see the audit notes).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import * as http from 'node:http';
import * as http2 from 'node:http2';
import * as https from 'node:https';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tls from 'node:tls';

export const OPENSSL_PATH = '/opt/homebrew/bin/openssl';

/** Generates a fresh EC P-256 self-signed certificate with IP and DNS SANs for 127.0.0.1 / localhost. */
export function generateSanCertificate() {
  const dir = mkdtempSync(join(tmpdir(), 'stealth-cert-'));
  const key = join(dir, 'key.pem'); const cert = join(dir, 'cert.pem');
  const result = spawnSync(OPENSSL_PATH, ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr}`);
  return { key: readFileSync(key, 'utf8'), cert: readFileSync(cert, 'utf8') };
}

// ——— ClientHello parsing ———

const CIPHER_NAMES = new Map([
  [0x1301, 'TLS_AES_128_GCM_SHA256'], [0x1302, 'TLS_AES_256_GCM_SHA384'], [0x1303, 'TLS_CHACHA20_POLY1305_SHA256'],
  [0xc02b, 'ECDHE-ECDSA-AES128-GCM-SHA256'], [0xc02f, 'ECDHE-RSA-AES128-GCM-SHA256'],
  [0xc02c, 'ECDHE-ECDSA-AES256-GCM-SHA384'], [0xc030, 'ECDHE-RSA-AES256-GCM-SHA384'],
  [0xcca9, 'ECDHE-ECDSA-CHACHA20-POLY1305'], [0xcca8, 'ECDHE-RSA-CHACHA20-POLY1305'],
  [0xc009, 'ECDHE-ECDSA-AES128-SHA'], [0xc00a, 'ECDHE-ECDSA-AES256-SHA'],
  [0xc013, 'ECDHE-RSA-AES128-SHA'], [0xc014, 'ECDHE-RSA-AES256-SHA'],
  [0x009c, 'AES128-GCM-SHA256'], [0x009d, 'AES256-GCM-SHA384'], [0x002f, 'AES128-SHA'], [0x0035, 'AES256-SHA'],
  [0x000a, 'DES-CBC3-SHA'], [0x00ff, 'TLS_EMPTY_RENEGOTIATION_INFO_SCSV'],
]);
const SIGALG_NAMES = new Map([
  [0x0403, 'ecdsa_secp256r1_sha256'], [0x0503, 'ecdsa_secp384r1_sha384'], [0x0603, 'ecdsa_secp521r1_sha512'],
  [0x0804, 'rsa_pss_rsae_sha256'], [0x0805, 'rsa_pss_rsae_sha384'], [0x0806, 'rsa_pss_rsae_sha512'],
  [0x0401, 'rsa_pkcs1_sha256'], [0x0501, 'rsa_pkcs1_sha384'], [0x0601, 'rsa_pkcs1_sha512'],
  [0x0203, 'ecdsa_sha1'], [0x0201, 'rsa_pkcs1_sha1'],
  [0x0809, 'rsa_pss_pss_sha256'], [0x080a, 'rsa_pss_pss_sha384'], [0x080b, 'rsa_pss_pss_sha512'],
  [0x0807, 'ed25519'], [0x0808, 'ed448'],
]);
const GROUP_NAMES = new Map([
  [0x001d, 'X25519'], [0x0017, 'prime256v1'], [0x0018, 'secp384r1'], [0x0019, 'secp521r1'], [0x001e, 'X448'],
  [0x11ec, 'X25519MLKEM768'], [0x6399, 'X25519Kyber768Draft00'], [0x0100, 'ffdhe2048'], [0x0101, 'ffdhe3072'],
  [0x0102, 'ffdhe4096'], [0x11eb, 'SecP256r1MLKEM768'], [0x11ed, 'SecP384r1MLKEM1024'],
]);
const isGrease = (value) => (value & 0x0f0f) === 0x0a0a && ((value >> 8) & 0xff) === (value & 0xff);
const hex = (value) => `0x${value.toString(16).padStart(4, '0')}`;
const nameOf = (table, value) => (isGrease(value) ? `GREASE(${hex(value)})` : table.get(value) ?? hex(value));

/** Parses a complete TLS ClientHello handshake message (record layer + handshake header included). */
export function parseClientHello(buffer) {
  if (buffer.length < 11 || buffer[0] !== 0x16) throw new Error('not a TLS handshake record');
  const recordLength = buffer.readUInt16BE(3);
  if (buffer.length < 5 + recordLength) throw new Error('incomplete record');
  const hello = buffer.subarray(5, 5 + recordLength);
  if (hello[0] !== 0x01) throw new Error('not a ClientHello');
  let offset = 4; // handshake type + 3-byte length
  const legacyVersion = hello.readUInt16BE(offset); offset += 2;
  offset += 32; // random
  const sessionIdLength = hello[offset]; offset += 1 + sessionIdLength;
  const cipherBytes = hello.readUInt16BE(offset); offset += 2;
  const ciphers = []; const rawCiphers = [];
  for (let i = 0; i < cipherBytes; i += 2) { const id = hello.readUInt16BE(offset + i); rawCiphers.push(id); if (!isGrease(id)) ciphers.push(nameOf(CIPHER_NAMES, id)); }
  offset += cipherBytes;
  const compressionLength = hello[offset]; offset += 1 + compressionLength;
  const parsed = { legacyVersion: hex(legacyVersion), ciphers, cipherGrease: rawCiphers.filter(isGrease).length, extensions: [], supportedGroups: [], groupGrease: 0, keyShareGroups: [], sigalgs: [], alpn: [], supportedVersions: [], sni: null };
  if (offset + 2 > hello.length) return parsed;
  const extensionsLength = hello.readUInt16BE(offset); offset += 2;
  const end = Math.min(hello.length, offset + extensionsLength);
  while (offset + 4 <= end) {
    const type = hello.readUInt16BE(offset); const length = hello.readUInt16BE(offset + 2); offset += 4;
    const data = hello.subarray(offset, offset + length); offset += length;
    parsed.extensions.push(isGrease(type) ? `GREASE` : hex(type));
    if (type === 0x000a && data.length >= 2) { const n = data.readUInt16BE(0); for (let i = 0; i < n; i += 2) { const g = data.readUInt16BE(2 + i); if (isGrease(g)) parsed.groupGrease += 1; else parsed.supportedGroups.push(nameOf(GROUP_NAMES, g)); } }
    if (type === 0x000d && data.length >= 2) { const n = data.readUInt16BE(0); for (let i = 0; i < n; i += 2) parsed.sigalgs.push(nameOf(SIGALG_NAMES, data.readUInt16BE(2 + i))); }
    if (type === 0x0010 && data.length >= 2) { let p = 2; while (p < data.length) { const l = data[p]; parsed.alpn.push(data.subarray(p + 1, p + 1 + l).toString('latin1')); p += 1 + l; } }
    if (type === 0x0033 && data.length >= 2) { let p = 2; const n = data.readUInt16BE(0); while (p < 2 + n && p + 4 <= data.length) { const g = data.readUInt16BE(p); const l = data.readUInt16BE(p + 2); if (!isGrease(g)) parsed.keyShareGroups.push(nameOf(GROUP_NAMES, g)); p += 4 + l; } }
    if (type === 0x002b && data.length >= 1) { const n = data[0]; for (let i = 0; i < n; i += 2) { const v = data.readUInt16BE(1 + i); if (!isGrease(v)) parsed.supportedVersions.push(v === 0x0304 ? 'TLSv1.3' : v === 0x0303 ? 'TLSv1.2' : hex(v)); } }
    if (type === 0x0000 && data.length >= 5) { const l = data.readUInt16BE(3); parsed.sni = data.subarray(5, 5 + l).toString('latin1'); }
  }
  return parsed;
}

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const closer = (server, sockets) => () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()); });

/** Raw ClientHello observer: records each connection's parsed ClientHello, then drops the connection. */
export async function startClientHelloObserver() {
  const hellos = []; const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket); let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length >= 5 && pending.length >= 5 + pending.readUInt16BE(3)) {
        try { hellos.push(parseClientHello(pending)); } catch (error) { hellos.push({ error: error.message }); }
        socket.destroy();
      }
    });
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  });
  const port = await listen(server);
  return { port, url: `https://localhost:${port}/`, hellos, close: closer(server, sockets) };
}

/** HTTPS/1.1 observer: records raw header names in wire order (lowercased) for every request. */
export async function startH1Observer(certificate) {
  const requests = []; const sockets = new Set();
  const server = https.createServer({ ...certificate, ALPNProtocols: ['http/1.1'] }, (req, res) => {
    requests.push({ method: req.method, path: req.url, headerNames: req.rawHeaders.filter((_, i) => i % 2 === 0).map((n) => n.toLowerCase()), headers: Object.fromEntries(req.rawHeaders.map((v, i, a) => i % 2 === 0 ? [v.toLowerCase(), a[i + 1]] : null).filter(Boolean)), alpn: req.socket.alpnProtocol ?? null, cipher: req.socket.getCipher?.()?.name ?? null });
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const port = await listen(server);
  return { port, url: `https://localhost:${port}/`, requests, close: closer(server, sockets) };
}

/** HTTP/2 observer: records each stream's raw header order (pseudo + regular) and the session's remote settings. */
export async function startH2Observer(certificate) {
  const streams = []; const sockets = new Set(); const sessions = new Set();
  const server = http2.createSecureServer({ ...certificate, allowHTTP1: false });
  server.on('session', (session) => { sessions.add(session); session.on('close', () => sessions.delete(session)); });
  server.on('stream', (stream, headers, _flags, rawHeaders) => {
    const names = []; for (let i = 0; i < rawHeaders.length; i += 2) names.push(rawHeaders[i].toLowerCase());
    const values = Object.fromEntries(names.map((n, i) => [n, rawHeaders[i * 2 + 1]]));
    streams.push({ headerNames: names, headers: values, remoteSettings: { ...stream.session.remoteSettings }, alpn: stream.session.socket.alpnProtocol ?? null, sessionId: stream.session });
    stream.respond({ ':status': 200, 'content-type': 'text/plain' }); stream.end('ok');
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const port = await listen(server);
  return { port, url: `https://localhost:${port}/`, streams, distinctSessions: () => new Set(streams.map((s) => s.sessionId)).size, close: async () => { for (const s of sessions) s.destroy(); await closer(server, sockets)(); } };
}

const H2_PREFACE = 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n';
const SETTING_NAMES = { 1: 'headerTableSize', 2: 'enablePush', 3: 'maxConcurrentStreams', 4: 'initialWindowSize', 5: 'maxFrameSize', 6: 'maxHeaderListSize', 8: 'enableConnectProtocol' };

/** Raw HTTP/2 frame observer over TLS: records the client's SETTINGS frame (ordered id/value pairs) and connection WINDOW_UPDATE. */
export async function startH2FrameObserver(certificate) {
  const sessions = []; const sockets = new Set();
  const server = tls.createServer({ ...certificate, ALPNProtocols: ['h2'] }, (socket) => {
    sockets.add(socket);
    const record = { prefaceOk: null, settings: [], settingsOrder: [], windowUpdate: null, framesSeen: [], parsedClientHello: null };
    sessions.push(record);
    // The client sends its preface + SETTINGS (+ WINDOW_UPDATE) without waiting; we answer with an empty SETTINGS so it proceeds to HEADERS.
    socket.write(Buffer.from([0, 0, 0, 4, 0, 0, 0, 0, 0]));
    let pending = Buffer.alloc(0); let prefaceDone = false;
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (!prefaceDone) { if (pending.length < H2_PREFACE.length) return; record.prefaceOk = pending.subarray(0, H2_PREFACE.length).toString('latin1') === H2_PREFACE; pending = pending.subarray(H2_PREFACE.length); prefaceDone = true; }
      while (pending.length >= 9) {
        const length = pending.readUIntBE(0, 3); const type = pending[3]; const flags = pending[4]; const streamId = pending.readUInt32BE(5) & 0x7fffffff;
        if (pending.length < 9 + length) return;
        const payload = pending.subarray(9, 9 + length); pending = pending.subarray(9 + length);
        record.framesSeen.push({ type, flags, streamId, length });
        if (type === 4 && (flags & 0x1) === 0) { for (let i = 0; i + 6 <= payload.length; i += 6) { const id = payload.readUInt16BE(i); const value = payload.readUInt32BE(i + 2); record.settings.push({ id, name: SETTING_NAMES[id] ?? `setting-${id}`, value }); record.settingsOrder.push(id); } }
        if (type === 8 && streamId === 0) { record.windowUpdate = payload.readUInt32BE(0) & 0x7fffffff; record.windowUpdateBeforeHeaders = !record.framesSeen.some((f) => f.type === 1); }
        if (type === 1 && !record.headersSeenAt) { record.headersSeenAt = Date.now(); setTimeout(() => socket.end(), 250); } // keep listening briefly for a late WINDOW_UPDATE
      }
    });
    socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket));
  });
  const port = await listen(server);
  return { port, url: `https://localhost:${port}/`, sessions, close: closer(server, sockets) };
}

// ——— proxy fixtures for the route-parity rows ———

/** HTTP(S) proxy accepting CONNECT tunnels. Pass `{ secure: certificate }` for a TLS-fronted proxy. Records what it saw. */
export async function startConnectProxy({ secure = null } = {}) {
  const tunnels = []; const sockets = new Set();
  const handler = (req, res) => { res.writeHead(405); res.end(); };
  const server = secure ? https.createServer({ ...secure }, handler) : http.createServer(handler);
  server.on('connect', (req, clientSocket, head) => {
    sockets.add(clientSocket);
    const [host, port] = req.url.split(':');
    const upstream = net.connect(Number(port), host, () => {
      tunnels.push({ target: req.url, headers: { ...req.headers } });
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket); clientSocket.pipe(upstream);
    });
    sockets.add(upstream);
    upstream.on('error', () => clientSocket.destroy()); clientSocket.on('error', () => upstream.destroy());
    clientSocket.on('close', () => { sockets.delete(clientSocket); upstream.destroy(); });
  });
  const port = await listen(server);
  return { port, url: `${secure ? 'https' : 'http'}://127.0.0.1:${port}`, tunnels, close: closer(server, sockets) };
}

/** Minimal SOCKS5 proxy (no auth, CONNECT command, IPv4/domain). Records each connect request. */
export async function startSocks5Proxy() {
  const connects = []; const sockets = new Set();
  const server = net.createServer((client) => {
    sockets.add(client); let stage = 'greeting'; let pending = Buffer.alloc(0);
    client.on('data', (chunk) => {
      if (stage === 'done') return;
      pending = Buffer.concat([pending, chunk]);
      if (stage === 'greeting') {
        if (pending.length < 2 || pending.length < 2 + pending[1]) return;
        pending = pending.subarray(2 + pending[1]); client.write(Buffer.from([0x05, 0x00])); stage = 'request';
      }
      if (stage === 'request') {
        if (pending.length < 4) return;
        const atyp = pending[3]; let host; let hostEnd;
        if (atyp === 0x01) { if (pending.length < 10) return; host = [...pending.subarray(4, 8)].join('.'); hostEnd = 8; }
        else if (atyp === 0x03) { const l = pending[4]; if (pending.length < 5 + l + 2) return; host = pending.subarray(5, 5 + l).toString('latin1'); hostEnd = 5 + l; }
        else { client.end(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0])); return; }
        const port = pending.readUInt16BE(hostEnd); const rest = pending.subarray(hostEnd + 2); stage = 'done';
        const upstream = net.connect(port, host, () => {
          connects.push({ host, port });
          client.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
          if (rest.length) upstream.write(rest);
          upstream.pipe(client); client.pipe(upstream);
        });
        sockets.add(upstream);
        upstream.on('error', () => client.destroy()); client.on('close', () => { sockets.delete(client); upstream.destroy(); });
      }
    });
    client.on('error', () => {});
  });
  const port = await listen(server);
  return { port, url: `socks5://127.0.0.1:${port}`, connects, close: closer(server, sockets) };
}

/** Awaits a request promise without caring whether it settled or rejected (the observer may drop the connection on purpose). */
export const settle = (promise) => promise.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
