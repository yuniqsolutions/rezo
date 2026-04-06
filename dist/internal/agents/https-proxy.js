import * as net from "node:net";
import * as tls from "node:tls";
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
function setServernameFromNonIpHost(options) {
  if (options.servername === undefined && options.host && !net.isIP(options.host)) {
    return { ...options, servername: options.host };
  }
  return options;
}
function parseProxyResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffersLength = 0;
    const buffers = [];
    function read() {
      const b = socket.read();
      if (b)
        ondata(b);
      else
        socket.once("readable", read);
    }
    function cleanup() {
      socket.removeListener("end", onend);
      socket.removeListener("error", onerror);
      socket.removeListener("readable", read);
    }
    function onend() {
      cleanup();
      reject(new Error("Proxy connection ended before receiving CONNECT response"));
    }
    function onerror(err) {
      cleanup();
      reject(err);
    }
    function ondata(b) {
      buffers.push(b);
      buffersLength += b.length;
      const buffered = Buffer.concat(buffers, buffersLength);
      const endOfHeaders = buffered.indexOf(`\r
\r
`);
      if (endOfHeaders === -1) {
        read();
        return;
      }
      const headerParts = buffered.slice(0, endOfHeaders).toString("ascii").split(`\r
`);
      const firstLine = headerParts.shift();
      if (!firstLine) {
        socket.destroy();
        return reject(new Error("No header received from proxy CONNECT response"));
      }
      const firstLineParts = firstLine.split(" ");
      const statusCode = +firstLineParts[1];
      const statusText = firstLineParts.slice(2).join(" ");
      const headers = {};
      for (const header of headerParts) {
        if (!header)
          continue;
        const firstColon = header.indexOf(":");
        if (firstColon === -1) {
          socket.destroy();
          return reject(new Error(`Invalid header from proxy CONNECT response: "${header}"`));
        }
        const key = header.slice(0, firstColon).toLowerCase();
        const value = header.slice(firstColon + 1).trimStart();
        const current = headers[key];
        if (typeof current === "string") {
          headers[key] = [current, value];
        } else if (Array.isArray(current)) {
          current.push(value);
        } else {
          headers[key] = value;
        }
      }
      cleanup();
      resolve({
        connect: { statusCode, statusText, headers },
        buffered
      });
    }
    socket.once("error", onerror);
    socket.once("end", onend);
    read();
  });
}
function resume(socket) {
  socket.resume();
}

export class HttpsProxyAgent extends Agent {
  static protocols = ["http", "https"];
  proxy;
  proxyHeaders;
  connectOpts;
  targetTlsOptions;
  constructor(proxy, opts) {
    super(opts);
    this.proxy = typeof proxy === "string" ? new URL(proxy) : proxy;
    this.proxyHeaders = opts?.headers ?? {};
    this.targetTlsOptions = opts?.targetTlsOptions;
    const host = (this.proxy.hostname || this.proxy.host).replace(/^\[|\]$/g, "");
    const port = this.proxy.port ? parseInt(this.proxy.port, 10) : this.proxy.protocol === "https:" ? 443 : 80;
    this.connectOpts = {
      ALPNProtocols: ["http/1.1"],
      ...opts ? omit(opts, "headers", "targetTlsOptions") : {},
      host,
      port
    };
  }
  async connect(req, opts) {
    const { proxy } = this;
    if (!opts.host) {
      throw new TypeError('No "host" provided');
    }
    let socket;
    if (proxy.protocol === "https:") {
      socket = tls.connect(setServernameFromNonIpHost(this.connectOpts));
    } else {
      socket = net.connect(this.connectOpts);
    }
    const headers = typeof this.proxyHeaders === "function" ? this.proxyHeaders() : { ...this.proxyHeaders };
    const host = net.isIPv6(opts.host) ? `[${opts.host}]` : opts.host;
    let payload = `CONNECT ${host}:${opts.port} HTTP/1.1\r
`;
    if (proxy.username || proxy.password) {
      const auth = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
      headers["Proxy-Authorization"] = `Basic ${Buffer.from(auth).toString("base64")}`;
    }
    headers["Host"] = `${host}:${opts.port}`;
    if (!headers["Proxy-Connection"]) {
      headers["Proxy-Connection"] = this.keepAlive ? "Keep-Alive" : "close";
    }
    for (const name of Object.keys(headers)) {
      payload += `${name}: ${headers[name]}\r
`;
    }
    const proxyResponsePromise = parseProxyResponse(socket);
    socket.write(`${payload}\r
`);
    const { connect, buffered } = await proxyResponsePromise;
    req.emit("proxyConnect", connect);
    this.emit("proxyConnect", connect, req);
    if (connect.statusCode === 200) {
      req.once("socket", resume);
      if (opts.secureEndpoint) {
        const tlsOpts = {
          ...omit(setServernameFromNonIpHost(opts), "host", "path", "port"),
          ...this.targetTlsOptions,
          socket
        };
        return tls.connect(tlsOpts);
      }
      return socket;
    }
    socket.destroy();
    const fakeSocket = new net.Socket({ writable: false });
    fakeSocket.readable = true;
    req.once("socket", (s) => {
      if (s.listenerCount("data") > 0) {
        s.push(buffered);
        s.push(null);
      }
    });
    return fakeSocket;
  }
}
export default HttpsProxyAgent;
