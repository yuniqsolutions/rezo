const socketTelemetryMap = new WeakMap;
let socketIdCounter = 0;
export function instrumentSocket(socket, isSecure = false) {
  const existing = socketTelemetryMap.get(socket);
  if (existing) {
    existing.reuse.count++;
    existing.reuse.lastUsed = Date.now();
    existing.reuse.isReused = true;
    return existing;
  }
  const now = Date.now();
  const telemetry = {
    id: ++socketIdCounter,
    timings: {
      created: now
    },
    network: {},
    reuse: {
      count: 1,
      lastUsed: now,
      isReused: false
    },
    connected: false,
    closed: false
  };
  socketTelemetryMap.set(socket, telemetry);
  socket.once("lookup", (err, address, family) => {
    if (!err && address) {
      telemetry.timings.dnsEnd = Date.now();
      telemetry.timings.dnsDuration = telemetry.timings.dnsEnd - telemetry.timings.created;
      telemetry.timings.address = address;
      telemetry.timings.family = typeof family === "number" ? family : family === "IPv6" ? 6 : 4;
    }
  });
  socket.once("connect", () => {
    telemetry.timings.connectEnd = Date.now();
    telemetry.timings.tcpDuration = telemetry.timings.connectEnd - (telemetry.timings.dnsEnd || telemetry.timings.created);
    telemetry.connected = true;
    const s = socket;
    telemetry.network = {
      remoteAddress: s.remoteAddress,
      remotePort: s.remotePort,
      localAddress: s.localAddress,
      localPort: s.localPort,
      family: s.remoteFamily
    };
  });
  if (isSecure) {
    socket.once("secureConnect", () => {
      const tlsSocket = socket;
      telemetry.timings.secureConnectEnd = Date.now();
      telemetry.timings.tlsDuration = telemetry.timings.secureConnectEnd - (telemetry.timings.connectEnd || telemetry.timings.created);
      const cipher = tlsSocket.getCipher?.();
      const cert = tlsSocket.getPeerCertificate?.();
      telemetry.tls = {
        protocol: tlsSocket.getProtocol?.() || undefined,
        cipher: cipher?.name,
        authorized: tlsSocket.authorized,
        authorizationError: tlsSocket.authorizationError,
        certificate: cert ? {
          subject: Array.isArray(cert.subject?.CN) ? cert.subject.CN[0] : cert.subject?.CN,
          issuer: Array.isArray(cert.issuer?.CN) ? cert.issuer.CN[0] : cert.issuer?.CN,
          validFrom: cert.valid_from,
          validTo: cert.valid_to,
          fingerprint: cert.fingerprint
        } : undefined
      };
    });
  }
  socket.once("close", () => {
    telemetry.closed = true;
    telemetry.connected = false;
  });
  return telemetry;
}
export function getSocketTelemetry(socket) {
  return socketTelemetryMap.get(socket);
}
export function isSocketInstrumented(socket) {
  return socketTelemetryMap.has(socket);
}
export function beginRequestContext(socket, isSecure = false) {
  const startTime = Date.now();
  let telemetry = getSocketTelemetry(socket);
  const wasInstrumented = !!telemetry;
  if (!telemetry) {
    telemetry = instrumentSocket(socket, isSecure);
  } else {
    telemetry.reuse.count++;
    telemetry.reuse.lastUsed = startTime;
    telemetry.reuse.isReused = true;
  }
  const connectionReused = wasInstrumented || telemetry.connected;
  return {
    startTime,
    connectionReused,
    socketWait: 0,
    dns: connectionReused ? 0 : telemetry.timings.dnsDuration || 0,
    tcp: connectionReused ? 0 : telemetry.timings.tcpDuration || 0,
    tls: connectionReused ? 0 : telemetry.timings.tlsDuration || 0,
    socketTimings: { ...telemetry.timings }
  };
}
export function getSocketReuseStats(socket) {
  const telemetry = socketTelemetryMap.get(socket);
  if (!telemetry)
    return;
  return {
    count: telemetry.reuse.count,
    lifetime: Date.now() - telemetry.timings.created,
    isReused: telemetry.reuse.isReused
  };
}
export function exportTelemetryStats() {
  return {
    activeSocketCount: socketIdCounter
  };
}
