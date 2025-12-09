const { SocksProxyAgent: RezoSocksProxy } = require("socks-proxy-agent");
const { HttpsProxyAgent: RezoHttpsSocks } = require("https-proxy-agent");
const { HttpProxyAgent: RezoHttpSocks } = require("http-proxy-agent");
const _mod_7lhr2y = require('./manager.cjs');
exports.ProxyManager = _mod_7lhr2y.ProxyManager;;
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
function isIPv4(host) {
  const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)){3}$/;
  return ipv4Regex.test(host);
}
function isDomain(host) {
  const domainRegex = /^(?=.{1,253}$)(?!-)([a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;
  return domainRegex.test(host);
}
function isNumeric(value) {
  if (typeof value === "number")
    return isFinite(value);
  if (typeof value === "string" && value.trim() !== "") {
    return !isNaN(Number(value));
  }
  return false;
}
function parseProxyString(input) {
  if (!input)
    return null;
  let host = "";
  let port = 0;
  let username;
  let password;
  const proto = input.includes("://") ? input.split("://")[0].toLowerCase() : "";
  const protocol = proto.startsWith("http") ? "http" : proto.startsWith("https") ? "https" : "socks5";
  if (protocol !== "socks5" || input.includes("://")) {
    input = input.split("://")[1];
  }
  const getProxy = (authPart, hostPart) => {
    if (authPart && authPart.includes(":")) {
      const [p1, ..._p2] = authPart.split(":");
      const p2 = _p2.join(":");
      if ((isIPv4(p1) || isDomain(p1)) && isNumeric(p2)) {
        host = p1;
        port = parseInt(p2, 10);
      } else {
        username = p1;
        password = p2;
      }
    }
    if (hostPart && hostPart.includes(":")) {
      const [p1, ..._p2] = hostPart.split(":");
      const p2 = _p2.join(":");
      if ((isIPv4(p1) || isDomain(p1)) && isNumeric(p2)) {
        host = p1;
        port = parseInt(p2, 10);
      } else {
        username = p1;
        password = p2;
      }
    }
    if (!host && !port)
      return null;
    if (username && password) {
      return { protocol, host, port, auth: { username, password } };
    }
    return {
      protocol,
      host,
      port
    };
  };
  input = input.trim();
  if (input.includes("@")) {
    const [authPart, hostPart] = input.split("@");
    if (!authPart && !hostPart)
      return null;
    return getProxy(authPart, hostPart);
  } else if (input.split(":").length === 4 || input.split(":").length === 2) {
    const parts = input.split(":");
    const authPart = input.split(":").length === 2 ? undefined : parts[2] + ":" + parts[3];
    const hostPart = parts[0] + ":" + parts[1];
    return getProxy(authPart || "", hostPart || "");
  } else {
    return null;
  }
}
function rezoProxy(uri, over, opts) {
  if (typeof uri === "string") {
    if (typeof over === "string") {
      const config = createOptions(uri, opts);
      if (over === "http") {
        return new RezoHttpSocks(config.uri, config.opts);
      }
      return new RezoHttpsSocks(config.uri, { ...config.opts, rejectUnauthorized: false });
    } else {
      const isHttp = uri.startsWith("http:");
      const isHttps = uri.startsWith("https:");
      const isSocks = uri.startsWith("sock");
      if (isSocks) {
        const config = createOptions(uri, over || opts);
        return new RezoSocksProxy(config.uri, config.opts);
      }
      if (isHttp) {
        const config = createOptions(uri, over || opts);
        return new RezoHttpSocks(config.uri, config.opts);
      }
      if (isHttps) {
        const config = createOptions(uri, over || opts);
        return new RezoHttpsSocks(config.uri, { ...config.opts, rejectUnauthorized: false });
      }
      const proxy = parseProxyString(uri);
      if (proxy) {
        const config = createOptions(proxy, over || opts);
        return new RezoSocksProxy(config.uri, config.opts);
      }
      throw new Error("Invalid proxy protocol");
    }
  }
  if (uri.client) {
    delete uri.client;
    const config = createOptions(uri, opts);
    if (over === "http") {
      return new RezoHttpSocks(config.uri, config.opts);
    }
    console.log(config.uri);
    return new RezoHttpsSocks(config.uri, { ...config.opts, rejectUnauthorized: false });
  }
  const config = createOptions(uri, opts);
  return new RezoSocksProxy(config.uri, config.opts);
}

exports.parseProxyString = parseProxyString;
exports.rezoProxy = rezoProxy;