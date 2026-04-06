const { Agent, HttpProxyAgent, HttpsProxyAgent, SocksProxyAgent } = require('../internal/agents/index.cjs');
const { parseProxyString } = require('./parse.cjs');
const _mod_6lbbzm = require('./manager.cjs');
exports.ProxyManager = _mod_6lbbzm.ProxyManager;;
const _mod_1l6me7 = require('./parse.cjs');
exports.parseProxyString = _mod_1l6me7.parseProxyString;;
function createOptions(uri, opts) {
  if (uri instanceof URL || typeof uri === "string") {
    return {
      uri,
      opts
    };
  }
  const { port, protocol, host, auth, ...config } = uri;
  const authstr = auth ? `${encodeURIComponent(auth.username)}:${encodeURIComponent(auth.password)}@` : "";
  opts = { ...opts || {}, ...config || {} };
  return {
    opts: Object.keys(opts).length > 0 ? opts : undefined,
    uri: `${protocol}://${authstr}${host}:${port}`
  };
}
function rezoProxy(uri, over, opts) {
  if (typeof uri === "string") {
    if (typeof over === "string") {
      const config = createOptions(uri, opts);
      if (over === "http") {
        return new HttpProxyAgent(config.uri, config.opts);
      }
      return new HttpsProxyAgent(config.uri, { ...config.opts, rejectUnauthorized: config.opts?.rejectUnauthorized ?? false });
    } else {
      const isHttp = uri.startsWith("http:");
      const isHttps = uri.startsWith("https:");
      const isSocks = uri.startsWith("sock");
      if (isSocks) {
        const config = createOptions(uri, over || opts);
        return new SocksProxyAgent(config.uri, config.opts);
      }
      if (isHttp) {
        const config = createOptions(uri, over || opts);
        return new HttpProxyAgent(config.uri, config.opts);
      }
      if (isHttps) {
        const config = createOptions(uri, over || opts);
        return new HttpsProxyAgent(config.uri, { ...config.opts, rejectUnauthorized: config.opts?.rejectUnauthorized ?? false });
      }
      const proxy = parseProxyString(uri);
      if (proxy) {
        const config = createOptions(proxy, over || opts);
        return new SocksProxyAgent(config.uri, config.opts);
      }
      throw new Error("Invalid proxy protocol");
    }
  }
  if (uri.client) {
    delete uri.client;
    const config = createOptions(uri, opts);
    if (over === "http") {
      return new HttpProxyAgent(config.uri, config.opts);
    }
    return new HttpsProxyAgent(config.uri, { ...config.opts, rejectUnauthorized: config.opts?.rejectUnauthorized ?? false });
  }
  const config = createOptions(uri, opts);
  return new SocksProxyAgent(config.uri, config.opts);
}

exports.Agent = Agent;
exports.HttpProxyAgent = HttpProxyAgent;
exports.HttpsProxyAgent = HttpsProxyAgent;
exports.SocksProxyAgent = SocksProxyAgent;
exports.rezoProxy = rezoProxy;