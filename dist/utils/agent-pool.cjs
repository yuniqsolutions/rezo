const http = require("node:http");
const https = require("node:https");
const tls = require("node:tls");
const { createHmac, randomBytes } = require("node:crypto");
const { isNativeAgentPfxKnownUnsupported } = require('../platform/native-tls-capabilities.cjs');
const { RezoError } = require('../errors/rezo-error.cjs');
const { getGlobalDNSCache } = require('../cache/dns-cache.cjs');
const DEFAULT_CONFIG = {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 256,
  maxFreeSockets: 64,
  timeout: 5000,
  scheduling: "lifo",
  dnsCache: true,
  idleEvictionMs: 60000
};

class AgentPool {
  httpAgents = new Map;
  httpsAgents = new Map;
  config;
  dnsCache = null;
  evictionTimer = null;
  identitySecret = randomBytes(32);
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    if (this.config.dnsCache) {
      const dnsCacheOptions = typeof this.config.dnsCache === "object" ? this.config.dnsCache : {};
      this.dnsCache = getGlobalDNSCache(dnsCacheOptions);
    }
    if (this.config.idleEvictionMs > 0) {
      this.startEvictionTimer();
    }
  }
  buildAgentKey(options = {}) {
    const digest = createHmac("sha256", this.identitySecret);
    const add = (value) => {
      if (value === undefined) {
        digest.update("N;");
        return;
      }
      const bytes = Buffer.from(value);
      digest.update(`B${bytes.length}:`).update(bytes);
    };
    const proxy = options.proxy;
    digest.update(proxy ? "P1;" : "P0;");
    if (proxy) {
      add(proxy.protocol);
      add(proxy.host);
      add(String(proxy.port));
      digest.update(proxy.auth ? "A1;" : "A0;");
      if (proxy.auth) {
        add(proxy.auth.username);
        add(proxy.auth.password);
      }
    }
    digest.update(options.rejectUnauthorized !== false ? "V1;" : "V0;");
    const ca = options.ca === undefined ? undefined : Array.isArray(options.ca) ? options.ca : [options.ca];
    digest.update(ca === undefined ? "C-;" : `C${ca.length};`);
    if (ca)
      for (const certificate of ca)
        add(certificate);
    add(options.cert);
    add(options.key);
    add(options.pfx);
    add(options.passphrase);
    add(options.servername);
    add(options.localAddress);
    return digest.digest("hex");
  }
  createLookupFunction() {
    return;
  }
  createHttpAgent(_key) {
    const agentOptions = {
      keepAlive: this.config.keepAlive,
      keepAliveMsecs: this.config.keepAliveMsecs,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
      scheduling: this.config.scheduling
    };
    const lookup = this.createLookupFunction();
    if (lookup) {
      agentOptions.lookup = lookup;
    }
    return new http.Agent(agentOptions);
  }
  _setupAgentSocketUnref(agent) {
    agent.on("free", (socket) => {
      if (socket && typeof socket.unref === "function") {
        socket.unref();
      }
    });
  }
  createHttpsAgent(_key, tlsOptions) {
    const secureContext = tls.createSecureContext({
      ecdhCurve: "X25519:prime256v1:secp384r1",
      ciphers: [
        "TLS_AES_128_GCM_SHA256",
        "TLS_AES_256_GCM_SHA384",
        "TLS_CHACHA20_POLY1305_SHA256",
        "ECDHE-ECDSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES128-GCM-SHA256",
        "ECDHE-ECDSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-ECDSA-CHACHA20-POLY1305",
        "ECDHE-RSA-CHACHA20-POLY1305",
        "ECDHE-RSA-AES128-SHA",
        "ECDHE-RSA-AES256-SHA",
        "AES128-GCM-SHA256",
        "AES256-GCM-SHA384",
        "AES128-SHA",
        "AES256-SHA"
      ].join(":"),
      sigalgs: [
        "ecdsa_secp256r1_sha256",
        "rsa_pss_rsae_sha256",
        "rsa_pkcs1_sha256",
        "ecdsa_secp384r1_sha384",
        "rsa_pss_rsae_sha384",
        "rsa_pkcs1_sha384",
        "rsa_pss_rsae_sha512",
        "rsa_pkcs1_sha512"
      ].join(":"),
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.3",
      sessionTimeout: 3600,
      ca: tlsOptions?.ca,
      cert: tlsOptions?.cert,
      key: tlsOptions?.key,
      pfx: tlsOptions?.pfx,
      passphrase: tlsOptions?.passphrase
    });
    const agentOptions = {
      keepAlive: this.config.keepAlive,
      keepAliveMsecs: this.config.keepAliveMsecs,
      maxSockets: this.config.maxSockets,
      maxFreeSockets: this.config.maxFreeSockets,
      timeout: this.config.timeout,
      scheduling: this.config.scheduling,
      secureContext,
      ...tlsOptions
    };
    const lookup = this.createLookupFunction();
    if (lookup) {
      agentOptions.lookup = lookup;
    }
    return new https.Agent(agentOptions);
  }
  getHttpAgent(options) {
    const key = this.buildAgentKey(options);
    let pooled = this.httpAgents.get(key);
    if (pooled) {
      pooled.lastUsed = Date.now();
      return pooled.agent;
    }
    const agent = this.createHttpAgent(key);
    pooled = { agent, lastUsed: Date.now(), key };
    this.httpAgents.set(key, pooled);
    return agent;
  }
  getHttpsAgent(options) {
    const pfx = options?.pfx;
    if (pfx !== undefined && isNativeAgentPfxKnownUnsupported()) {
      const errorConfig = Object.freeze({ adapterUsed: null });
      throw new RezoError("PFX is not supported by this native HTTPS agent provider", errorConfig, "REZ_UNSUPPORTED_CAPABILITY");
    }
    const copy = (value) => Buffer.isBuffer(value) ? Buffer.from(value) : value;
    const {
      ca,
      cert,
      key: privateKey,
      passphrase,
      servername,
      localAddress,
      rejectUnauthorized,
      proxy
    } = options ?? {};
    const auth = proxy?.auth;
    options = {
      ca: Array.isArray(ca) ? ca.map((value) => copy(value)) : copy(ca),
      cert: copy(cert),
      key: copy(privateKey),
      pfx: copy(pfx),
      passphrase,
      servername,
      localAddress,
      proxy: proxy ? {
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        auth: auth ? { username: auth.username, password: auth.password } : undefined
      } : undefined,
      rejectUnauthorized: rejectUnauthorized !== false
    };
    const key = this.buildAgentKey(options);
    let pooled = this.httpsAgents.get(key);
    if (pooled) {
      pooled.lastUsed = Date.now();
      return pooled.agent;
    }
    const agent = this.createHttpsAgent(key, options);
    pooled = { agent, lastUsed: Date.now(), key };
    this.httpsAgents.set(key, pooled);
    return agent;
  }
  startEvictionTimer() {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
    }
    this.evictionTimer = setInterval(() => {
      this.evictIdleAgents();
    }, Math.min(this.config.idleEvictionMs / 2, 30000));
    if (this.evictionTimer.unref) {
      this.evictionTimer.unref();
    }
  }
  evictIdleAgents() {
    const now = Date.now();
    const threshold = now - this.config.idleEvictionMs;
    for (const [key, pooled] of this.httpAgents) {
      if (pooled.lastUsed < threshold) {
        pooled.agent.destroy();
        this.httpAgents.delete(key);
      }
    }
    for (const [key, pooled] of this.httpsAgents) {
      if (pooled.lastUsed < threshold) {
        pooled.agent.destroy();
        this.httpsAgents.delete(key);
      }
    }
  }
  getStats() {
    return {
      httpAgents: this.httpAgents.size,
      httpsAgents: this.httpsAgents.size,
      dnsCacheSize: this.dnsCache?.size ?? 0,
      config: this.config
    };
  }
  destroy() {
    if (this.evictionTimer) {
      clearInterval(this.evictionTimer);
      this.evictionTimer = null;
    }
    for (const pooled of this.httpAgents.values()) {
      this.destroyAgentSockets(pooled.agent);
      pooled.agent.destroy();
    }
    this.httpAgents.clear();
    for (const pooled of this.httpsAgents.values()) {
      this.destroyAgentSockets(pooled.agent);
      pooled.agent.destroy();
    }
    this.httpsAgents.clear();
  }
  destroyAgentSockets(agent) {
    const sockets = agent.sockets;
    if (sockets && typeof sockets === "object") {
      for (const key of Object.keys(sockets)) {
        const socketList = sockets[key];
        if (Array.isArray(socketList)) {
          for (const socket of socketList) {
            try {
              socket.destroy();
            } catch {}
          }
        }
      }
    }
    const freeSockets = agent.freeSockets;
    if (freeSockets && typeof freeSockets === "object") {
      for (const key of Object.keys(freeSockets)) {
        const socketList = freeSockets[key];
        if (Array.isArray(socketList)) {
          for (const socket of socketList) {
            try {
              socket.destroy();
            } catch {}
          }
        }
      }
    }
  }
  clear() {
    this.destroy();
    if (this.config.idleEvictionMs > 0) {
      this.startEvictionTimer();
    }
  }
}
let globalAgentPool = null;
function getGlobalAgentPool(config) {
  if (!globalAgentPool) {
    globalAgentPool = new AgentPool(config);
  }
  return globalAgentPool;
}
function resetGlobalAgentPool() {
  if (globalAgentPool) {
    globalAgentPool.destroy();
  }
  globalAgentPool = null;
}

exports.AgentPool = AgentPool;
exports.getGlobalAgentPool = getGlobalAgentPool;
exports.resetGlobalAgentPool = resetGlobalAgentPool;
exports.default = AgentPool;
module.exports = Object.assign(AgentPool, exports);