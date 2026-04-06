import * as net from "node:net";
import * as tls from "node:tls";
import * as http from "node:http";
import { once } from "node:events";
import { Agent } from './base.js';
function omit(obj, ...keys) {
  const ret = {};
  for (const key in obj) {
    if (!keys.includes(key)) {
      ret[key] = obj[key];
    }
  }
  return ret;
}

export class HttpProxyAgent extends Agent {
  static protocols = ["http", "https"];
  proxy;
  proxyHeaders;
  connectOpts;
  constructor(proxy, opts) {
    super(opts);
    this.proxy = typeof proxy === "string" ? new URL(proxy) : proxy;
    this.proxyHeaders = opts?.headers ?? {};
    const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, "");
    const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === "https:" ? 443 : 80;
    this.connectOpts = {
      ...opts ? omit(opts, "headers") : {},
      host,
      port
    };
  }
  addRequest(req, opts) {
    req._header = null;
    this.setRequestProps(req, opts);
    http.Agent.prototype.addRequest.call(this, req, opts);
  }
  setRequestProps(req, opts) {
    const { proxy } = this;
    const protocol = opts.secureEndpoint ? "https:" : "http:";
    const hostname = req.getHeader("host") || "localhost";
    const base = `${protocol}//${hostname}`;
    const url = new URL(req.path, base);
    if (opts.port !== 80) {
      url.port = String(opts.port);
    }
    req.path = String(url);
    const headers = typeof this.proxyHeaders === "function" ? this.proxyHeaders() : { ...this.proxyHeaders };
    if (proxy.username || proxy.password) {
      const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
    }
    if (!headers["Proxy-Connection"]) {
      headers["Proxy-Connection"] = this.keepAlive ? "Keep-Alive" : "close";
    }
    for (const name of Object.keys(headers)) {
      const value = headers[name];
      if (value) {
        req.setHeader(name, value);
      }
    }
  }
  async connect(req, opts) {
    req._header = null;
    if (!req.path.includes("://")) {
      this.setRequestProps(req, opts);
    }
    req._implicitHeader();
    if (req.outputData && req.outputData.length > 0) {
      const first = req.outputData[0].data;
      const endOfHeaders = first.indexOf(`\r
\r
`) + 4;
      req.outputData[0].data = req._header + first.substring(endOfHeaders);
    }
    let socket;
    if (this.proxy.protocol === "https:") {
      socket = tls.connect(this.connectOpts);
    } else {
      socket = net.connect(this.connectOpts);
    }
    await once(socket, "connect");
    return socket;
  }
}
export default HttpProxyAgent;
