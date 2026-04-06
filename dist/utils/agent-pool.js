import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";
import { getGlobalDNSCache } from '../cache/dns-cache.js';
const DEFAULT_CONFIG = {
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 256,
  maxFreeSockets: 64,
  timeout: 30000,
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
    const parts = [];
    if (options.proxy) {
      parts.push(`proxy:${options.proxy.protocol}://${options.proxy.host}:${options.proxy.port}`);
      if (options.proxy.auth) {
        parts.push(`auth:${options.proxy.auth.username}`);
      }
    }
    if (options.rejectUnauthorized === false) {
      parts.push("insecure");
    }
    if (options.ca) {
      parts.push(`ca:${typeof options.ca === "string" ? options.ca.slice(0, 32) : "buffer"}`);
    }
    if (options.cert) {
      parts.push(`cert:${typeof options.cert === "string" ? options.cert.slice(0, 32) : "buffer"}`);
    }
    if (options.servername) {
      parts.push(`sni:${options.servername}`);
    }
    if (options.localAddress) {
      parts.push(`local:${options.localAddress}`);
    }
    return parts.length > 0 ? parts.join("|") : "default";
  }
  createLookupFunction() {
    return;
  }
  createHttpAgent(key) {
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
  setupAgentSocketUnref(agent) {
    agent.on("free", (socket) => {
      if (socket && typeof socket.unref === "function") {
        socket.unref();
      }
    });
  }
  createHttpsAgent(key, tlsOptions) {
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
      sessionTimeout: 3600
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
export function getGlobalAgentPool(config) {
  if (!globalAgentPool) {
    globalAgentPool = new AgentPool(config);
  }
  return globalAgentPool;
}
export function resetGlobalAgentPool() {
  if (globalAgentPool) {
    globalAgentPool.destroy();
  }
  globalAgentPool = null;
}

export { AgentPool };
export default AgentPool;
