import * as http from "node:http";
import * as https from "node:https";
import { rezoProxy } from '../proxy/index.js';

export class AgentMerger {
  static merge(options) {
    const { proxy, httpAgent, httpsAgent, isSecure = false, mergeOptions = {} } = options;
    if (!proxy && !httpAgent && !httpsAgent) {
      return;
    }
    if (!proxy) {
      return isSecure ? httpsAgent : httpAgent;
    }
    if (!httpAgent && !httpsAgent) {
      return this.createProxyAgent(proxy);
    }
    return this.mergeProxyWithCustomAgent(proxy, isSecure ? httpsAgent : httpAgent, isSecure, mergeOptions);
  }
  static createProxyAgent(proxy) {
    if (!proxy) {
      throw new Error("Proxy configuration is required");
    }
    if (typeof proxy === "string") {
      return rezoProxy(proxy);
    }
    return rezoProxy(proxy);
  }
  static mergeProxyWithCustomAgent(proxy, customAgent, isSecure, mergeOptions = {}) {
    if (!customAgent) {
      return this.createProxyAgent(proxy);
    }
    const customOptions = this.extractAgentOptions(customAgent);
    const proxyAgent = this.createProxyAgent(proxy);
    const proxyOptions = this.extractAgentOptions(proxyAgent);
    const mergedOptions = {
      ...proxyOptions,
      ...customOptions,
      ...mergeOptions,
      proxy: this.extractProxyConfig(proxyAgent)
    };
    if (isSecure) {
      return new https.Agent(mergedOptions);
    } else {
      return new http.Agent(mergedOptions);
    }
  }
  static extractAgentOptions(agent) {
    const options = {};
    if (agent.keepAlive !== undefined)
      options.keepAlive = agent.keepAlive;
    if (agent.keepAliveMsecs !== undefined)
      options.keepAliveMsecs = agent.keepAliveMsecs;
    if (agent.maxSockets !== undefined)
      options.maxSockets = agent.maxSockets;
    if (agent.maxFreeSockets !== undefined)
      options.maxFreeSockets = agent.maxFreeSockets;
    if (agent.timeout !== undefined)
      options.timeout = agent.timeout;
    if (agent instanceof https.Agent) {
      const httpsAgent = agent;
      if (httpsAgent.options?.rejectUnauthorized !== undefined) {
        options.rejectUnauthorized = httpsAgent.options.rejectUnauthorized;
      }
      if (httpsAgent.options?.ca)
        options.ca = httpsAgent.options.ca;
      if (httpsAgent.options?.cert)
        options.cert = httpsAgent.options.cert;
      if (httpsAgent.options?.key)
        options.key = httpsAgent.options.key;
      if (httpsAgent.options?.pfx)
        options.pfx = httpsAgent.options.pfx;
      if (httpsAgent.options?.passphrase)
        options.passphrase = httpsAgent.options.passphrase;
      if (httpsAgent.options?.ciphers)
        options.ciphers = httpsAgent.options.ciphers;
      if (httpsAgent.options?.secureProtocol)
        options.secureProtocol = httpsAgent.options.secureProtocol;
    }
    return options;
  }
  static extractProxyConfig(proxyAgent) {
    return proxyAgent.proxy || proxyAgent.proxyOptions || undefined;
  }
  static createMergedAgent(options) {
    const { proxy, customAgent, isSecure = false, capabilities = {} } = options;
    return this.merge({
      proxy,
      httpAgent: !isSecure ? customAgent : undefined,
      httpsAgent: isSecure ? customAgent : undefined,
      isSecure,
      mergeOptions: capabilities
    });
  }
  static isProxyAgent(agent) {
    return !!agent.proxy || !!agent.proxyOptions;
  }
  static getProxyInfo(agent) {
    return agent.proxy || agent.proxyOptions || null;
  }
}
export function mergeAgents(proxy, customAgent, isSecure = false) {
  return AgentMerger.merge({
    proxy,
    httpAgent: !isSecure ? customAgent : undefined,
    httpsAgent: isSecure ? customAgent : undefined,
    isSecure
  });
}
